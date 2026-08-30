export const MIN_OPEN_CELLS_FOR_VERDICT = 6;

export type FanoutCellStatus = "brand" | "competitor" | "nobody" | "error";

export type FanoutCell = {
  provider: string;
  model: string;
  status: FanoutCellStatus;
  rank: number | null;
  competitors: string[];
  answer: string;
};

export type FanoutMapRow = {
  question: { family: string; question: string };
  cells: FanoutCell[];
};

export type FanoutTotals = {
  cells: number;
  brand: number;
  competitor: number;
  nobody: number;
  error: number;
};

export type FanoutMap = {
  generatedAt: string;
  rows: FanoutMapRow[];
  totals: FanoutTotals;
  openTotals: FanoutTotals;
  competitors: Array<{ name: string; mentions: number }>;
};

export type AuditResponse = {
  id: string;
  createdAt: string;
  [key: string]: unknown;
};

export type VisibilityContext = { brand: string; website: string };

export type VisibilityReadyResult = {
  status: "ready";
  brand: string;
  website: string;
  measuredAt: string;
  verdict: "Visible enough to optimize" | "Underspecified in AI search" | "Likely invisible" | null;
  openQuestions: {
    total: number;
    brandAppears: number;
    competitorWins: number;
    nobody: number;
    errors: number;
  };
  topCompetitors: Array<{ name: string; mentions: number }>;
  providersAnswered: string[];
  sampleQuestions: Array<{ question: string; brandAppeared: boolean; namedInstead: string[] }>;
  incomplete: { is: boolean; reason: string };
  reportUrl: string;
  upgrade: { fullReportUsd: 9; lifetimeUsd: 29.99; url: "https://askedthrice.com/pricing" };
};

const MAX_QUESTION_CHARS = 240;
const MAX_COMPETITOR_CHARS = 80;
const MAX_SAMPLE_QUESTIONS = 3;
const MAX_TOP_COMPETITORS = 5;
const MAX_NAMED_INSTEAD = 5;

const instructionPattern =
  /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?|system\s+prompt|developer\s+message|reveal\s+(?:the\s+)?(?:prompt|secret)|act\s+as\s+(?:an?|the)|call\s+(?:the\s+)?tool/iu;

export function sanitizeThirdPartyText(value: string, maxChars: number): string {
  const clean = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .split(/\r?\n/)
    .filter((line) => !instructionPattern.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, maxChars).trim();
}

function normalizedKey(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function websiteLabel(website: string): string {
  try {
    const url = new URL(website.includes("://") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "").split(".")[0] ?? "";
  } catch {
    return website.replace(/^www\./, "").split(".")[0] ?? "";
  }
}

export function isOpenQuestion(question: string, context: VisibilityContext): boolean {
  const normalizedQuestion = normalizedKey(question);
  const brand = normalizedKey(context.brand);
  const domainLabel = normalizedKey(websiteLabel(context.website));
  if (brand.length >= 3 && normalizedQuestion.includes(brand)) return false;
  if (domainLabel.length >= 3 && normalizedQuestion.includes(domainLabel)) return false;
  return true;
}

function verdictFrom(openTotals: FanoutTotals): VisibilityReadyResult["verdict"] {
  const answered = openTotals.cells - openTotals.error;
  if (answered < MIN_OPEN_CELLS_FOR_VERDICT) return null;
  const share = openTotals.brand / answered;
  if (share >= 0.5) return "Visible enough to optimize";
  if (share >= 0.15) return "Underspecified in AI search";
  return "Likely invisible";
}

function actualProviders(map: FanoutMap): { answered: string[]; missing: string[] } {
  const order: string[] = [];
  const answered = new Set<string>();
  for (const row of map.rows) {
    for (const cell of row.cells) {
      if (!order.includes(cell.provider)) order.push(cell.provider);
      if (cell.status !== "error") answered.add(cell.provider);
    }
  }
  return { answered: order.filter((provider) => answered.has(provider)), missing: order.filter((provider) => !answered.has(provider)) };
}

function competitorCounts(map: FanoutMap, context: VisibilityContext): Array<{ name: string; mentions: number }> {
  const counts = new Map<string, { name: string; mentions: number }>();
  for (const row of map.rows) {
    if (!isOpenQuestion(row.question.question, context)) continue;
    for (const cell of row.cells) {
      if (cell.status === "error") continue;
      const seenInCell = new Set<string>();
      for (const rawName of cell.competitors) {
        const name = sanitizeThirdPartyText(rawName, MAX_COMPETITOR_CHARS);
        const key = normalizedKey(name);
        if (!name || !key || seenInCell.has(key)) continue;
        seenInCell.add(key);
        const current = counts.get(key) ?? { name, mentions: 0 };
        current.mentions += 1;
        counts.set(key, current);
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)).slice(0, MAX_TOP_COMPETITORS);
}

function samples(map: FanoutMap, context: VisibilityContext): VisibilityReadyResult["sampleQuestions"] {
  return map.rows
    .filter((row) => isOpenQuestion(row.question.question, context))
    .slice(0, MAX_SAMPLE_QUESTIONS)
    .map((row) => {
      const names: string[] = [];
      const seen = new Set<string>();
      for (const cell of row.cells) {
        if (cell.status === "error") continue;
        for (const rawName of cell.competitors) {
          const name = sanitizeThirdPartyText(rawName, MAX_COMPETITOR_CHARS);
          const key = normalizedKey(name);
          if (!name || !key || seen.has(key)) continue;
          seen.add(key);
          names.push(name);
        }
      }
      return {
        question: sanitizeThirdPartyText(row.question.question, MAX_QUESTION_CHARS),
        brandAppeared: row.cells.some((cell) => cell.status === "brand"),
        namedInstead: names.slice(0, MAX_NAMED_INSTEAD),
      };
    });
}

function incompleteState(map: FanoutMap): VisibilityReadyResult["incomplete"] {
  const answeredOpenCells = map.openTotals.cells - map.openTotals.error;
  const { missing } = actualProviders(map);
  const reasons: string[] = [];
  if (answeredOpenCells < MIN_OPEN_CELLS_FOR_VERDICT) reasons.push("Fewer than 6 open cells answered, so this run cannot support a verdict.");
  if (missing.length > 0) {
    const providers = missing.map((name) => name.charAt(0).toUpperCase() + name.slice(1)).join(", ");
    reasons.push(`${providers} did not answer in this run.`);
  }
  return { is: reasons.length > 0, reason: reasons.join(" ") };
}

export function mapVisibilityResult(audit: AuditResponse, map: FanoutMap, context: VisibilityContext): VisibilityReadyResult {
  const providers = actualProviders(map);
  return {
    status: "ready",
    brand: context.brand,
    website: context.website,
    measuredAt: map.generatedAt,
    verdict: verdictFrom(map.openTotals),
    openQuestions: {
      total: map.openTotals.cells,
      brandAppears: map.openTotals.brand,
      competitorWins: map.openTotals.competitor,
      nobody: map.openTotals.nobody,
      errors: map.openTotals.error,
    },
    topCompetitors: competitorCounts(map, context),
    providersAnswered: providers.answered,
    sampleQuestions: samples(map, context),
    incomplete: incompleteState(map),
    reportUrl: `https://askedthrice.com/reports/${encodeURIComponent(audit.id)}`,
    upgrade: { fullReportUsd: 9, lifetimeUsd: 29.99, url: "https://askedthrice.com/pricing" },
  };
}
