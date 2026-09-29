import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LazyMotion, MotionGlobalConfig, domAnimation } from "motion/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketActions } from "@/hooks/use-market-actions";
import type { ActivityEvent } from "@/hooks/use-market-events";
import type { MarketState } from "@/hooks/use-market";
import { appConfig } from "@/lib/config";
import { formatCst } from "@/lib/format";
import type { PoolEvent } from "@/lib/history";
import { ONE } from "@/lib/math";
import { CST, SERIES, USER, roundSnapshot, userSnapshot } from "@/test/fixtures";
import { MarketApp } from "./market-app";

/**
 * MarketApp is the composition root of the trading screen: the data hooks
 * are its boundary (they have their own suites), everything below it —
 * panels, banners, the lazily loaded wallet picker — renders for real.
 */
const mocks = vi.hoisted(() => ({
  useMarket: vi.fn(),
  useMarketEvents: vi.fn(),
  useMarketActions: vi.fn(),
  connection: { status: "disconnected" } as { status: string },
  chainId: 0,
  push: vi.fn(),
}));

vi.mock("@/hooks/use-market", () => ({ useMarket: mocks.useMarket }));
vi.mock("@/hooks/use-market-actions", () => ({ useMarketActions: mocks.useMarketActions }));
vi.mock("@/hooks/use-market-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-market-events")>()),
  useMarketEvents: mocks.useMarketEvents,
}));
vi.mock("wagmi", () => ({
  useConnection: () => mocks.connection,
  useChainId: () => mocks.chainId,
  useConnectors: () => [{ uid: "io.metamask", name: "MetaMask" }],
  useConnect: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

let market: MarketState;
let actions: { -readonly [K in keyof MarketActions]: MarketActions[K] } & Record<string, unknown>;
let events: {
  activity: ActivityEvent[];
  poolEvents: PoolEvent[];
  isLoading: boolean;
  error: Error | null;
};

function marketState(overrides: Partial<MarketState> = {}): MarketState {
  return {
    statics: { cstAddress: CST, gameAddress: "0x3333333333333333333333333333333333333333" },
    snapshot: roundSnapshot(),
    user: null,
    roundId: 5n,
    currentRound: 5n,
    isLoading: false,
    error: null,
    refetchAll: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  market = marketState();
  events = { activity: [], poolEvents: [], isLoading: false, error: null };
  actions = {
    pending: null,
    approve: vi.fn().mockResolvedValue(true),
    bet: vi.fn().mockResolvedValue(true),
    addLiquidity: vi.fn().mockResolvedValue(true),
    removeLiquidity: vi.fn().mockResolvedValue(true),
    updateFeeDeclaration: vi.fn().mockResolvedValue(true),
    claimFees: vi.fn().mockResolvedValue(true),
    mintSets: vi.fn().mockResolvedValue(true),
    redeemSets: vi.fn().mockResolvedValue(true),
    resolve: vi.fn().mockResolvedValue(true),
    claim: vi.fn().mockResolvedValue(true),
  };
  mocks.useMarket.mockImplementation(() => market);
  mocks.useMarketEvents.mockImplementation(() => events);
  mocks.useMarketActions.mockImplementation(() => actions);
  mocks.connection = { status: "disconnected" };
  mocks.chainId = appConfig.chain.id;
});

function connect(chainId = appConfig.chain.id) {
  mocks.connection = { status: "connected" };
  mocks.chainId = chainId;
}

function renderApp(roundOverride: bigint | null = null) {
  const ui = () => (
    <LazyMotion features={domAnimation} strict>
      <MarketApp seriesAddress={SERIES} roundOverride={roundOverride} />
    </LazyMotion>
  );
  const utils = render(ui());
  return { ...utils, rerenderApp: () => utils.rerender(ui()) };
}

describe("MarketApp: data wiring", () => {
  it("reads the market for the given series and round override", () => {
    renderApp(3n);
    expect(mocks.useMarket).toHaveBeenCalledWith(SERIES, 3n);
  });

  it("follows the round the market resolved for events and actions", () => {
    market = marketState({
      roundId: 7n,
      snapshot: roundSnapshot({ roundId: 7n, gameRoundNum: 7n }),
    });
    renderApp();

    expect(mocks.useMarketEvents).toHaveBeenCalledWith(SERIES, 7n);
    expect(mocks.useMarketActions).toHaveBeenCalledWith(SERIES, 7n);
  });
});

describe("MarketApp: loading and errors", () => {
  it("shows the skeleton while the first snapshot loads", () => {
    market = marketState({ isLoading: true, snapshot: null });
    renderApp();

    expect(screen.getByTestId("market-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("market-hero")).not.toBeInTheDocument();
  });

  it("shows the skeleton when loading finished without a snapshot yet", () => {
    market = marketState({ snapshot: null });
    renderApp();
    expect(screen.getByTestId("market-skeleton")).toBeInTheDocument();
  });

  it("explains a failed load and retries everything on request", async () => {
    const user = userEvent.setup();
    market = marketState({ snapshot: null, error: new Error("HTTP request failed. Status: 429") });
    renderApp();

    expect(screen.getByTestId("market-error")).toHaveTextContent(
      "HTTP request failed. Status: 429",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(market.refetchAll).toHaveBeenCalledOnce();
  });

  it("keeps showing the last good snapshot when a refresh fails", () => {
    market = marketState({ error: new Error("flaky RPC") });
    renderApp();

    expect(screen.queryByTestId("market-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-hero")).toBeInTheDocument();
  });
});

describe("MarketApp: a live round", () => {
  it("lays out the round: navigation, hero, stats, the bet tab and the activity feed", () => {
    renderApp();

    expect(screen.getByTestId("round-nav")).toBeInTheDocument();
    expect(screen.getByTestId("market-hero")).toBeInTheDocument();
    expect(screen.getByTestId("stats-grid")).toBeInTheDocument();
    expect(screen.getByTestId("side-tab-bet")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("bet-submit")).toBeInTheDocument();
    expect(screen.getByTestId("activity-feed")).toBeInTheDocument();
    // Nothing to resolve while the round is live.
    expect(screen.queryByTestId("resolve-banner")).not.toBeInTheDocument();
  });

  it("reports the round's volume from the event history", () => {
    const base = { logIndex: 0, transactionHash: "0x" as const, timestamp: null };
    const L = 1_000n * ONE;
    events.poolEvents = [
      {
        ...base,
        blockNumber: 1n,
        kind: "add",
        provider: USER,
        cstIn: L,
        declaredFeeBps: 200,
        sharesOut: L,
        yesToPool: L,
        noToPool: L,
      },
      {
        ...base,
        blockNumber: 2n,
        kind: "bet",
        user: USER,
        side: "yes",
        cstIn: 3n * ONE,
        netIn: 3n * ONE,
        tokensOut: 0n,
      },
      {
        ...base,
        blockNumber: 3n,
        kind: "bet",
        user: USER,
        side: "no",
        cstIn: 4n * ONE,
        netIn: 4n * ONE,
        tokensOut: 0n,
      },
    ];
    renderApp();

    const volume = within(screen.getByTestId("stats-grid"))
      .getByText("Volume")
      .closest("div")!.parentElement!;
    expect(volume).toHaveTextContent(formatCst(7n * ONE));
  });

  it("opens the wallet picker when a disconnected visitor tries to bet", async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.getByTestId("bet-submit")).toHaveTextContent(/connect wallet/i);
    await user.click(screen.getByTestId("bet-submit"));

    expect(await screen.findByRole("dialog", { name: "Connect a wallet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends a connected user's bet through the market actions", async () => {
    const user = userEvent.setup();
    connect();
    market = marketState({ user: userSnapshot({ cstAllowance: 1_000_000n * ONE }) });
    renderApp();

    await user.type(screen.getByTestId("amount-input"), "10");
    await user.click(screen.getByTestId("bet-submit"));

    expect(actions.bet).toHaveBeenCalledWith("yes", 10n * ONE, expect.any(BigInt));
  });

  it("approves the round's CST token before the first bet", async () => {
    const user = userEvent.setup();
    connect();
    market = marketState({ user: userSnapshot({ cstAllowance: 0n }) });
    renderApp();

    await user.type(screen.getByTestId("amount-input"), "10");
    await user.click(screen.getByTestId("bet-submit"));

    expect(actions.approve).toHaveBeenCalledWith(CST, 10n * ONE);
    expect(actions.bet).not.toHaveBeenCalled();
  });

  it("shows the user's position and routes redemptions", async () => {
    const user = userEvent.setup();
    connect();
    market = marketState({ user: userSnapshot() });
    renderApp();

    expect(screen.getByTestId("position-panel")).toBeInTheDocument();
    await user.click(screen.getByTestId("redeem-button"));
    expect(actions.redeemSets).toHaveBeenCalled();
  });

  it("treats a wallet on the wrong network as not connected", () => {
    connect(1);
    market = marketState({ user: userSnapshot() });
    renderApp();

    expect(screen.queryByTestId("position-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("bet-submit")).toHaveTextContent(/connect wallet/i);
  });

  it("flags the liquidity tab when the user provides liquidity", () => {
    connect();
    market = marketState({ user: userSnapshot({ lpShares: 5n * ONE }) });
    renderApp();

    expect(screen.getByTestId("lp-tab-indicator")).toBeInTheDocument();
  });

  it("routes LP fee claims from the liquidity tab", async () => {
    const user = userEvent.setup();
    connect();
    market = marketState({ user: userSnapshot({ lpShares: 5n * ONE, lpPendingFees: ONE }) });
    renderApp();

    await user.click(screen.getByTestId("side-tab-liquidity"));
    await user.click(screen.getByTestId("claim-fees-button"));
    expect(actions.claimFees).toHaveBeenCalledOnce();
  });

  it("approves the CST token, then deposits liquidity, from the liquidity tab", async () => {
    const user = userEvent.setup();
    connect();
    market = marketState({ user: userSnapshot({ cstAllowance: 0n }) });
    const { rerenderApp } = renderApp();

    await user.click(screen.getByTestId("side-tab-liquidity"));
    await user.type(screen.getByTestId("lp-amount-input"), "10");
    await user.click(screen.getByTestId("lp-add-submit"));
    expect(actions.approve).toHaveBeenCalledWith(CST, 10n * ONE);

    market = marketState({ user: userSnapshot({ cstAllowance: 10n * ONE }) });
    rerenderApp();
    await user.click(screen.getByTestId("lp-add-submit"));
    expect(actions.addLiquidity).toHaveBeenCalledWith(
      10n * ONE,
      expect.any(Number),
      expect.any(BigInt),
      expect.any(BigInt),
    );
  });

  it.each(["approve", "addLiquidity"] as const)(
    "spins the deposit button while %s is in flight",
    async (pending) => {
      const user = userEvent.setup();
      connect();
      market = marketState({ user: userSnapshot({ cstAllowance: 1_000_000n * ONE }) });
      actions.pending = pending;
      renderApp();

      await user.click(screen.getByTestId("side-tab-liquidity"));
      await user.type(screen.getByTestId("lp-amount-input"), "10");
      expect(screen.getByTestId("lp-add-submit")).toBeDisabled();
    },
  );

  it("keeps the deposit button live while an unrelated action is in flight", async () => {
    const user = userEvent.setup();
    connect();
    market = marketState({ user: userSnapshot({ cstAllowance: 1_000_000n * ONE }) });
    actions.pending = "claim";
    renderApp();

    await user.click(screen.getByTestId("side-tab-liquidity"));
    await user.type(screen.getByTestId("lp-amount-input"), "10");
    expect(screen.getByTestId("lp-add-submit")).toBeEnabled();
  });

  it("spins only the button whose action is in flight", () => {
    connect();
    market = marketState({ user: userSnapshot({ cstAllowance: 1_000_000n * ONE }) });
    actions.pending = "bet";
    renderApp();

    expect(screen.getByTestId("bet-submit")).toBeDisabled();
    expect(screen.getByTestId("redeem-button")).toBeEnabled();
  });

  it("starts every round on a fresh bet tab, dropping half-typed input", async () => {
    const user = userEvent.setup();
    connect();
    market = marketState({ user: userSnapshot() });
    const { rerenderApp } = renderApp();

    await user.type(screen.getByTestId("amount-input"), "42");
    await user.click(screen.getByTestId("side-tab-liquidity"));
    market = marketState({
      user: userSnapshot(),
      roundId: 6n,
      snapshot: roundSnapshot({ roundId: 6n, gameRoundNum: 6n }),
    });
    rerenderApp();

    expect(screen.getByTestId("side-tab-bet")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId<HTMLInputElement>("amount-input").value).toBe("");
  });
});

describe("MarketApp: rounds that can no longer be bet on", () => {
  it("offers resolution once the round ended, and closes betting", async () => {
    const user = userEvent.setup();
    connect();
    market = marketState({ snapshot: roundSnapshot({ gameRoundNum: 6n, currentCount: 900n }) });
    renderApp();

    expect(screen.getByTestId("bet-closed")).toBeInTheDocument();
    expect(screen.queryByTestId("bet-submit")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("resolve-button"));
    expect(actions.resolve).toHaveBeenCalledOnce();
  });

  it("asks a disconnected visitor to connect before resolving", async () => {
    const user = userEvent.setup();
    market = marketState({ snapshot: roundSnapshot({ gameRoundNum: 6n }) });
    renderApp();

    await user.click(screen.getByTestId("resolve-button"));

    expect(actions.resolve).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Connect a wallet" })).toBeInTheDocument();
  });

  it("shows the resolve spinner while resolution is in flight", () => {
    connect();
    actions.pending = "resolve";
    market = marketState({ snapshot: roundSnapshot({ currentCount: 900n }) }); // decided mid-round
    renderApp();

    expect(screen.getByTestId("resolve-button")).toBeDisabled();
  });

  it("lets winners claim once resolved", async () => {
    const user = userEvent.setup();
    connect();
    market = marketState({
      snapshot: roundSnapshot({ resolved: true, yesWon: true, gameRoundNum: 6n }),
      user: userSnapshot(),
    });
    renderApp();

    expect(screen.queryByTestId("resolve-banner")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("claim-button"));
    expect(actions.claim).toHaveBeenCalledOnce();
  });

  it("keeps betting open on a future round the game has not reached", () => {
    market = marketState({
      snapshot: roundSnapshot({ roundId: 6n, thresholdKnown: false }),
      roundId: 6n,
    });
    renderApp(6n);

    expect(screen.getByTestId("bet-submit")).toBeInTheDocument();
    expect(screen.queryByTestId("bet-closed")).not.toBeInTheDocument();
  });
});
