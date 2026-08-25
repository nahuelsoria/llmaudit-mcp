import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAuditClient, type AuditClient, type FanoutPoll } from "../src/lib/audit-client";
import { clientIdFromHeaders } from "../src/lib/client-identity";
import { InMemoryRunStore, normalizeDomain } from "../src/lib/run-store";
import { VisibilityService } from "../src/lib/visibility-service";
import type { AuditResponse, FanoutMap } from "../src/lib/visibility-mapper";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), "..", "fixtures", name), "utf8")) as T;
}

const input = { brand: "Picaday", website: "picaday.com.ar", category: "app de diario fotografico" };

class FakeClient implements AuditClient {
  starts = 0;
  failNext = false;
  async startAudit(): Promise<AuditResponse> {
    this.starts += 1;
    if (this.failNext) throw new Error("proveedor caido");
    return fixture<AuditResponse>("audit-picaday.json");
  }
  async startFanoutMap(): Promise<FanoutPoll> {
    return { status: "running" };
  }
  async getFanoutMap(): Promise<FanoutPoll> {
    return { status: "running" };
  }
}

describe("normalizeDomain", () => {
  // Todas estas son el mismo sitio: si no colapsan, la cuota gratis se puede
  // saltear escribiendo el dominio distinto.
  it("colapsa las formas de escribir el mismo dominio", () => {
    for (const raw of ["picaday.com.ar", "www.picaday.com.ar", "https://picaday.com.ar/planes", "PICADAY.com.ar"]) {
      expect(normalizeDomain(raw)).toBe("picaday.com.ar");
    }
  });
});

describe("cuota gratis por dominio", () => {
  function service(store: InMemoryRunStore, client: FakeClient, now = () => 1_000) {
    return new VisibilityService(client, { store, now, newRunId: () => `run-${client.starts}` });
  }

  it("la segunda corrida del mismo dominio no llama a la API", async () => {
    const store = new InMemoryRunStore();
    const client = new FakeClient();
    await service(store, client).start(input);
    const second = await service(store, client).start({ ...input, website: "https://www.picaday.com.ar/contacto" });

    expect(second.status).toBe("quota_reached");
    // Lo que importa: no se gasto plata de proveedores en el segundo pedido.
    expect(client.starts).toBe(1);
  });

  it("pasados 30 dias vuelve a estar disponible", async () => {
    const store = new InMemoryRunStore();
    const client = new FakeClient();
    await service(store, client).start(input);
    const treintaYUnDias = 1_000 + 31 * 24 * 60 * 60 * 1000;
    const later = new VisibilityService(client, { store, now: () => treintaYUnDias, newRunId: () => "run-2" });
    const second = await later.start(input);
    expect(second.status).toBe("running");
  });

  // Si la reserva quedara puesta, un dominio cuya medicion nunca corrio se
  // comeria su cuota de 30 dias por un error del proveedor.
  it("libera la reserva si el audit falla", async () => {
    const store = new InMemoryRunStore();
    const client = new FakeClient();
    client.failNext = true;
    await expect(service(store, client).start(input)).rejects.toThrow(/proveedor caido/);
    expect(await store.findRecentByDomain("picaday.com.ar", 0)).toBeNull();
  });
});

describe("identidad de cliente", () => {
  it("prefiere la sesion MCP y la devuelve hasheada", () => {
    const id = clientIdFromHeaders({ "mcp-session-id": "sesion-a", "x-forwarded-for": "1.2.3.4" });
    expect(id).toHaveLength(32);
    expect(id).not.toContain("sesion-a");
    expect(id).not.toBe(clientIdFromHeaders({ "mcp-session-id": "sesion-b" }));
  });

  it("dos clientes detras de la misma IP no comparten identidad", () => {
    const a = clientIdFromHeaders({ "mcp-session-id": "a", "x-forwarded-for": "1.1.1.1" });
    const b = clientIdFromHeaders({ "mcp-session-id": "b", "x-forwarded-for": "1.1.1.1" });
    expect(a).not.toBe(b);
  });

  it("sin nada que identifique cae a un balde compartido", () => {
    expect(clientIdFromHeaders({})).toBe("anon");
  });
});

describe("headers que manda el cliente HTTP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MCP_SERVER_KEY;
  });

  function capture() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(fixture<AuditResponse>("audit-picaday.json")), { status: 200 });
    });
    return calls;
  }

  it("manda la llave de servidor y la identidad cuando la variable esta seteada", async () => {
    process.env.MCP_SERVER_KEY = "secreto";
    const calls = capture();
    await new HttpAuditClient("https://example.test", "cliente-hash").startAudit({ brand: "a", website: "b", category: "c" });
    const sent = calls[0]?.init?.headers as Record<string, string>;
    expect(sent["x-llmaudit-server-key"]).toBe("secreto");
    expect(sent["x-llmaudit-client-id"]).toBe("cliente-hash");
  });

  // Sin la variable no se manda nada: prod bucketea por IP como siempre y el
  // deploy no cambia ningun comportamiento.
  it("no manda nada si la variable no esta", async () => {
    const calls = capture();
    await new HttpAuditClient("https://example.test", "cliente-hash").startAudit({ brand: "a", website: "b", category: "c" });
    const sent = calls[0]?.init?.headers as Record<string, string>;
    expect(sent["x-llmaudit-server-key"]).toBeUndefined();
    expect(sent["x-llmaudit-client-id"]).toBeUndefined();
  });
});

describe("errores que lee el agente que llama", () => {
  afterEach(() => vi.unstubAllGlobals());

  function respondWith(status: number) {
    vi.stubGlobal("fetch", async () => new Response("{}", { status }));
    return new HttpAuditClient("https://example.test", "c");
  }

  // Un "HTTP 429" pelado no le dice al agente si reintentar o rendirse.
  it("traduce 429 a algo accionable", async () => {
    await expect(respondWith(429).startAudit({ brand: "a", website: "b", category: "c" })).rejects.toThrow(
      /rate limiting.*wait/i,
    );
  });

  it("traduce 503 a que no se aceptan mediciones ahora", async () => {
    await expect(respondWith(503).startAudit({ brand: "a", website: "b", category: "c" })).rejects.toThrow(
      /not accepting free measurements/i,
    );
  });

  it("no filtra el detalle crudo de un 500", async () => {
    await expect(respondWith(500).startAudit({ brand: "a", website: "b", category: "c" })).rejects.toThrow(
      /internal error/i,
    );
  });

  it("una red caida no explota con el error crudo de fetch", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:443");
    });
    await expect(
      new HttpAuditClient("https://example.test", "c").startAudit({ brand: "a", website: "b", category: "c" }),
    ).rejects.toThrow(/could not reach llmaudit/i);
  });
});
