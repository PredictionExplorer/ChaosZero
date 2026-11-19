"use client";

import { AnimatePresence, m } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Wallet, X } from "lucide-react";
import type { Connector } from "wagmi";
import { useConnect, useConnectors } from "wagmi";
import { useMounted } from "@/hooks/use-mounted";
import { describeTxError } from "@/lib/errors";

interface WalletModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Wallet picker over wagmi's EIP-6963 discovery: every injected wallet the
 * browser exposes (MetaMask, Rabby, Coinbase…) appears automatically, plus
 * WalletConnect when configured.
 */
export function WalletModal({ open, onClose }: WalletModalProps) {
  const mounted = useMounted();
  const connectors = useConnectors();
  const connect = useConnect();

  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || !mounted) return;
    const trigger = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [open, mounted]);

  // Scope the trap to this picker. WalletConnect can present its own prompt
  // elsewhere in the document while a connection request is pending.
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      const picker = dialog.current;
      const target = event.target;
      if (!picker || !(target instanceof Node)) return;
      // Clicking static text may leave focus on the body.
      if (target !== document.body && !picker.contains(target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const stops = picker.querySelectorAll<HTMLElement>("button:enabled, a[href]");
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && (target === first || target === document.body)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (target === last || target === document.body)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const pick = async (connector: Connector) => {
    // The chosen button becomes disabled while waiting on the wallet.
    closeButton.current?.focus();
    try {
      await connect.mutateAsync({ connector });
      onClose();
    } catch (error) {
      toast.error(describeTxError(error));
    }
  };

  if (!mounted) return null;

  // Portaled to <body>: ancestors with backdrop-filter (e.g. the sticky
  // header) become containing blocks for position:fixed, which would trap
  // the overlay inside them instead of covering the viewport.
  return createPortal(
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-label="Connect a wallet"
        >
          <m.div
            className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_80px_rgba(2,0,16,0.8)]"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Connect a wallet</h2>
              <button
                ref={closeButton}
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            {connectors.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface-2/60 p-4 text-sm text-ink-dim">
                <p className="mb-2 flex items-center gap-2 font-medium text-ink">
                  <Wallet className="size-4" aria-hidden /> No wallet found
                </p>
                <p>
                  Install a browser wallet like{" "}
                  <a
                    className="text-signal-bright underline-offset-2 hover:underline"
                    href="https://metamask.io"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    MetaMask
                  </a>{" "}
                  or{" "}
                  <a
                    className="text-signal-bright underline-offset-2 hover:underline"
                    href="https://rabby.io"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Rabby
                  </a>
                  , then reload this page.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {connectors.map((connector) => (
                  <li key={connector.uid}>
                    <button
                      onClick={() => void pick(connector)}
                      disabled={connect.isPending}
                      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2/50 px-4 py-3 text-left text-sm font-medium transition-all hover:border-signal/50 hover:bg-surface-2 disabled:opacity-50"
                    >
                      {connector.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs from EIP-6963
                        <img src={connector.icon} alt="" className="size-7 rounded-md" />
                      ) : (
                        <span className="flex size-7 items-center justify-center rounded-md bg-signal/15">
                          <Wallet className="size-4 text-signal-bright" aria-hidden />
                        </span>
                      )}
                      {connector.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
