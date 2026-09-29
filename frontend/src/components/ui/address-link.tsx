import { ExternalLink } from "lucide-react";
import { appConfig } from "@/lib/config";
import { shortAddress } from "@/lib/format";

interface AddressLinkProps {
  address: string;
  kind?: "address" | "tx";
  label?: string;
  className?: string;
}

/** Short hash that links out to the chain explorer when one exists. */
export function AddressLink({
  address,
  kind = "address",
  label,
  className = "",
}: AddressLinkProps) {
  const explorer = appConfig.chain.blockExplorers?.default?.url;
  const text = label ?? shortAddress(address);
  const baseClass = `inline-flex items-center gap-1 font-mono text-xs ${className}`;
  // A native title (not a floating tooltip): these links live inside scroll
  // containers like the activity feed, where an absolutely-positioned bubble
  // would clip at the container edge.
  const hint = kind === "tx" ? `Transaction ${address}` : `Address ${address}`;

  if (!explorer) {
    return (
      <span className={baseClass} title={hint}>
        {text}
      </span>
    );
  }
  return (
    <a
      href={`${explorer.replace(/\/$/, "")}/${kind === "tx" ? "tx" : "address"}/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`${hint} — view on explorer`}
      className={`${baseClass} text-ink-dim hover:text-signal-bright transition-colors`}
    >
      {text}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
