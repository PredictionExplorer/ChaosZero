import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** Extra glow accent along the top edge. */
  accent?: "none" | "signal" | "higher" | "lower" | "ended";
};

const ACCENTS: Record<NonNullable<CardProps["accent"]>, string> = {
  none: "",
  signal:
    "before:bg-gradient-to-r before:from-transparent before:via-signal/70 before:to-transparent",
  higher:
    "before:bg-gradient-to-r before:from-transparent before:via-higher/70 before:to-transparent",
  lower:
    "before:bg-gradient-to-r before:from-transparent before:via-lower/70 before:to-transparent",
  ended:
    "before:bg-gradient-to-r before:from-transparent before:via-ended/70 before:to-transparent",
};

/** Glassy cosmic panel — the app's standard surface. */
export function Card({ accent = "none", className = "", children, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={[
        "relative rounded-2xl border border-line bg-surface/70 backdrop-blur-md",
        "shadow-[0_8px_32px_rgba(2,0,16,0.45)]",
        accent !== "none"
          ? "before:absolute before:inset-x-6 before:top-0 before:h-px before:content-['']"
          : "",
        ACCENTS[accent],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
