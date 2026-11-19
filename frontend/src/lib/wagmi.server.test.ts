// @vitest-environment node
import { describe, expect, it } from "vitest";

/**
 * `providers.tsx` is a client component, but Next still renders it on the
 * server, so the wagmi config module is evaluated in Node without `window`.
 */
describe("wagmi config on the server", () => {
  it("builds without touching browser storage", async () => {
    expect(typeof window).toBe("undefined");
    const { wagmiConfig } = await import("./wagmi");

    expect(wagmiConfig.chains.length).toBe(1);
    // Hydrates from cookies/localStorage on the client instead (ssr: true).
    expect(wagmiConfig.state.status).toBe("disconnected");
  });
});
