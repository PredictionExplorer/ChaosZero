import type { Metadata } from "next";
import { IndependentPage } from "@/independent/page";

export const metadata: Metadata = {
  title: "Eight independent markets",
  description:
    "Explore eight recurring Cosmic Signature questions with separate liquidity, inherited starting odds, and protected claims in the local prototype.",
  alternates: { canonical: "/shared" },
  robots: { index: false, follow: false },
};

export default function MarketsPage() {
  return <IndependentPage />;
}
