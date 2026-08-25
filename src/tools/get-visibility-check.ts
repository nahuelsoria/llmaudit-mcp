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
  description: "Get the measured visibility result for a check that has already started. Poll until the result is ready.",
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
