import { describe, expect, it } from "vitest";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL, absoluteUrl, parseSiteUrl } from "./site";

describe("parseSiteUrl", () => {
  it("falls back to the production domain when unset or blank", () => {
    expect(parseSiteUrl(undefined)).toBe("https://chaoszero.com");
    expect(parseSiteUrl("")).toBe("https://chaoszero.com");
    expect(parseSiteUrl("   ")).toBe("https://chaoszero.com");
  });

  it("normalizes to the origin, dropping trailing slashes and paths", () => {
    expect(parseSiteUrl("https://chaoszero.com/")).toBe("https://chaoszero.com");
    expect(parseSiteUrl("https://preview.example.com/some/path")).toBe(
      "https://preview.example.com",
    );
  });

  it("keeps explicit ports (local previews)", () => {
    expect(parseSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("rejects malformed URLs loudly instead of emitting broken canonicals", () => {
    expect(() => parseSiteUrl("not a url")).toThrow(/not a valid URL/);
    expect(() => parseSiteUrl("ftp://example.com")).toThrow(/http/);
  });
});

describe("absoluteUrl", () => {
  it("returns the bare origin for the root path", () => {
    expect(absoluteUrl("/", "https://example.com")).toBe("https://example.com");
  });

  it("appends site-relative paths to the origin", () => {
    expect(absoluteUrl("/faq", "https://example.com")).toBe("https://example.com/faq");
  });

  it("defaults to the configured site URL", () => {
    expect(absoluteUrl("/faq")).toBe(`${SITE_URL}/faq`);
  });

  it("rejects non-relative inputs so nobody builds double-origin URLs", () => {
    expect(() => absoluteUrl("faq")).toThrow(/site-relative/);
    expect(() => absoluteUrl("https://example.com/faq")).toThrow(/site-relative/);
  });
});

describe("site copy", () => {
  it("leads with the brand and the game it is built on", () => {
    expect(SITE_TITLE).toMatch(/chaos zero/i);
    expect(SITE_TITLE).toMatch(/cosmic signature/i);
  });

  it("describes the actual mechanism: YES/NO on gesture counts", () => {
    expect(SITE_DESCRIPTION).toMatch(/gestures/i);
    expect(SITE_DESCRIPTION).toMatch(/YES or NO/);
    // The market is binary; the old "scalar / HIGHER or LOWER" copy was wrong.
    expect(SITE_DESCRIPTION).not.toMatch(/scalar|higher or lower/i);
  });
});
