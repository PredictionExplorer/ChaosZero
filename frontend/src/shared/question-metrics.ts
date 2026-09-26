import { formatEther } from "viem";
import { formatCst } from "@/lib/format";
import { QUESTIONS, type QuestionDefinition } from "./questions";
import type { CycleStats } from "./use-shared-market";

/** Whole seconds as their two largest units: `1h 5m`, `2m 30s` or `45s`. */
export const formatDuration = (seconds: bigint) => {
  const hours = seconds / 3600n;
  const minutes = (seconds % 3600n) / 60n;
  return hours > 0n
    ? `${hours}h ${minutes}m`
    : minutes > 0n
      ? `${minutes}m ${seconds % 60n}s`
      : `${seconds}s`;
};

/** A question's statistic for one cycle, or `—` when it is unavailable. */
export function formatQuestionMetric(
  stats: CycleStats | null | undefined,
  question: number,
): string {
  const item: QuestionDefinition | undefined = QUESTIONS[question];
  if (!stats || !item) return "—";
  const metric = item.metric;
  switch (metric) {
    case "gestures":
      return stats.gestureCount.toLocaleString();
    case "endurance":
      return formatDuration(stats.enduranceDuration);
    case "chrono":
      return formatDuration(stats.chronoDuration);
    case "ethSpent":
      return `${Number(formatEther(stats.ethSpent)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
    case "cstBurned":
      return `${formatCst(stats.cstBurned)} CST`;
    case "parity":
      return `${stats.gestureCount.toLocaleString()} · ${stats.gestureCount % 2n === 1n ? "odd" : "even"}`;
    case "sameGesture":
      return stats.gestureCount === 0n
        ? "No gestures yet"
        : `#${stats.enduranceGesture} / #${stats.chronoGesture}`;
    case "maxCstPaid":
      return `${formatCst(stats.highestCstPaid)} CST`;
    default: {
      const unhandled: never = metric;
      throw new Error(`Unhandled question metric: ${String(unhandled)}`);
    }
  }
}
