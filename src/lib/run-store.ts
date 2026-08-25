import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type RunRecord = {
  runId: string;
  auditId: string | null;
  brand: string;
  website: string;
  domain: string;
  clientId: string;
  startedAt: number;
  audit: unknown | null;
};

export interface RunStore {
  // El corte llega absoluto y no como ventana: el reloj lo pone el servicio,
  // asi el store no tiene uno propio que se desincronice con el de arriba.
  findRecentByDomain(domain: string, since: number): Promise<RunRecord | null>;
  countSince(since: number): Promise<number>;
  reserve(run: RunRecord): Promise<void>;
  attachAudit(runId: string, auditId: string, audit: unknown): Promise<void>;
  release(runId: string): Promise<void>;
  get(runId: string): Promise<RunRecord | null>;
}

// El dominio es la llave de la cuota gratis, asi que dos formas de escribir el
// mismo sitio tienen que colapsar en una: con y sin protocolo, con y sin www,
// con path, con mayusculas.
export function normalizeDomain(website: string): string {
  const raw = website.trim().toLowerCase();
  if (!raw) return "";
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();

  async findRecentByDomain(domain: string, since: number): Promise<RunRecord | null> {
    for (const run of this.runs.values()) {
      if (run.domain === domain && run.startedAt >= since) return run;
    }
    return null;
  }

  async countSince(since: number): Promise<number> {
    let total = 0;
    for (const run of this.runs.values()) if (run.startedAt >= since) total += 1;
    return total;
  }

  async reserve(run: RunRecord) {
    this.runs.set(run.runId, { ...run });
  }

  async attachAudit(runId: string, auditId: string, audit: unknown) {
    const run = this.runs.get(runId);
    if (run) this.runs.set(runId, { ...run, auditId, audit });
  }

  async release(runId: string) {
    this.runs.delete(runId);
  }

  async get(runId: string) {
    return this.runs.get(runId) ?? null;
  }
}

// En Vercel cada request puede caer en una instancia distinta, asi que la tabla
// de corridas NO puede vivir en memoria: el poll perderia la corrida que
// arranco otra instancia. Por eso tambien se guarda el audit entero, que no se
// puede volver a pedir (no hay GET /api/audit/:id).
export class SupabaseRunStore implements RunStore {
  constructor(private readonly client: SupabaseClient) {}

  async findRecentByDomain(domain: string, since: number): Promise<RunRecord | null> {
    const cutoff = new Date(since).toISOString();
    const { data } = await this.client
      .from("mcp_runs")
      .select("*")
      .eq("domain", domain)
      .gte("started_at", cutoff)
      .order("started_at", { ascending: false })
      .limit(1);
    const row = data?.[0];
    return row ? toRecord(row) : null;
  }

  async countSince(since: number): Promise<number> {
    const { count } = await this.client
      .from("mcp_runs")
      .select("run_id", { count: "exact", head: true })
      .gte("started_at", new Date(since).toISOString());
    return count ?? 0;
  }

  async reserve(run: RunRecord) {
    const { error } = await this.client.from("mcp_runs").insert({
      run_id: run.runId,
      audit_id: run.auditId,
      brand: run.brand,
      website: run.website,
      domain: run.domain,
      client_id: run.clientId,
      started_at: new Date(run.startedAt).toISOString(),
      audit: run.audit,
    });
    if (error) throw new Error(`could not reserve run: ${error.message}`);
  }

  async attachAudit(runId: string, auditId: string, audit: unknown) {
    await this.client.from("mcp_runs").update({ audit_id: auditId, audit }).eq("run_id", runId);
  }

  async release(runId: string) {
    await this.client.from("mcp_runs").delete().eq("run_id", runId);
  }

  async get(runId: string): Promise<RunRecord | null> {
    const { data } = await this.client.from("mcp_runs").select("*").eq("run_id", runId).limit(1);
    const row = data?.[0];
    return row ? toRecord(row) : null;
  }
}

function toRecord(row: Record<string, unknown>): RunRecord {
  return {
    runId: String(row.run_id),
    auditId: row.audit_id ? String(row.audit_id) : null,
    brand: String(row.brand ?? ""),
    website: String(row.website ?? ""),
    domain: String(row.domain ?? ""),
    clientId: String(row.client_id ?? ""),
    startedAt: new Date(String(row.started_at)).getTime(),
    audit: row.audit ?? null,
  };
}

export function createRunStore(): RunStore {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return new InMemoryRunStore();
  }
  return new SupabaseRunStore(createClient(url, key, { auth: { persistSession: false } }));
}
