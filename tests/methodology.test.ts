import { describe, expect, it } from "vitest";
import methodology, { metadata } from "../src/resources/(llmaudit)/methodology";

describe("llmaudit://methodology", () => {
  it("explica proveedores, preguntas abiertas, mapa medido y las tres bandas en texto plano", () => {
    const text = methodology();
    expect(metadata.mimeType).toBe("text/plain");
    expect(text).toMatch(/OpenAI/i);
    expect(text).toMatch(/Anthropic/i);
    expect(text).toMatch(/Gemini/i);
    expect(text).toMatch(/open question/i);
    expect(text).toMatch(/measured map/i);
    expect(text).toContain("Likely invisible");
    expect(text).toContain("Underspecified in AI search");
    expect(text).toContain("Visible enough to optimize");
    expect(text).not.toMatch(/[—–→]/u);
  });
});
