import type { Metadata } from "next";
import { IndependentPage } from "@/independent/page";

export const metadata: Metadata = {
  title: "Eight independent markets",
  description:
    "Explore eight recurring Cosmic Signature questions with separate liquidity, 50/50 opening odds, and protected claims on Arbitrum One.",
  alternates: { canonical: "/shared" },
  robots: { index: false, follow: false },
};

export default function MarketsPage() {
  return <IndependentPage />;
}
