import { describe, expect, it } from "vitest";
import { FAQ_CATEGORIES } from "@/components/faq/faq-data";
import { SITE_URL } from "./site";
import {
  ORGANIZATION_ID,
  WEBSITE_ID,
  breadcrumbJsonLd,
  faqPageJsonLd,
  organizationJsonLd,
  serializeJsonLd,
  webApplicationJsonLd,
  webSiteJsonLd,
} from "./structured-data";

describe("serializeJsonLd", () => {
  it("escapes < so no payload string can ever close the script tag", () => {
    const out = serializeJsonLd({ name: '</script><script>alert("xss")</script>' });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script");
  });

  it("round-trips through JSON.parse unchanged", () => {
    const data = { "@type": "Thing", name: "a < b", nested: { items: [1, "two"] } };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});

describe("organizationJsonLd", () => {
  it("declares the publisher entity with a stable id and an absolute logo", () => {
    const data = organizationJsonLd();
    expect(data["@type"]).toBe("Organization");
    expect(data["@id"]).toBe(ORGANIZATION_ID);
    expect(data.url).toBe(SITE_URL);
    expect(data.logo).toMatchObject({ "@type": "ImageObject", url: `${SITE_URL}/icon-512.png` });
  });
});

describe("webSiteJsonLd", () => {
  it("declares the site with an absolute URL", () => {
    const data = webSiteJsonLd();
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("WebSite");
    expect(data["@id"]).toBe(WEBSITE_ID);
    expect(data.url).toBe(SITE_URL);
    expect(String(data.url)).toMatch(/^https?:\/\//);
    expect(data.inLanguage).toBe("en");
  });

  it("links the Organization node as its publisher (one graph, not disconnected blobs)", () => {
    expect(webSiteJsonLd().publisher).toEqual({ "@id": ORGANIZATION_ID });
  });
});

describe("webApplicationJsonLd", () => {
  it("describes a free finance app about the Cosmic Signature game", () => {
    const data = webApplicationJsonLd();
    expect(data["@type"]).toBe("WebApplication");
    expect(data.applicationCategory).toBe("FinanceApplication");
    expect(data.offers).toMatchObject({ "@type": "Offer", price: "0" });
    expect(data.about).toMatchObject({
      name: "Cosmic Signature",
      url: "https://cosmicsignature.com",
    });
  });

  it("carries an absolute image and the publisher link", () => {
    const data = webApplicationJsonLd();
    expect(data.image).toBe(`${SITE_URL}/icon-512.png`);
    expect(data.publisher).toEqual({ "@id": ORGANIZATION_ID });
    expect(data.inLanguage).toBe("en");
  });
});

describe("breadcrumbJsonLd", () => {
  it("positions the trail 1..n with absolute item URLs", () => {
    const data = breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "FAQ", path: "/faq" },
    ]);
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "FAQ", item: `${SITE_URL}/faq` },
    ]);
  });
});

describe("faqPageJsonLd", () => {
  const allItems = FAQ_CATEGORIES.flatMap((category) => category.items);
  const data = faqPageJsonLd(allItems);
  const questions = data.mainEntity as Array<{
    "@type": string;
    name: string;
    acceptedAnswer: { "@type": string; text: string };
  }>;

  it("contains one Question per real FAQ item", () => {
    expect(data["@type"]).toBe("FAQPage");
    expect(questions).toHaveLength(allItems.length);
    expect(allItems.length).toBeGreaterThan(10);
  });

  it("carries every question and every answer paragraph verbatim", () => {
    for (const [i, item] of allItems.entries()) {
      const question = questions[i]!;
      expect(question["@type"]).toBe("Question");
      expect(question.name).toBe(item.question);
      expect(question.acceptedAnswer["@type"]).toBe("Answer");
      for (const paragraph of item.answer) {
        expect(question.acceptedAnswer.text).toContain(paragraph);
      }
    }
  });

  it("links to the FAQ page with an absolute URL", () => {
    expect(data.url).toBe(`${SITE_URL}/faq`);
    expect(data.inLanguage).toBe("en");
  });

  it("serializes without unescaped angle brackets", () => {
    expect(serializeJsonLd(data)).not.toContain("<");
  });
});
