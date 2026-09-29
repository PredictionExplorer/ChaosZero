// @vitest-environment node
// (Satori and resvg render in Node at build time; no DOM is involved.)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OG_ALT, OG_SIZE, ogCardResponse } from "./og-card";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("social share card", () => {
  it("uses the canonical Open Graph dimensions", () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it("has alt text that names the brand and explains the market", () => {
    expect(OG_ALT).toMatch(/chaos zero/i);
    expect(OG_ALT).toMatch(/cosmic signature/i);
    expect(OG_ALT).toMatch(/YES or NO/);
    expect(OG_ALT).toMatch(/gestures/i);
  });

  it("ships the display font it renders with", () => {
    expect(existsSync(join(process.cwd(), "src/assets/fonts/SpaceGrotesk-Bold.ttf"))).toBe(true);
  });

  /**
   * Renders the real card through next/og (Satori + resvg), exactly as the
   * build does, so a broken layout, a missing font, or a style Satori does
   * not support fails here instead of at `next build`.
   */
  it("renders a PNG at the canonical Open Graph size", async () => {
    const response = await ogCardResponse();
    expect(response.headers.get("content-type")).toBe("image/png");

    const png = new Uint8Array(await response.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    // IHDR is the first chunk: width and height are big-endian u32s at bytes 16..23.
    const header = new DataView(png.buffer, png.byteOffset + 16, 8);
    expect({ width: header.getUint32(0), height: header.getUint32(4) }).toEqual(OG_SIZE);
    // A real picture, not an empty canvas: text and gradients carry weight.
    expect(png.byteLength).toBeGreaterThan(20_000);
  }, 30_000);
});
