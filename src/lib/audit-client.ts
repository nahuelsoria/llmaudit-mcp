import type { AuditResponse, FanoutMap } from "./visibility-mapper";

export type FanoutPoll = { status: "running" } | { status: "ready"; map: FanoutMap };

export interface AuditClient {
  startAudit(payload: Record<string, unknown>): Promise<AuditResponse>;
  startFanoutMap(auditId: string): Promise<FanoutPoll>;
  getFanoutMap(auditId: string): Promise<FanoutPoll>;
}

// `source` NO existe como campo de /api/audit: validateAuditInput reconstruye
// el objeto campo por campo y lo descarta en silencio. La atribucion viaja por
// `analytics`, que es de donde prod la lee con normalizeAttributionData.
const AUDIT_FIELDS = ["brand", "website", "category", "competitors", "location", "promptLanguage", "analytics"] as const;

function cleanAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(AUDIT_FIELDS.flatMap((key) => (payload[key] === undefined ? [] : [[key, payload[key]]])));
}

export class HttpAuditClient implements AuditClient {
  private readonly baseUrl: string;
  private readonly clientId: string;

  constructor(baseUrl = process.env.LLMAUDIT_API_BASE_URL ?? "https://llmaudit.app", clientId = "anon") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.clientId = clientId;
  }

  // Sin estos headers prod cuenta por la IP de ESTE servidor, que en serverless
  // rota: el limite deja de existir y cada llamada gasta plata de proveedores.
  // Ver caller-identity.ts en llm-rank-tracker.
  private callerHeaders(): Record<string, string> {
    const key = process.env.MCP_SERVER_KEY?.trim();
    if (!key) return {};
    return { "x-llmaudit-server-key": key, "x-llmaudit-client-id": this.clientId };
  }

  async startAudit(payload: Record<string, unknown>): Promise<AuditResponse> {
    return this.request<AuditResponse>("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json", ...this.callerHeaders() },
      body: JSON.stringify(cleanAuditPayload(payload)),
    });
  }

  async startFanoutMap(auditId: string): Promise<FanoutPoll> {
    return this.mapRequest(auditId, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.callerHeaders() },
      body: JSON.stringify({}),
    });
  }

  async getFanoutMap(auditId: string): Promise<FanoutPoll> {
    return this.mapRequest(auditId, { method: "GET", headers: this.callerHeaders() });
  }

  private async mapRequest(auditId: string, init: RequestInit): Promise<FanoutPoll> {
    const payload = await this.request<{ ok?: boolean; map?: FanoutMap; status?: string }>(
      `/api/audit/${encodeURIComponent(auditId)}/fanout-map`,
      init,
    );
    return payload.map ? { status: "ready", map: payload.map } : { status: "running" };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) throw new Error(`llmaudit request failed with HTTP ${response.status}`);
    return (await response.json()) as T;
  }
}
