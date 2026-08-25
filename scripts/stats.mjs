#!/usr/bin/env node
// Uso del canal MCP, leido de la tabla mcp_runs.
//
// Existe porque Vercel Web Analytics no puede medir este servidor: no sirve
// HTML y nadie corre su script, ya que cada request es un JSON-RPC de un
// cliente MCP. La tabla de corridas es el unico lugar donde el uso queda
// escrito, y ademas es la que decide las dos cuotas, asi que leerla contesta
// "cuanto queda" y no solo "cuanto se uso".
//
// Vive en scripts/ y no en src/ a proposito: tsconfig solo incluye src/**, asi
// que esto no entra en el bundle de la funcion de Vercel.

import { createClient } from "@supabase/supabase-js";

const BA = "America/Argentina/Buenos_Aires";
const PAGE_SIZE = 1000;

// Ventana de la cuota gratis por dominio, espejo de FREE_QUOTA_WINDOW_MS en
// src/lib/visibility-service.ts.
export const FREE_QUOTA_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Espejo de DEFAULT_MONTHLY_RUN_LIMIT. Un test lo compara contra el original
// para que no se desincronicen.
export const DEFAULT_MONTHLY_RUN_LIMIT = 200;

// Entre reserve() y attachAudit() pasa lo que tarda POST /api/audit, del orden
// de 15 a 60s. Pasado este corte, una fila sin audit_id ya no se va a
// completar: se quedo huerfana.
export const ORPHAN_AFTER_MS = 10 * 60 * 1000;

// Las columnas chicas. NUNCA "*": la fila guarda el audit entero y traerlo para
// contar corridas serian megabytes por nada.
const COLUMNS = "run_id,audit_id,brand,website,domain,client_id,started_at";

function startOfMonthUtc(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function baDate(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BA, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  );
}

