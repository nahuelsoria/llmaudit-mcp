import { createHash } from "node:crypto";

// Quien esta llamando, para que prod pueda contar por cliente y no por la IP
// del propio servidor MCP. Se manda hasheado: prod no necesita saber la sesion
// real y no queremos que quede escrita en sus logs.
export function clientIdFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  const read = (name: string) => {
    const value = headers[name];
    const single = Array.isArray(value) ? value[0] : value;
    return single?.trim() || "";
  };

  // El transporte HTTP de MCP asigna una sesion por cliente; es la identidad
  // mas fiel que tenemos. Los dos fallbacks existen para no colapsar todo a un
  // unico balde cuando el cliente no manda sesion.
  const seed = read("mcp-session-id") || read("authorization") || read("x-forwarded-for").split(",")[0]?.trim() || "";
  if (!seed) {
    return "anon";
  }
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}
