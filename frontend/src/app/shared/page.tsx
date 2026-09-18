import type { Metadata } from "next";
import { SharedPage } from "@/shared/shared-page";

export const metadata: Metadata = {
  title: "Eight shared markets",
  description:
    "Explore eight recurring Cosmic Signature questions backed by one shared pool in the local Chaos Zero prototype.",
  alternates: { canonical: "/shared" },
  robots: { index: false, follow: false },
};

export default SharedPage;
