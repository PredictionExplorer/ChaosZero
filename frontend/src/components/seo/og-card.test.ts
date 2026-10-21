import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OG_ALT, OG_SIZE } from "./og-card";

describe("social share card", () => {
  it("uses the canonical Open Graph dimensions", () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it("has alt text that names the brand and explains the market", () => {
    expect(OG_ALT).toMatch(/chaos zero/i);
    expect(OG_ALT).toMatch(/cosmic signature/i);
    expect(OG_ALT).toMatch(/YES\/NO/);
    expect(OG_ALT).toMatch(/eight independent/i);
  });

  it("ships the display font it renders with", () => {
    expect(existsSync(join(process.cwd(), "src/assets/fonts/SpaceGrotesk-Bold.ttf"))).toBe(true);
  });
});
