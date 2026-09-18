import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketState } from "@/hooks/use-market";
import { appConfig } from "@/lib/config";
import { MarketApp } from "./market-app";

const boundary = vi.hoisted(() => ({ market: vi.fn(), action: vi.fn(), retry: vi.fn() }));
vi.mock("@/hooks/use-market", () => ({ useMarket: boundary.market }));
vi.mock("@/hooks/use-market-actions", () => ({
  useMarketActions: () => ({
    pending: null,
    approve: boundary.action,
    bet: boundary.action,
    addLiquidity: boundary.action,
    removeLiquidity: boundary.action,
    updateFeeDeclaration: boundary.action,
    claimFees: boundary.action,
    mintSets: boundary.action,
    redeemSets: boundary.action,
    resolve: boundary.action,
    claim: boundary.action,
  }),
}));
vi.mock("@/hooks/use-market-events", () => ({
  useMarketEvents: () => ({ poolEvents: [], activity: [], isLoading: false }),
  totalVolume: () => 0n,
}));
vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: "connected",
    address: "0x4444444444444444444444444444444444444444",
  }),
  useChainId: () => appConfig.chain.id,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const SERIES = "0x1111111111111111111111111111111111111111" as const;
let state: MarketState;

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    statics: null,
    user: null,
    currentRound: 7n,
    roundId: 7n,
    error: null,
    isLoading: false,
    refetchAll: boundary.retry,
    snapshot: {
      seriesAddress: SERIES,
      cstAddress: "0x2222222222222222222222222222222222222222",
      gameAddress: "0x3333333333333333333333333333333333333333",
      roundId: 7n,
      gameRoundNum: 7n,
      initialized: true,
      thresholdKnown: true,
      threshold: 800n,
      currentCount: 640n,
      prevRoundCount: 800n,
      resolved: false,
      yesWon: false,
      pool: {
        reserveYes: 1000n * 10n ** 18n,
        reserveNo: 1000n * 10n ** 18n,
        totalShares: 1000n * 10n ** 18n,
        accFeePerShare: 0n,
        feeReserve: 0n,
        feeWeight: 200_000n * 10n ** 18n,
      },
    },
  };
  boundary.market.mockImplementation(() => state);
});

afterEach(cleanup);

describe("legacy financial controls during RPC failures", () => {
  it("replaces cached trading controls with an error and retry, then recovers", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MarketApp seriesAddress={SERIES} roundOverride={null} />);
    expect(screen.getByTestId("side-panel-tabs")).toBeInTheDocument();
    state = { ...state, error: new Error("Allowance RPC unavailable") };
    rerender(<MarketApp seriesAddress={SERIES} roundOverride={null} />);
    expect(screen.getByTestId("market-error")).toHaveTextContent("Allowance RPC unavailable");
    expect(screen.queryByTestId("side-panel-tabs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("liquidity-panel")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(boundary.retry).toHaveBeenCalledTimes(1);
    expect(boundary.action).not.toHaveBeenCalled();
    state = { ...state, error: null };
    rerender(<MarketApp seriesAddress={SERIES} roundOverride={null} />);
    expect(screen.queryByTestId("market-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("side-panel-tabs")).toBeInTheDocument();
  });

  it("waits for account reads instead of presenting cached controls as ready", () => {
    state = { ...state, isLoading: true };
    render(<MarketApp seriesAddress={SERIES} roundOverride={null} />);
    expect(screen.getByTestId("market-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("side-panel-tabs")).not.toBeInTheDocument();
    expect(boundary.action).not.toHaveBeenCalled();
  });
});
