// @vitest-environment node
import { describe, expect, it } from "vitest";
import { OG_ALT, OG_SIZE } from "@/components/seo/og-card";
import * as openGraph from "./opengraph-image";
import * as twitter from "./twitter-image";

/**
 * Next reads each image route's exported `alt`, `size` and `contentType` into
 * the <meta> tags, then calls the default export at build time.
 */
describe.each([
  ["opengraph-image", openGraph],
  ["twitter-image", twitter],
])("%s route", (_name, route) => {
  it("declares the shared card's alt text, size and PNG type", () => {
    expect(route.alt).toBe(OG_ALT);
    expect(route.size).toEqual(OG_SIZE);
    expect(route.contentType).toBe("image/png");
  });

  it("serves the rendered card with the declared content type", async () => {
    const response = await route.default();
    expect(response.headers.get("content-type")).toBe(route.contentType);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }, 30_000);
});

describe("social image routes", () => {
  it("serve byte-identical images, so both networks show the same card", async () => {
    const [og, tw] = await Promise.all([openGraph.default(), twitter.default()]);
    const [ogBytes, twBytes] = await Promise.all([og.arrayBuffer(), tw.arrayBuffer()]);
    expect(Buffer.from(twBytes).equals(Buffer.from(ogBytes))).toBe(true);
  }, 30_000);
});
