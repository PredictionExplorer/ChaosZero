import type { HTMLAttributes } from "react";

type BadgeTone = "signal" | "higher" | "lower" | "ended" | "muted";

const TONES: Record<BadgeTone, string> = {
  signal: "bg-signal/15 text-signal-bright border-signal/30",
  higher: "bg-higher/12 text-higher border-higher/30",
  lower: "bg-lower/12 text-lower border-lower/30",
  ended: "bg-ended/12 text-ended border-ended/30",
  muted: "bg-surface-2 text-ink-dim border-line",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; pulse?: boolean };

export function Badge({
  tone = "muted",
  pulse = false,
  className = "",
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        TONES[tone],
        className,
      ].join(" ")}
    >
      {pulse && (
        <span className="relative flex size-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
