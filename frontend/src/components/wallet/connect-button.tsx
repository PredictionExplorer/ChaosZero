"use client";

import { ChevronDown, LogOut, TriangleAlert, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useChainId, useConnection, useDisconnect, useSwitchChain } from "wagmi";
import { useMounted } from "@/hooks/use-mounted";
import { appConfig } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { LazyWalletModal } from "./lazy-wallet-modal";

/**
 * The single wallet entry point: connect → wrong-network warning → connected
 * menu with disconnect. Renders a stable placeholder before hydration.
 */
export function ConnectButton() {
  const mounted = useMounted();
  const connection = useConnection();
  const chainId = useChainId();
  const switchChain = useSwitchChain();
  const disconnect = useDisconnect();
  const [modalOpen, setModalOpen] = useState(false);
  // Keeps the modal chunk out of first-load JS until the user asks for it.
  const [modalRequested, setModalRequested] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the account menu on any outside click. A fixed-position scrim
  // doesn't work here: the header's backdrop-filter makes it a containing
  // block, so the scrim would only cover the header strip.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [menuOpen]);

  // Below `sm` every state's label is visually hidden (still the accessible
  // name), leaving an icon-sized button: on phones a full-width one would
  // cover the header's nav links. The bet panel's own "Connect wallet to bet"
  // button carries the words there.
  if (!mounted) {
    return (
      <Button variant="outline" disabled>
        <Wallet className="size-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">Connect</span>
      </Button>
    );
  }

  if (connection.status !== "connected") {
    return (
      <>
        <Button
          variant="signal"
          onClick={() => {
            setModalRequested(true);
            setModalOpen(true);
          }}
          loading={connection.status === "reconnecting"}
        >
          <Wallet className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">Connect wallet</span>
        </Button>
        {modalRequested && <LazyWalletModal open={modalOpen} onClose={() => setModalOpen(false)} />}
      </>
    );
  }

  if (chainId !== appConfig.chain.id) {
    return (
      <Button
        variant="ended"
        onClick={() => switchChain.mutate({ chainId: appConfig.chain.id })}
        loading={switchChain.isPending}
      >
        <TriangleAlert className="size-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">Switch to {appConfig.chain.name}</span>
      </Button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button variant="outline" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
        <span className="size-2 rounded-full bg-higher shadow-glow-higher" aria-hidden />
        <span className="sr-only font-mono text-xs sm:not-sr-only">
          {shortAddress(connection.address ?? "")}
        </span>
        <ChevronDown className="size-3.5 text-ink-dim" aria-hidden />
      </Button>
      {menuOpen && (
        <div className="absolute right-0 z-40 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_16px_48px_rgba(2,0,16,0.7)]">
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
            onClick={() => {
              disconnect.mutate({});
              setMenuOpen(false);
            }}
          >
            <LogOut className="size-4" aria-hidden />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
