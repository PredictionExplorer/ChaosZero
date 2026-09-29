import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnimatedNumber } from "./animated-number";

describe("AnimatedNumber", () => {
  it("renders the initial value immediately", () => {
    render(<AnimatedNumber value={700} />);
    expect(screen.getByTestId("animated-number")).toHaveTextContent("700.0");
  });

  it("applies a custom formatter", () => {
    render(<AnimatedNumber value={1234.5} format={(v) => `#${Math.round(v)}`} />);
    expect(screen.getByTestId("animated-number")).toHaveTextContent("#1235");
  });

  it("settles on the new value after an update", async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<AnimatedNumber value={100} durationS={0.05} />);
      rerender(<AnimatedNumber value={200} durationS={0.05} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByTestId("animated-number")).toHaveTextContent("200.0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes through intermediate values while tweening", async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <AnimatedNumber value={0} durationS={1} format={(v) => v.toFixed(2)} />,
      );
      rerender(<AnimatedNumber value={100} durationS={1} format={(v) => v.toFixed(2)} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const mid = Number(screen.getByTestId("animated-number").textContent);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it("jumps instantly when the user prefers reduced motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      const { rerender } = render(<AnimatedNumber value={100} />);
      rerender(<AnimatedNumber value={200} />);
      expect(screen.getByTestId("animated-number")).toHaveTextContent("200.0");
    } finally {
      window.matchMedia = original;
    }
  });
});
