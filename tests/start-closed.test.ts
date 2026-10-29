import { describe, expect, it, vi } from "vitest";

vi.mock("xmcp", () => ({}));
const { default: startVisibilityCheck, CLOSED_RESULT } = await import("../src/tools/start-visibility-check");

// Desde el 29/10/2026 la medición gratis está cerrada: la tool no llama a la API.
describe("start_visibility_check cerrada", () => {
  it("devuelve closed con el link al escaneo, sin hacer fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = JSON.parse(await startVisibilityCheck({ brand: "Acme", website: "acme.com", category: "crm" }));
    expect(out).toEqual(CLOSED_RESULT);
    expect(out.url).toBe("https://askedthrice.com");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
