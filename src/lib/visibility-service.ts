import { randomUUID } from "node:crypto";
import { type AuditClient, HttpAuditClient, type FanoutPoll } from "./audit-client";
import { mapVisibilityResult, type AuditResponse, type FanoutMap, type VisibilityReadyResult } from "./visibility-mapper";

export type StartVisibilityInput = {
  brand: string;
  website: string;
  category: string;
  competitors?: string;
  location?: string;
  language?: "en" | "es";
};

export type StartVisibilityResult = {
  runId: string;
  status: "running";
  etaSeconds: 75;
  next: "Call get_visibility_check with this runId. Wait ~30s between polls.";
};

export type RunningVisibilityResult = {
  status: "running";
  elapsedSeconds: number;
  next: "Poll again in ~20s.";
};

export type GetVisibilityResult = RunningVisibilityResult | VisibilityReadyResult;

type Run = {
  audit: AuditResponse;
  context: { brand: string; website: string };
  startedAt: number;
  map?: FanoutMap;
};

type ServiceOptions = { now?: () => number; newRunId?: () => string };

function auditPayload(input: StartVisibilityInput): Record<string, unknown> {
  return {
    brand: input.brand,
    website: input.website,
    category: input.category,
    ...(input.competitors === undefined ? {} : { competitors: input.competitors }),
    ...(input.location === undefined ? {} : { location: input.location }),
    ...(input.language === undefined ? {} : { promptLanguage: input.language }),
    source: "mcp",
  };
}

export class VisibilityService {
  private readonly runs = new Map<string, Run>();
  private readonly now: () => number;
  private readonly newRunId: () => string;

  constructor(
    private readonly client: AuditClient,
    options: ServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.newRunId = options.newRunId ?? randomUUID;
  }

  async start(input: StartVisibilityInput): Promise<StartVisibilityResult> {
    const safeInput: StartVisibilityInput = {
      brand: input.brand,
      website: input.website,
      category: input.category,
      ...(input.competitors === undefined ? {} : { competitors: input.competitors }),
      ...(input.location === undefined ? {} : { location: input.location }),
      ...(input.language === undefined ? {} : { language: input.language }),
    };
    const audit = await this.client.startAudit(auditPayload(safeInput));
    const runId = this.newRunId();
    const run: Run = { audit, context: { brand: safeInput.brand, website: safeInput.website }, startedAt: this.now() };
    this.runs.set(runId, run);
    void this.client
      .startFanoutMap(audit.id)
      .then((poll) => {
        if (poll.status === "ready") run.map = poll.map;
      })
      .catch(() => undefined);
    return {
      runId,
      status: "running",
      etaSeconds: 75,
      next: "Call get_visibility_check with this runId. Wait ~30s between polls.",
    };
  }

  async get(runId: string): Promise<GetVisibilityResult> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Unknown runId. Start a new visibility check first.");
    if (run.map) return mapVisibilityResult(run.audit, run.map, run.context);
    const poll = await this.client.getFanoutMap(run.audit.id);
    if (poll.status === "ready") {
      run.map = poll.map;
      return mapVisibilityResult(run.audit, poll.map, run.context);
    }
    return {
      status: "running",
      elapsedSeconds: Math.max(0, Math.floor((this.now() - run.startedAt) / 1000)),
      next: "Poll again in ~20s.",
    };
  }
}

export const visibilityService = new VisibilityService(new HttpAuditClient());
