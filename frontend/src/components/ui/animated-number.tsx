"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  /** Formats the interpolated value for display. */
  format?: (value: number) => string;
  className?: string;
  durationS?: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Smoothly tweens between numeric values (the live prediction, position value…)
 * with a dependency-free requestAnimationFrame loop — no animation library in
 * the first-load bundle for a number ticker. Falls back to instant updates
 * when the user prefers reduced motion.
 */
export function AnimatedNumber({
  value,
  format = (v) => v.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 }),
  className,
  durationS = 0.7,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value || prefersReducedMotion()) {
      setDisplay(value);
      return;
    }

    const durationMs = durationS * 1000;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      setDisplay(from + (value - from) * easeOutCubic(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, durationS]);

  return (
    <span className={className} data-testid="animated-number">
      {format(display)}
    </span>
  );
}
