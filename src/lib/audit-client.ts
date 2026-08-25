import type { AuditResponse, FanoutMap } from "./visibility-mapper";

export type FanoutPoll = { status: "running" } | { status: "ready"; map: FanoutMap };

export interface AuditClient {
  startAudit(payload: Record<string, unknown>): Promise<AuditResponse>;
  startFanoutMap(auditId: string): Promise<FanoutPoll>;
  getFanoutMap(auditId: string): Promise<FanoutPoll>;
}

const AUDIT_FIELDS = ["brand", "website", "category", "competitors", "location", "promptLanguage", "source"] as const;

function cleanAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(AUDIT_FIELDS.flatMap((key) => (payload[key] === undefined ? [] : [[key, payload[key]]])));
}

export class HttpAuditClient implements AuditClient {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.LLMAUDIT_API_BASE_URL ?? "https://llmaudit.app") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async startAudit(payload: Record<string, unknown>): Promise<AuditResponse> {
    return this.request<AuditResponse>("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cleanAuditPayload(payload)),
    });
  }

  async startFanoutMap(auditId: string): Promise<FanoutPoll> {
    return this.mapRequest(auditId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  }

  async getFanoutMap(auditId: string): Promise<FanoutPoll> {
    return this.mapRequest(auditId, { method: "GET" });
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
