import type { Metadata } from "next";
import Link from "next/link";
import { appConfig, COSMIC_CST_ADDRESS } from "@/lib/config";
import { SITE_NAME } from "@/lib/site";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/structured-data";
import { FAQ_CATEGORIES } from "@/components/faq/faq-data";
import { FaqContent } from "@/components/faq/faq-content";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { JsonLd } from "@/components/seo/json-ld";

const TITLE = "FAQ";
const DESCRIPTION =
  "How Chaos Zero works: placing YES/NO bets on Cosmic Signature rounds, how odds and fees form, round resolution, liquidity provision, and the safety model.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/faq",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: "/faq",
    title: `${TITLE} — ${SITE_NAME}`,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} — ${SITE_NAME}`,
    description: DESCRIPTION,
  },
};

/**
 * The FAQ ships zero wallet JavaScript: the header gets a plain CTA back to
 * the market instead of the connect button, and every answer is in the
 * server-rendered HTML (plus machine-readable FAQPage JSON-LD below).
 */
export default function FaqPage() {
  return (
    <>
      <Header
        active="faq"
        actions={
          // Hidden below `sm`, where it would cover the nav links; the
          // "Market" nav link right beside it goes to the same place.
          <Link
            href="/"
            className="hidden h-9 items-center justify-center rounded-xl bg-signal px-4 text-sm font-semibold text-void shadow-glow-signal transition-all hover:bg-signal-bright sm:inline-flex"
          >
            Open the market
          </Link>
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <FaqContent />
      </main>
      <Footer marketAddress={appConfig.marketAddress} cstAddress={COSMIC_CST_ADDRESS} />
      <JsonLd data={faqPageJsonLd(FAQ_CATEGORIES.flatMap((category) => category.items))} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ])}
      />
    </>
  );
}
