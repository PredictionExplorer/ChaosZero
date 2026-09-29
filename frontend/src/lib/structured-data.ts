/**
 * Schema.org JSON-LD builders. Structured data is how search engines and AI
 * crawlers understand the site beyond its visible text: the homepage
 * describes the site and the app, and the FAQ page publishes every question
 * and answer machine-readably even before any JavaScript runs.
 */

import { COSMIC_SIGNATURE_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL, absoluteUrl } from "./site";

export type JsonLd = Record<string, unknown>;

/**
 * Serializes JSON-LD for embedding in a <script> tag. `<` is escaped so no
 * string in the payload can ever open an HTML tag (XSS via `</script>`).
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * Stable node ids linking the homepage's JSON-LD into one graph: the WebSite
 * names the Organization as its publisher, so crawlers see a single publisher
 * entity behind every page rather than disconnected blobs.
 */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** The publisher entity behind the site, with the brand mark as its logo. */
export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/icon-512.png"),
      width: 512,
      height: 512,
    },
  };
}

/** The site itself: who we are and where we live. */
export function webSiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    alternateName: "ChaosZero",
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/** The dapp: a free-to-use finance web application about the Cosmic Signature game. */
export function webApplicationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    image: absoluteUrl("/icon-512.png"),
    publisher: { "@id": ORGANIZATION_ID },
    applicationCategory: "FinanceApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript. A Web3 wallet is needed to place bets.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    about: {
      "@type": "VideoGame",
      name: "Cosmic Signature",
      url: COSMIC_SIGNATURE_URL,
    },
  };
}

export interface BreadcrumbEntry {
  readonly name: string;
  /** Site-relative path ("/", "/faq", …). */
  readonly path: string;
}

/** Positioned breadcrumb trail with absolute URLs, for sub-pages. */
export function breadcrumbJsonLd(trail: readonly BreadcrumbEntry[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: absoluteUrl(entry.path),
    })),
  };
}

export interface FaqEntry {
  readonly question: string;
  /** One entry per paragraph. */
  readonly answer: readonly string[];
}

/** The whole FAQ as a schema.org FAQPage, one Question per item. */
export function faqPageJsonLd(items: readonly FaqEntry[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: absoluteUrl("/faq"),
    inLanguage: "en",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer.join("\n\n"),
      },
    })),
  };
}
