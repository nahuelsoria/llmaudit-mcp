import { type ResourceMetadata } from "xmcp";

export const metadata: ResourceMetadata = {
  name: "askedthrice-methodology",
  title: "askedthrice methodology",
  description: "How askedthrice measures brand visibility in AI answers",
  mimeType: "text/plain",
};

export default function methodology() {
  return [
    "askedthrice measures whether a brand appears when buyers ask open questions to OpenAI, Anthropic, and Gemini.",
    "An open question does not name the brand or its domain. A mention there measures recommendation. A question that already names the brand measures recall, so it is not included in the headline counts or verdict.",
    "The result comes from the measured map of actual answers. It does not use each provider's self report about which brands it believes it would mention.",
    "Only cells that answered count toward the verdict. If too few open cells answer, the result has no verdict. Providers that returned only errors are listed as missing.",
    "Likely invisible means the brand appeared only rarely in answered open cells.",
    "Underspecified in AI search means the brand appeared sometimes, but in less than half of answered open cells.",
    "Visible enough to optimize means the brand appeared in at least half of answered open cells.",
  ].join("\n\n");
}
