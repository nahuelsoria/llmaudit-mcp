import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpAuditClient, type AuditClient, type FanoutPoll } from "../src/lib/audit-client";
import { VisibilityService } from "../src/lib/visibility-service";
import { schema as startSchema } from "../src/tools/start-visibility-check";
import type { AuditResponse, FanoutMap } from "../src/lib/visibility-mapper";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), "..", "fixtures", name), "utf8")) as T;
}

const input = {
  brand: "Picaday",
  website: "picaday.com.ar",
  category: "app de diario fotografico",
  competitors: "Aon, Marsh",
  location: "Buenos Aires, Argentina",
  language: "es" as const,
};

class FakeClient implements AuditClient {
  readonly starts: Array<Record<string, unknown>> = [];
  readonly posts: string[] = [];
  readonly gets: string[] = [];
  poll: FanoutPoll = { status: "running" };

  async startAudit(payload: Record<string, unknown>): Promise<AuditResponse> {
    this.starts.push(payload);
    return fixture<AuditResponse>("audit-picaday.json");
  }

  async startFanoutMap(auditId: string): Promise<FanoutPoll> {
    this.posts.push(auditId);
    return { status: "running" };
  }

  async getFanoutMap(auditId: string): Promise<FanoutPoll> {
    this.gets.push(auditId);
    return this.poll;
  }
}

describe("schema y servicio", () => {
  it("descarta email aunque el cliente lo mande", () => {
    const parsed = z.object(startSchema).parse({ ...input, email: "thirdparty@example.com" });
    expect(parsed).toEqual(input);
    expect(Object.keys(startSchema)).not.toContain("email");
  });

  it("inicia el audit sin email y devuelve el contrato exacto", async () => {
    const client = new FakeClient();
    const service = new VisibilityService(client, { now: () => 1_000, newRunId: () => "run-1" });
    const result = await service.start({ ...input, email: "thirdparty@example.com" } as typeof input & { email: string });

    expect(result).toEqual({
      runId: "run-1",
      status: "running",
      etaSeconds: 75,
      next: "Call get_visibility_check with this runId. Wait ~30s between polls.",
    });
    expect(client.starts).toEqual([
      {
        brand: input.brand,
        website: input.website,
        category: input.category,
        competitors: input.competitors,
        location: input.location,
        promptLanguage: "es",
        analytics: {
          sessionId: "anon",
          utmSource: "mcp",
          utmMedium: "mcp",
          utmCampaign: "mcp-visibility-check",
        },
      },
    ]);
    expect(JSON.stringify(client.starts)).not.toContain("email");
    await vi.waitFor(() => expect(client.posts).toHaveLength(1));
  });

  it("devuelve running con tiempo transcurrido y luego el resultado listo", async () => {
    const client = new FakeClient();
    let now = 1_000;
    const service = new VisibilityService(client, { now: () => now, newRunId: () => "run-1" });
    await service.start(input);
    now = 43_500;

    expect(await service.get("run-1")).toEqual({ status: "running", elapsedSeconds: 42, next: "Poll again in ~20s." });

    client.poll = { status: "ready", map: fixture<{ map: FanoutMap }>("map-picaday.json").map };
    const result = await service.get("run-1");
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.brand).toBe("Picaday");
      expect(result.website).toBe("picaday.com.ar");
    }
  });

  it("rechaza un runId desconocido sin hacer red", async () => {
    const client = new FakeClient();
    const service = new VisibilityService(client);
    await expect(service.get("missing")).rejects.toThrow(/unknown runId/i);
    expect(client.gets).toEqual([]);
  });
});

describe("HttpAuditClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("implementa los tres requests HTTP requeridos y limpia el body de audit", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const audit = fixture<AuditResponse>("audit-picaday.json");
    const map = fixture<{ map: FanoutMap }>("map-picaday.json").map;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const body = calls.length === 1 ? audit : { ok: true, map };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpAuditClient("https://example.test/");

    await client.startAudit({ ...input, email: "strip-me@example.com" });
    await client.startFanoutMap(audit.id);
    await client.getFanoutMap(audit.id);

    expect(calls.map(({ url, init }) => [url, init?.method])).toEqual([
      ["https://example.test/api/audit", "POST"],
      [`https://example.test/api/audit/${audit.id}/fanout-map`, "POST"],
      [`https://example.test/api/audit/${audit.id}/fanout-map`, "GET"],
    ]);
    const auditBody = JSON.parse(String(calls[0]?.init?.body));
    expect(auditBody).not.toHaveProperty("email");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({});
  });
});