function baStamp(ms) {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: BA, month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const t = new Intl.DateTimeFormat("en-GB", {
    timeZone: BA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
  return `${d} ${t}`;
}

// Puro y sin red: recibe las filas crudas de Supabase (snake_case, tal como
// vienen) y devuelve todo lo que se imprime. Los tests lo cubren con filas
// armadas a mano.
export function summarize(rows, { now, limit = DEFAULT_MONTHLY_RUN_LIMIT, days = 14 } = {}) {
  const parsed = rows
    .map((row) => ({ ...row, ts: new Date(String(row.started_at)).getTime() }))
    .filter((row) => Number.isFinite(row.ts))
    .sort((a, b) => a.ts - b.ts);

  // El corte del mes va en UTC porque es el que usa el guard del canal
  // (startOfMonth en visibility-service.ts). Si lo calculara en hora de Buenos
  // Aires, este informe diria "quedan 200" mientras el servidor ya conto las
  // corridas de las ultimas 21 horas del mes anterior.
  const monthStart = startOfMonthUtc(now);
  const monthRows = parsed.filter((row) => row.ts >= monthStart);

  const clients = new Set(monthRows.map((row) => row.client_id));
  const anon = monthRows.filter((row) => row.client_id === "anon").length;

  const daily = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = baDate(now - i * 24 * 60 * 60 * 1000);
    daily.push({ date, runs: parsed.filter((row) => baDate(row.ts) === date).length });
  }

  const byDomain = new Map();
  for (const row of parsed) {
    const seen = byDomain.get(row.domain) ?? { domain: row.domain, runs: 0, lastAt: 0, brand: row.brand };
    seen.runs += 1;
    seen.lastAt = Math.max(seen.lastAt, row.ts);
    seen.brand = row.brand || seen.brand;
    byDomain.set(row.domain, seen);
  }
  const domains = [...byDomain.values()].sort((a, b) => b.runs - a.runs || b.lastAt - a.lastAt);

  // Una fila sin audit_id le sirve a nadie: get_visibility_check tira "Unknown
  // runId" para siempre, y mientras tanto ocupa la cuota de 30 dias del dominio
  // y suma al techo del mes. Es lo unico de este informe sobre lo que hay algo
  // que hacer, asi que va arriba de todo cuando aparece.
  const orphans = parsed.filter((row) => !row.audit_id && now - row.ts > ORPHAN_AFTER_MS);

  const locked = domains.filter((entry) => now - entry.lastAt < FREE_QUOTA_WINDOW_MS);

  return {
    now,
    monthStart,
    monthRuns: monthRows.length,
    limit,
    remaining: Math.max(0, limit - monthRows.length),
    total: parsed.length,
    firstAt: parsed[0]?.ts ?? null,
    lastAt: parsed[parsed.length - 1]?.ts ?? null,
    clients: { unique: clients.size, anon },
    daily,
    domains,
    locked,
    orphans,
    recent: [...parsed].reverse().slice(0, 10),
  };
}

export function render(summary) {
  const out = [];
  const pct = summary.limit > 0 ? Math.round((summary.monthRuns / summary.limit) * 100) : 0;
  const month = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(summary.monthStart),
  );

  out.push("");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  out.push(
    `mcp_runs  ${plural(summary.total, "corrida guardada", "corridas guardadas")}` +
      (summary.lastAt ? `, ultima ${baStamp(summary.lastAt)}` : ""),
  );
  out.push("");

  if (summary.orphans.length > 0) {
    out.push(`REVISAR: ${plural(summary.orphans.length, "corrida huerfana", "corridas huerfanas")}, sin audit_id.`);
    out.push("Ocupan la cuota de 30 dias de su dominio y suman al techo del mes, y el poll");
    out.push("del cliente nunca las va a poder cobrar. Se borran de mcp_runs por run_id.");
    for (const row of summary.orphans.slice(0, 10)) {
      out.push(`  ${baStamp(row.ts)}  ${row.domain}  ${row.run_id}`);
    }
    out.push("");
  }

  out.push(`Techo del canal (${month}, corte UTC como el guard)`);
  out.push(`  ${summary.monthRuns} de ${summary.limit} corridas, ${pct}%. Quedan ${summary.remaining}.`);
  out.push(
    `  ${plural(summary.clients.unique, "cliente distinto", "clientes distintos")} este mes` +
      (summary.clients.anon > 0 ? `, ${plural(summary.clients.anon, "corrida", "corridas")} sin sesion` : ""),
  );
  out.push("");

  const peak = Math.max(1, ...summary.daily.map((day) => day.runs));
  out.push(`Por dia (hora de Buenos Aires, ultimos ${summary.daily.length})`);
  for (const day of summary.daily) {
    const bar = day.runs > 0 ? "#".repeat(Math.max(1, Math.round((day.runs / peak) * 24))) : "";
    out.push(`  ${day.date}  ${String(day.runs).padStart(3)}  ${bar}`.trimEnd());
  }
  out.push("");

  out.push(`Dominios medidos (${summary.domains.length}, ${summary.locked.length} con la cuota gratis tomada)`);
  if (summary.domains.length === 0) {
    out.push("  todavia ninguno");
  }
  for (const entry of summary.domains.slice(0, 15)) {
    const free = summary.locked.includes(entry)
      ? `libre ${baDate(entry.lastAt + FREE_QUOTA_WINDOW_MS)}`
      : "cuota libre";
    out.push(`  ${entry.domain.padEnd(28)} ${String(entry.runs).padStart(3)}  ultima ${baStamp(entry.lastAt)}  ${free}`);
  }
  out.push("");

  if (summary.recent.length > 0) {
    out.push("Ultimas corridas");
    for (const row of summary.recent) {
      out.push(`  ${baStamp(row.ts)}  ${(row.brand || row.domain).padEnd(24)} ${row.client_id.slice(0, 8)}  ${row.audit_id ? "medida" : "SIN AUDIT"}`);
    }
    out.push("");
  }

  return out.join("\n");
}

async function fetchRows(client, since) {
  const rows = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await client
      .from("mcp_runs")
      .select(COLUMNS)
      .gte("started_at", new Date(since).toISOString())
      .order("started_at", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(`mcp_runs: ${error.message}`);
    rows.push(...(data ?? []));
    // Supabase corta en 1000 filas por request y no avisa: sin este loop el
    // informe mentiria por lo bajo en silencio apenas el canal crezca.
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    if (at === -1) return fallback;
    const value = Number(args[at + 1]);
    return Number.isFinite(value) ? value : fallback;
  };
  const days = flag("days", 14);
  const history = flag("history", 90);

  // NEXT_PUBLIC_SUPABASE_URL como fallback: el servidor en Vercel usa
  // SUPABASE_URL, pero el .env que se pasa con --env-file suele venir del
  // dashboard de Supabase, que la exporta con el prefijo NEXT_PUBLIC_.
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Corre:");
    console.error("  node --env-file <archivo.env> scripts/stats.mjs");
    process.exit(1);
  }

  const rawLimit = Number(process.env.MCP_MONTHLY_RUN_LIMIT);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 0 ? Math.floor(rawLimit) : DEFAULT_MONTHLY_RUN_LIMIT;

  const now = Date.now();
  // Siempre desde el arranque del mes UTC para adentro, aunque --history pida
  // menos: el numero contra el techo tiene que ser el mismo que ve el guard.
  const since = Math.min(startOfMonthUtc(now), now - history * 24 * 60 * 60 * 1000);

  const client = createClient(url, key, { auth: { persistSession: false } });
  const rows = await fetchRows(client, since);
  console.log(render(summarize(rows, { now, limit, days })));
}

// Solo corre como CLI; importado desde los tests no toca la red.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
