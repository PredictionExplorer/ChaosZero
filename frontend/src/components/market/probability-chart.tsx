"use client";

import { useId, useMemo } from "react";
import type { ProbabilityPoint } from "@/lib/history";

interface ProbabilityChartProps {
  points: readonly ProbabilityPoint[];
  height?: number;
  className?: string;
}

export interface ChartGeometry {
  linePath: string;
  areaPath: string;
  lastX: number;
  lastY: number;
}

/**
 * Maps probability points onto SVG coordinates (x = event sequence,
 * y = P(YES) in [0,1]). Pure and exported for direct testing.
 */
export function buildChartGeometry(
  points: readonly ProbabilityPoint[],
  width: number,
  height: number,
  pad = 6,
): ChartGeometry | null {
  if (points.length === 0) return null;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const n = points.length;
  const x = (i: number) => pad + (n === 1 ? usableW / 2 : (i / (n - 1)) * usableW);
  const y = (p: number) => {
    const f = Math.min(1, Math.max(0, p));
    return pad + (1 - f) * usableH;
  };
  const coords = points.map((p, i) => [x(i), y(p.probability)] as const);
  const linePath = coords
    .map(([cx, cy], i) => `${i === 0 ? "M" : "L"}${cx.toFixed(2)},${cy.toFixed(2)}`)
    .join(" ");
  const [lastX, lastY] = coords[coords.length - 1];
  const areaPath = `${linePath} L${lastX.toFixed(2)},${(height - pad).toFixed(2)} L${coords[0][0].toFixed(2)},${(height - pad).toFixed(2)} Z`;
  return { linePath, areaPath, lastX, lastY };
}

/**
 * P(YES) history as a glowing area chart on a fixed 0–100% scale. X is the
 * event sequence (each trade or liquidity change is one step) — the natural
 * clock of an AMM market.
 */
export function ProbabilityChart({ points, height = 160, className = "" }: ProbabilityChartProps) {
  const gradientId = useId();
  const width = 640;
  const geometry = useMemo(() => buildChartGeometry(points, width, height), [points, height]);

  if (!geometry || points.length < 2) {
    return (
      <div
        data-testid="chart-empty"
        className={`flex items-center justify-center rounded-xl border border-dashed border-line text-sm text-ink-faint ${className}`}
        style={{ height }}
      >
        The probability line will appear after the first trade.
      </div>
    );
  }

  const first = points[0].probability;
  const last = points[points.length - 1].probability;
  const rising = last >= first;
  const stroke = rising ? "var(--color-higher)" : "var(--color-lower)";
  const pct = (p: number) => `${Math.round(p * 100)}%`;

  return (
    <figure className={className} data-testid="probability-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
        role="img"
        aria-label={`YES probability history from ${pct(first)} to ${pct(last)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 50% reference line */}
        <line
          x1="6"
          x2={width - 6}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--color-line)"
          strokeDasharray="4 6"
          strokeWidth="1"
        />
        <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
        <path
          d={geometry.linePath}
          fill="none"
          stroke={stroke}
          strokeWidth="2.25"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={geometry.lastX} cy={geometry.lastY} r="4" fill={stroke}>
          <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
      <figcaption className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
        <span>0%</span>
        <span>P(YES) over trades</span>
        <span>100%</span>
      </figcaption>
    </figure>
  );
}
