import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { headers } from "xmcp/headers";
import { clientIdFromHeaders } from "../lib/client-identity";
import { createVisibilityService } from "../lib/visibility-service";

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
  description: "Start a measured check of where a brand appears in buyer questions answered by leading AI providers.",
  annotations: {
    title: "Start visibility check",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export default async function startVisibilityCheck(input: InferSchema<typeof schema>) {
  return JSON.stringify(await createVisibilityService(clientIdFromHeaders(headers())).start(input));
}
