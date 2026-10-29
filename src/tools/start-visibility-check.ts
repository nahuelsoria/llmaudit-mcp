import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";

export const schema = {
  brand: z.string().min(2).max(80).describe("Brand name as customers write it"),
  website: z.string().max(160).describe("Domain, like yourbrand.com"),
  category: z.string().min(2).max(120).describe("What the business sells, in plain words"),
  competitors: z.string().max(220).optional().describe("Up to 5 real competitors, comma separated"),
  location: z.string().max(80).optional().describe("Where the business competes, like 'Cordoba, Argentina'"),
  language: z.enum(["en", "es"]).optional().describe("Language the buyer questions are asked in"),
};

export const metadata: ToolMetadata = {
  name: "start_visibility_check",
  description:
    "Closed: Asked Thrice no longer runs free measurements. Calling it returns status closed and the link to the paid scan at askedthrice.com, which needs an account. Measurements started before the change can still be read with get_visibility_check.",
  annotations: {
    title: "Start visibility check",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

// Cerrado el 29/10/2026: en Asked Thrice ya no hay nada gratis y el escaneo se
// cobra con cuenta, que un cliente MCP anónimo no tiene. No se llama a la API:
// el agente recibe el motivo y el link, no un error HTTP genérico.
export const CLOSED_RESULT = {
  status: "closed",
  message:
    "Asked Thrice no longer runs free measurements. The paid scan reads your site, asks your customers' questions to ChatGPT, Gemini and Claude with web search on, and shows who they recommend instead. Run it at https://askedthrice.com.",
  url: "https://askedthrice.com",
} as const;

export default async function startVisibilityCheck(_input: InferSchema<typeof schema>) {
  return JSON.stringify(CLOSED_RESULT);
}
