import { randomUUID } from "node:crypto";
import { type AuditClient, HttpAuditClient } from "./audit-client";
import { createRunStore, normalizeDomain, type RunStore } from "./run-store";
import { mapVisibilityResult, type AuditResponse, type FanoutMap, type VisibilityReadyResult } from "./visibility-mapper";

export const FREE_QUOTA_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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

export type QuotaBlockedResult = {
  status: "quota_reached";
  domain: string;
  measuredAt: string;
  message: string;
  upgrade: { fullReportUsd: number; lifetimeUsd: number; url: string };
};

export type RunningVisibilityResult = {
  status: "running";
  elapsedSeconds: number;
  next: "Poll again in ~20s.";
};

export type GetVisibilityResult = RunningVisibilityResult | VisibilityReadyResult;

type ServiceOptions = { now?: () => number; newRunId?: () => string; store?: RunStore; clientId?: string };

function auditPayload(input: StartVisibilityInput, clientId: string): Record<string, unknown> {
  return {
    brand: input.brand,
    website: input.website,
    category: input.category,
    ...(input.competitors === undefined ? {} : { competitors: input.competitors }),
    ...(input.location === undefined ? {} : { location: input.location }),
    ...(input.language === undefined ? {} : { promptLanguage: input.language }),
    // Sin esto el canal MCP no se puede separar del funnel web en el embudo, y
    // el experimento entero queda sin forma de medirse.
    analytics: {
      sessionId: clientId,
      utmSource: "mcp",
      utmMedium: "mcp",
      utmCampaign: "mcp-visibility-check",
    },
  };
}

export class VisibilityService {
  private readonly now: () => number;
  private readonly newRunId: () => string;
  private readonly store: RunStore;
  private readonly clientId: string;

  constructor(
    private readonly client: AuditClient,
    options: ServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.newRunId = options.newRunId ?? randomUUID;
    this.store = options.store ?? createRunStore();
    this.clientId = options.clientId ?? "anon";
  }

  async start(input: StartVisibilityInput): Promise<StartVisibilityResult | QuotaBlockedResult> {
    const domain = normalizeDomain(input.website);

    // La cuota se chequea ANTES de llamar a /api/audit: un servidor MCP publico
    // es un llamador sin techo y cada corrida gasta plata de proveedores. Que
    // el chequeo y la reserva no sean atomicos deja una carrera posible entre
    // dos pedidos simultaneos del MISMO dominio; el costo de esa carrera es
    // una corrida de mas, acotado, y cerrarlo del todo pedia un indice que la
    // ventana movil de 30 dias no permite expresar.
    const previous = await this.store.findRecentByDomain(domain, this.now() - FREE_QUOTA_WINDOW_MS);
    if (previous) {
      return {
        status: "quota_reached",
        domain,
        measuredAt: new Date(previous.startedAt).toISOString(),
        message: `${domain} was already measured for free in the last 30 days. Re-measuring is a paid run.`,
        upgrade: UPGRADE,
      };
    }

    const runId = this.newRunId();
    await this.store.reserve({
      runId,
      auditId: null,
      brand: input.brand,
      website: input.website,
      domain,
      clientId: this.clientId,
      startedAt: this.now(),
      audit: null,
    });

    let audit: AuditResponse;
    try {
      audit = await this.client.startAudit(auditPayload(input, this.clientId));
    } catch (error) {
      // La reserva no puede quedar consumiendo la cuota de un dominio cuya
      // medicion nunca corrio.
      await this.store.release(runId);
      throw error;
    }

    await this.store.attachAudit(runId, audit.id, audit);
    void this.client.startFanoutMap(audit.id).catch(() => undefined);

    return {
      runId,
      status: "running",
      etaSeconds: 75,
      next: "Call get_visibility_check with this runId. Wait ~30s between polls.",
    };
  }

  async get(runId: string): Promise<GetVisibilityResult> {
    const run = await this.store.get(runId);
    if (!run || !run.auditId || !run.audit) {
      throw new Error("Unknown runId. Start a new visibility check first.");
    }

    const poll = await this.client.getFanoutMap(run.auditId);
    if (poll.status === "ready") {
      return this.ready(run.audit as AuditResponse, poll.map, run);
    }

    return {
      status: "running",
      elapsedSeconds: Math.max(0, Math.floor((this.now() - run.startedAt) / 1000)),
      next: "Poll again in ~20s.",
    };
  }

  private ready(audit: AuditResponse, map: FanoutMap, run: { brand: string; website: string }): VisibilityReadyResult {
    return mapVisibilityResult(audit, map, { brand: run.brand, website: run.website });
  }
}

const UPGRADE = { fullReportUsd: 9, lifetimeUsd: 29.99, url: "https://llmaudit.app/pricing" };

export function createVisibilityService(clientId: string): VisibilityService {
  return new VisibilityService(new HttpAuditClient(undefined, clientId), { clientId });
}
