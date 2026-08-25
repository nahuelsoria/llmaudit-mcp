import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { headers } from "xmcp/headers";
import { clientIdFromHeaders } from "../lib/client-identity";
import { createVisibilityService } from "../lib/visibility-service";

export const schema = {
  runId: z.string().describe("From start_visibility_check"),
};

export const metadata: ToolMetadata = {
  name: "get_visibility_check",
  description:
    "Collect the result of a measurement started with start_visibility_check. Returns status running while the providers are still answering, so poll every 20 to 30 seconds. When ready it reports a verdict, how many of the buyer questions the brand won, which competitors were named instead, and which providers actually answered.",
  annotations: {
    title: "Get visibility check",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export default async function getVisibilityCheck({ runId }: InferSchema<typeof schema>) {
  return JSON.stringify(await createVisibilityService(clientIdFromHeaders(headers())).get(runId));
}
