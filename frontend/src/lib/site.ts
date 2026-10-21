/**
 * Canonical site identity: the single source of truth for the absolute site
 * URL, names, and descriptions used across metadata, Open Graph cards,
 * JSON-LD, the sitemap, robots.txt, and the web app manifest.
 *
 * `NEXT_PUBLIC_SITE_URL` overrides the production default so preview
 * deployments emit self-consistent absolute URLs.
 */

export const SITE_NAME = "Chaos Zero";

/** The homepage <title> and social card headline. */
export const SITE_TITLE = "Chaos Zero — Eight questions. Your conviction.";

/** One-line pitch for social cards and the manifest. */
export const SITE_TAGLINE = "Eight independent markets. One unpredictable game.";

export const SITE_DESCRIPTION =
  "Eight independent YES/NO markets on Cosmic Signature V3. Trade with CST on Arbitrum One, with separate question pools, 50/50 opening odds and 1 CST per winning share.";

export const SITE_KEYWORDS = [
  "Chaos Zero",
  "chaos zero",
  "prediction market",
  "Cosmic Signature",
  "CST token",
  "Arbitrum One",
  "on-chain betting",
  "crypto prediction market",
  "NFT game",
  "binary market",
] as const;

/** The Cosmic Signature game site this market is built on. */
export const COSMIC_SIGNATURE_URL = "https://cosmicsignature.com";

const DEFAULT_SITE_URL = "https://chaoszero.com";

/**
 * Parses and normalizes the site origin. Absent input falls back to the
 * production domain; present-but-malformed input throws at startup rather
 * than silently emitting broken canonical URLs everywhere.
 */
export function parseSiteUrl(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_SITE_URL;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`NEXT_PUBLIC_SITE_URL is not a valid URL: "${trimmed}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`NEXT_PUBLIC_SITE_URL must be http(s), got "${trimmed}"`);
  }
  return url.origin;
}

/** The site origin, without a trailing slash (e.g. "https://chaoszero.com"). */
export const SITE_URL = parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

/** Turns a site-relative path into an absolute URL for sitemaps and JSON-LD. */
export function absoluteUrl(path: string, base: string = SITE_URL): string {
  if (!path.startsWith("/")) {
    throw new Error(`absoluteUrl expects a site-relative path starting with "/", got "${path}"`);
  }
  return path === "/" ? base : `${base}${path}`;
}
