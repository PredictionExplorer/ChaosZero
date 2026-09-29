import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BetClosed, MarketError, MarketSkeleton, NoMarketConfigured } from "./empty-states";

describe("empty states", () => {
  it("NoMarketConfigured explains both configuration paths", () => {
    render(<NoMarketConfigured />);
    expect(screen.getByTestId("no-market")).toHaveTextContent("NEXT_PUBLIC_MARKET_ADDRESS");
    expect(screen.getByTestId("no-market")).toHaveTextContent("?market=0x…");
  });

  it("MarketSkeleton renders placeholder blocks", () => {
    render(<MarketSkeleton />);
    expect(screen.getByTestId("market-skeleton")).toBeInTheDocument();
  });

  it("MarketError surfaces the message and retries", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<MarketError message="RPC unreachable" onRetry={onRetry} />);

    expect(screen.getByTestId("market-error")).toHaveTextContent("RPC unreachable");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("BetClosed explains each closed phase in its own words", () => {
    const expectations = [
      ["uninitialized", /first liquidity/i],
      ["decided", /yes is certain/i],
      ["ended", /awaiting resolution/i],
      ["resolved", /claimed/i],
    ] as const;
    for (const [phase, message] of expectations) {
      const { unmount } = render(<BetClosed phase={phase} />);
      expect(screen.getByTestId("bet-closed")).toHaveTextContent(message);
      unmount();
    }
  });

  it("BetClosed falls back to a generic reason for phases that normally allow betting", () => {
    render(<BetClosed phase="live" />);
    expect(screen.getByTestId("bet-closed")).toHaveTextContent("Betting is not available for this round.");
  });
});
