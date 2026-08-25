import { describe, expect, it } from "vitest";
import { DEFAULT_MONTHLY_RUN_LIMIT, FREE_QUOTA_WINDOW_MS } from "../src/lib/visibility-service";
import * as stats from "../scripts/stats.mjs";

const NOW = Date.parse("2026-08-25T12:00:00Z");
const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function run(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "r1",
    audit_id: "a1",
    brand: "Picaday",
    website: "picaday.com.ar",
    domain: "picaday.com.ar",
    client_id: "cliente-uno",
    started_at: new Date(NOW - DAY).toISOString(),
    ...overrides,
  };
}

describe("stats del canal MCP", () => {
  // El script no puede importar los constantes de src/ (es .mjs y ellos son
  // .ts), asi que los copia. Este test es lo que impide que se desincronicen.
  it("no se desincroniza de los limites del servidor", () => {
    expect(stats.DEFAULT_MONTHLY_RUN_LIMIT).toBe(DEFAULT_MONTHLY_RUN_LIMIT);
    expect(stats.FREE_QUOTA_WINDOW_MS).toBe(FREE_QUOTA_WINDOW_MS);
  });

  it("corta el mes en UTC, como el guard, y no en hora de Buenos Aires", () => {
    const summary = stats.summarize(
      [
        // 31/07 20:00 en Buenos Aires, todavia julio para el usuario.
        run({ run_id: "julio", started_at: "2026-07-31T23:00:00Z" }),
        // 31/07 22:00 en Buenos Aires, pero ya agosto para el guard.
        run({ run_id: "agosto", started_at: "2026-08-01T01:00:00Z" }),
      ],
      { now: NOW, limit: 200 },
    );
    expect(summary.total).toBe(2);
    expect(summary.monthRuns).toBe(1);
    expect(summary.remaining).toBe(199);
  });

  it("cuenta clientes distintos del mes y marca los sin sesion", () => {
    const summary = stats.summarize(
      [
        run({ run_id: "a", client_id: "uno" }),
        run({ run_id: "b", client_id: "uno" }),
        run({ run_id: "c", client_id: "dos" }),
        run({ run_id: "d", client_id: "anon" }),
      ],
      { now: NOW },
    );
    expect(summary.clients).toEqual({ unique: 3, anon: 1 });
  });

  it("llama huerfana a la reserva sin audit_id, pero no a la que recien arranco", () => {
    const summary = stats.summarize(
      [
        run({ run_id: "colgada", audit_id: null, started_at: new Date(NOW - 30 * MIN).toISOString() }),
        run({ run_id: "corriendo", audit_id: null, started_at: new Date(NOW - 2 * MIN).toISOString() }),
        run({ run_id: "sana" }),
      ],
      { now: NOW },
    );
    expect(summary.orphans.map((row: { run_id: string }) => row.run_id)).toEqual(["colgada"]);
  });

  it("marca que dominios tienen tomada la cuota gratis de 30 dias", () => {
    const summary = stats.summarize(
      [
        run({ run_id: "vieja", domain: "vieja.com", started_at: new Date(NOW - 40 * DAY).toISOString() }),
        run({ run_id: "fresca", domain: "fresca.com", started_at: new Date(NOW - 3 * DAY).toISOString() }),
      ],
      { now: NOW },
    );
    expect(summary.domains).toHaveLength(2);
    expect(summary.locked.map((entry: { domain: string }) => entry.domain)).toEqual(["fresca.com"]);
  });

  it("agrupa por dia de Buenos Aires y rellena los dias sin corridas", () => {
    const summary = stats.summarize([run({ started_at: "2026-08-25T02:00:00Z" })], { now: NOW, days: 3 });
    expect(summary.daily).toHaveLength(3);
    // 25/08 02:00 UTC es todavia el 24/08 a las 23:00 en Buenos Aires.
    expect(summary.daily).toEqual([
      { date: "2026-08-23", runs: 0 },
      { date: "2026-08-24", runs: 1 },
      { date: "2026-08-25", runs: 0 },
    ]);
  });

  it("imprime sin explotar cuando la tabla esta vacia", () => {
    const text = stats.render(stats.summarize([], { now: NOW }));
    expect(text).toContain("0 de 200");
    expect(text).toContain("todavia ninguno");
  });
});
