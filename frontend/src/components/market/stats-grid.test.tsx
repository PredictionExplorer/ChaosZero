import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { RoundSnapshot } from "@/lib/market";
import { ONE } from "@/lib/math";
import { StatsGrid } from "./stats-grid";

const SERIES = "0x1111111111111111111111111111111111111111" as const;

function snapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    seriesAddress: SERIES,
    roundId: 5n,
    initialized: true,
    thresholdKnown: true,
    resolved: false,
    yesWon: false,
    threshold: 800n,
    currentCount: 640n,
    gameRoundNum: 5n,
    prevRoundCount: 800n,
    pool: {
      reserveYes: 1_000n * ONE,
      reserveNo: 3_000n * ONE,
      totalShares: 1_000n * ONE,
      accFeePerShare: 0n,
      feeReserve: 5n * ONE,
      feeWeight: 1_000n * ONE * 250n,
    },
    cstAddress: "0x2222222222222222222222222222222222222222",
    gameAddress: "0x3333333333333333333333333333333333333333",
    ...overrides,
  };
}

function statValue(label: RegExp): string {
  const labelNode = screen.getByText(label);
  return labelNode.closest("div")?.parentElement?.querySelector("p.mt-1\\.5")?.textContent ?? "";
}

describe("StatsGrid", () => {
  it("shows the locked threshold as the number to beat", () => {
    render(<StatsGrid snapshot={snapshot()} volume={0n} />);
    expect(statValue(/to beat/i)).toContain("800");
  });

  it("shows a dash while the threshold is still forming (future round)", () => {
    render(
      <StatsGrid
        snapshot={snapshot({
          roundId: 7n,
          gameRoundNum: 5n,
          thresholdKnown: false,
          threshold: 0n,
          currentCount: 0n,
        })}
        volume={0n}
      />,
    );
    expect(statValue(/to beat/i)).toContain("—");
    expect(statValue(/to beat/i)).not.toContain("0");
  });

  it("shows no pool fee for an unfunded pool (there is no vote to average)", () => {
    render(
      <StatsGrid
        snapshot={snapshot({
          pool: {
            reserveYes: 0n,
            reserveNo: 0n,
            totalShares: 0n,
            accFeePerShare: 0n,
            feeReserve: 0n,
            feeWeight: 0n,
          },
        })}
        volume={0n}
      />,
    );
    expect(statValue(/pool fee/i)).toContain("—");
  });

  it("keeps the liquidity and fee stats intact for future pools", () => {
    render(
      <StatsGrid
        snapshot={snapshot({ roundId: 7n, gameRoundNum: 5n, thresholdKnown: false })}
        volume={123n * ONE}
      />,
    );
    expect(statValue(/liquidity/i)).toContain("4,000");
    expect(statValue(/pool fee/i)).toContain("2.5%");
    expect(statValue(/volume/i)).toContain("123");
  });

  it("gives every stat a help tooltip", () => {
    render(<StatsGrid snapshot={snapshot()} volume={0n} />);
    for (const label of [
      "Gestures so far",
      "To beat",
      "Volume",
      "Liquidity",
      "Pool fee",
      "LP fees unclaimed",
    ]) {
      expect(screen.getByRole("button", { name: `About "${label}"` })).toBeInTheDocument();
    }
  });

  it('explains the tie rule in the "To beat" tooltip', async () => {
    const user = userEvent.setup();
    render(<StatsGrid snapshot={snapshot()} volume={0n} />);

    await user.hover(screen.getByRole("button", { name: 'About "To beat"' }));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(/strictly higher/i);
    expect(tip).toHaveTextContent(/a tie means NO wins/i);
  });

  it("swaps the threshold tooltip while the bar is still forming", async () => {
    const user = userEvent.setup();
    render(
      <StatsGrid
        snapshot={snapshot({ roundId: 7n, gameRoundNum: 5n, thresholdKnown: false, threshold: 0n })}
        volume={0n}
      />,
    );

    await user.hover(screen.getByRole("button", { name: 'About "To beat"' }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      /locks at the previous round's final count/i,
    );
  });
});
