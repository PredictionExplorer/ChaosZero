import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/lib/site";
import manifest from "./manifest";
import robots, { AI_CRAWLERS } from "./robots";
import sitemap from "./sitemap";

const PUBLIC_DIR = join(process.cwd(), "public");

describe("robots.txt", () => {
  const data = robots();

  it("allows every crawler everywhere (the whole site is public)", () => {
    expect(data.rules).toContainEqual({ userAgent: "*", allow: "/" });
  });

  it("welcomes the AI crawlers by name", () => {
    expect(data.rules).toContainEqual({ userAgent: [...AI_CRAWLERS], allow: "/" });
    // The big three answer engines must stay on the list.
    expect(AI_CRAWLERS).toContain("GPTBot");
    expect(AI_CRAWLERS).toContain("ClaudeBot");
    expect(AI_CRAWLERS).toContain("PerplexityBot");
  });

  it("never disallows anything", () => {
    const rules = Array.isArray(data.rules) ? data.rules : [data.rules];
    for (const rule of rules) {
      expect(rule).not.toHaveProperty("disallow");
    }
  });

  it("points crawlers at the sitemap with an absolute URL", () => {
    expect(data.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe("sitemap.xml", () => {
  const entries = sitemap();

  it("lists exactly the two routes with absolute URLs", () => {
    expect(entries.map((e) => e.url)).toEqual([SITE_URL, `${SITE_URL}/faq`]);
    for (const entry of entries) {
      expect(entry.url).toMatch(/^https?:\/\//);
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
  });

  it("ranks the live market above the FAQ", () => {
    const [home, faq] = entries;
    expect(home!.priority).toBe(1);
    expect(faq!.priority).toBeLessThan(1);
  });
});

describe("manifest", () => {
  const data = manifest();

  it("matches the void theme", () => {
    expect(data.theme_color).toBe("#060a10");
    expect(data.background_color).toBe("#060a10");
    expect(data.display).toBe("standalone");
  });

  it("references only icons that actually exist in public/", () => {
    expect(data.icons?.length).toBeGreaterThanOrEqual(3);
    for (const icon of data.icons ?? []) {
      expect(icon.src.startsWith("/")).toBe(true);
      expect(
        existsSync(join(PUBLIC_DIR, icon.src)),
        `${icon.src} missing — run \`pnpm icons\``,
      ).toBe(true);
    }
  });

  it("includes a maskable icon for Android launchers", () => {
    expect(data.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
  });
});
