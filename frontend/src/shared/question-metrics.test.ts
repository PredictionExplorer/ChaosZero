import { describe, expect, it } from "vitest";
import { ONE } from "./math";
import { formatDuration, formatQuestionMetric, type CycleStats } from "./question-metrics";
import { QUESTION_COUNT, QUESTIONS } from "./questions";

const stats = (overrides: Partial<CycleStats> = {}): CycleStats => ({
  gestureCount: 7n,
  ethSpent: ONE / 8n,
  cstBurned: 20n * ONE,
  highestCstPaid: 10n * ONE + ONE / 2n,
  enduranceDuration: 600n,
  chronoDuration: 3725n,
  enduranceGesture: 2n,
  chronoGesture: 5n,
  firstGestureTime: 100n,
  lastGestureTime: 200n,
  finalized: false,
  ...overrides,
});

describe("formatDuration", () => {
  it.each([
    [0n, "0s"],
    [59n, "59s"],
    [60n, "1m 0s"],
    [600n, "10m 0s"],
    [3599n, "59m 59s"],
    [3600n, "1h 0m"],
    [3725n, "1h 2m"],
    [90_061n, "25h 1m"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe("formatQuestionMetric", () => {
  it.each([
    [0, "7"],
    [1, "10m 0s"],
    [2, "1h 2m"],
    [3, "0.125 ETH"],
    [4, "20 CST"],
    [5, "7 · odd"],
    [6, "#2 / #5"],
    [7, "10.5 CST"],
  ])("formats question %i as %s", (question, expected) => {
    expect(formatQuestionMetric(stats(), question)).toBe(expected);
  });

  it("shows the live gesture total with its parity", () => {
    expect(formatQuestionMetric(stats({ gestureCount: 0n }), 5)).toBe("0 · even");
    expect(formatQuestionMetric(stats({ gestureCount: 1n }), 5)).toBe("1 · odd");
    expect(formatQuestionMetric(stats({ gestureCount: 8n }), 5)).toBe("8 · even");
    expect(formatQuestionMetric(stats({ gestureCount: 999n }), 5)).toBe("999 · odd");
  });

  it("does not name title holders before the first gesture", () => {
    expect(formatQuestionMetric(stats({ gestureCount: 0n }), 6)).toBe("No gestures yet");
  });

  it("keeps sub-unit ETH precision to six decimals", () => {
    expect(formatQuestionMetric(stats({ ethSpent: ONE / 3n }), 3)).toBe("0.333333 ETH");
  });

  it("never invents a value without cycle statistics", () => {
    for (let question = 0; question < QUESTION_COUNT; question++) {
      expect(formatQuestionMetric(null, question)).toBe("—");
      expect(formatQuestionMetric(undefined, question)).toBe("—");
    }
  });

  it.each([-1, QUESTION_COUNT, 1.5])("returns — for unknown question %s", (question) => {
    expect(formatQuestionMetric(stats(), question)).toBe("—");
  });

  it("renders verified V3 same-gesture outcomes without inventing gesture IDs", () => {
    expect(
      formatQuestionMetric(stats({ enduranceGesture: undefined, sameGesture: false }), 6),
    ).toBe("Decided at closure");
    expect(
      formatQuestionMetric(
        stats({ enduranceGesture: undefined, sameGesture: true, finalized: true }),
        6,
      ),
    ).toBe("Same gesture");
    expect(
      formatQuestionMetric(
        stats({ enduranceGesture: undefined, sameGesture: false, finalized: true }),
        6,
      ),
    ).toBe("Different gestures");
    expect(formatQuestionMetric(stats({ supported: false, gestureCount: 0n }), 0)).toBe("—");
  });

  it("gives every question its own handled metric", () => {
    expect(QUESTION_COUNT).toBe(8);
    expect(new Set(QUESTIONS.map((item) => item.metric)).size).toBe(QUESTION_COUNT);
    QUESTIONS.forEach((_, question) => {
      expect(() => formatQuestionMetric(stats(), question)).not.toThrow();
      expect(formatQuestionMetric(stats(), question)).not.toBe("—");
    });
  });
});
