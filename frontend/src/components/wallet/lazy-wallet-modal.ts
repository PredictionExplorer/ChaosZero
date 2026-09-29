"use client";

import dynamic from "next/dynamic";

/**
 * The wallet picker, loaded on demand: its chunk (modal UI + connect flow)
 * is not part of the first-load JavaScript. Consumers must only render it
 * once the user first asks to connect.
 */
export const LazyWalletModal = dynamic(
  () => import("./wallet-modal").then((mod) => mod.WalletModal),
  {
    ssr: false,
  },
);
