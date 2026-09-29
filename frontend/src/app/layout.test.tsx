import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import manifest from "./manifest";

// next/font is resolved by the Next compiler; at test time each font is just
// the CSS variable class it contributes.
vi.mock("next/font/google", () => {
  const font = (variable: string) => () => ({ variable, className: variable, style: { fontFamily: variable } });
  return {
    Geist: font("font-geist-sans"),
    Geist_Mono: font("font-geist-mono"),
    Space_Grotesk: font("font-space-grotesk"),
  };
});

/** Imports the layout fresh, so module-level metadata sees the current env. */
async function loadLayout() {
  vi.resetModules();
  return import("./layout");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION", "");
  vi.stubEnv("NEXT_PUBLIC_BING_SITE_VERIFICATION", "");
});

describe("root metadata", () => {
  it("anchors every URL at the canonical origin and names the site", async () => {
    const { metadata } = await loadLayout();

    expect(metadata.metadataBase?.toString()).toBe(new URL(SITE_URL).toString());
    expect(metadata.alternates?.canonical).toBe("/");
    expect(metadata.title).toEqual({ default: SITE_TITLE, template: `%s — ${SITE_NAME}` });
    expect(metadata.applicationName).toBe(SITE_NAME);
  });

  it("invites indexing, with large previews", async () => {
    const { metadata } = await loadLayout();

    expect(metadata.robots).toMatchObject({
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    });
  });

  it("shares as a large summary card on social networks", async () => {
    const { metadata } = await loadLayout();

    expect(metadata.openGraph).toMatchObject({ type: "website", siteName: SITE_NAME, url: "/" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: SITE_TITLE });
  });

  it("paints the browser chrome in the manifest's theme color", async () => {
    const { viewport } = await loadLayout();

    expect(viewport.themeColor).toBe(manifest().theme_color);
    expect(viewport.colorScheme).toBe("dark");
  });
});

describe("search-console verification", () => {
  it("emits no verification tags unless the deployment provides them", async () => {
    const { metadata } = await loadLayout();
    expect(metadata.verification).toBeUndefined();
  });

  it("ignores whitespace-only tokens", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION", "   ");
    vi.stubEnv("NEXT_PUBLIC_BING_SITE_VERIFICATION", "\t");
    const { metadata } = await loadLayout();
    expect(metadata.verification).toBeUndefined();
  });

  it("verifies with Google Search Console", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION", " google-token ");
    const { metadata } = await loadLayout();
    expect(metadata.verification).toEqual({ google: "google-token" });
  });

  it("verifies with Bing Webmaster Tools via msvalidate.01", async () => {
    vi.stubEnv("NEXT_PUBLIC_BING_SITE_VERIFICATION", "bing-token");
    const { metadata } = await loadLayout();
    expect(metadata.verification).toEqual({ other: { "msvalidate.01": "bing-token" } });
  });

  it("verifies with both at once", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION", "google-token");
    vi.stubEnv("NEXT_PUBLIC_BING_SITE_VERIFICATION", "bing-token");
    const { metadata } = await loadLayout();
    expect(metadata.verification).toEqual({ google: "google-token", other: { "msvalidate.01": "bing-token" } });
  });
});

describe("RootLayout", () => {
  it("renders an English document with the font variables and the page inside", async () => {
    const { default: RootLayout } = await loadLayout();
    const html = renderToStaticMarkup(
      <RootLayout>
        <main>page content</main>
      </RootLayout>,
    );

    expect(html).toMatch(/^<html lang="en"/);
    for (const variable of ["font-geist-sans", "font-geist-mono", "font-space-grotesk"]) {
      expect(html).toContain(variable);
    }
    expect(html).toContain('<div class="starfield" aria-hidden="true"></div>');
    expect(html).toContain("<main>page content</main>");
  });
});
