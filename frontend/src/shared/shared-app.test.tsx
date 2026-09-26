import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ONE } from "./math";
import { FundingPanel, Portfolio, QuestionCard, SharedGate, TradePanel } from "./shared-app";
import type { CycleStats, SharedSnapshot } from "./use-shared-market";

vi.mock("@/components/wallet/connect-button", () => ({
  ConnectButton: () => <button>Connect wallet</button>,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/shared",
}));

const address = "0x1111111111111111111111111111111111111111" as const;
function snapshot(): SharedSnapshot {
  return {
    roundId: 1n,
    currentRound: 1n,
    timestamp: 100n,
    token: address,
    source: address,
    game: address,
    funded: true,
    open: true,
    finalized: false,
    pool: {
      collateral: 1000n * ONE,
      yes: Array<bigint>(8).fill(0n),
      no: Array<bigint>(8).fill(0n),
      knownMask: 0,
      values: 0,
    },
    user: {
      yes: Array<bigint>(8).fill(0n),
      no: Array<bigint>(8).fill(0n),
      balance: 100n * ONE,
      allowance: 0n,
    },
    local: null,
  };
}
const stats = (gestureCount: bigint): CycleStats => ({
  gestureCount,
  ethSpent: ONE / 10n,
  cstBurned: 500n * ONE,
  highestCstPaid: 200n * ONE,
  enduranceDuration: 600n,
  chronoDuration: 800n,
  enduranceGesture: 2n,
  chronoGesture: 3n,
  firstGestureTime: 20n,
  lastGestureTime: 90n,
  finalized: false,
});
function withStats(): SharedSnapshot {
  return {
    ...snapshot(),
    local: {
      ethPrice: ONE / 100n,
      cstPrice: 400n * ONE,
      deadline: 1_000n,
      current: stats(8n),
      previous: stats(6n),
    },
  };
}

describe("shared market controls", () => {
  it("refuses the shared prototype on a public chain without attempting market reads", () => {
    render(<SharedGate />);
    expect(screen.getByRole("heading", { name: "Local prototype only" })).toBeInTheDocument();
    expect(screen.getByText(/Public-chain trading stays disabled/)).toBeInTheDocument();
    expect(screen.queryByTestId("shared-trade-panel")).not.toBeInTheDocument();
  });

  it("never invents current game values when no metrics are available", () => {
    render(<QuestionCard question={0} snapshot={snapshot()} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByTestId("current-0")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Buy YES: More gestures?" })).toHaveTextContent(
      "50%",
    );
  });

  it("makes same-gesture identity explicit instead of wallet equality", async () => {
    render(<QuestionCard question={6} snapshot={snapshot()} selected={false} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByText("Settlement rule"));
    expect(
      screen.getByText(/Two different gestures from the same wallet resolve NO/),
    ).toBeInTheDocument();
  });

  it("shows the live gesture parity and stays open until closure", async () => {
    render(
      <QuestionCard question={5} snapshot={withStats()} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Odd gesture count?" })).toBeInTheDocument();
    expect(screen.getByTestId("current-5")).toHaveTextContent("8 · even");
    expect(screen.getByText("Condition")).toBeInTheDocument();
    expect(screen.getByText("Odd total")).toBeInTheDocument();
    expect(screen.queryByText("Previous cycle")).not.toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Settlement rule"));
    expect(screen.getByText(/Each new gesture flips the answer/)).toBeInTheDocument();
  });

  it("labels each card's live value and its comparison", () => {
    const { unmount } = render(
      <QuestionCard question={0} snapshot={withStats()} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByTestId("current-0")).toHaveTextContent("8");
    expect(screen.getByText("Previous cycle").nextElementSibling).toHaveTextContent("6");
    unmount();
    render(
      <QuestionCard question={6} snapshot={withStats()} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Endurance / Chrono")).toBeInTheDocument();
    expect(screen.getByTestId("current-6")).toHaveTextContent("#2 / #3");
    expect(screen.getByText("Condition").nextElementSibling).toHaveTextContent("Same gesture");
  });

  it("shows a resolved NO and disables its trade buttons", () => {
    const state = snapshot();
    state.pool.knownMask = 1;
    render(<QuestionCard question={0} snapshot={state} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByText("Resolved NO")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Buy YES/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Buy NO/ })).toHaveTextContent("100%");
  });

  it("requires explicit gift acknowledgement and separate exact approval", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn().mockResolvedValue(true);
    const onFund = vi.fn().mockResolvedValue(true);
    render(
      <FundingPanel
        snapshot={snapshot()}
        connected
        pending={null}
        onApprove={onApprove}
        onFund={onFund}
      />,
    );
    await user.type(screen.getByLabelText("Gift amount in CST"), "25");
    expect(screen.getByRole("button", { name: "Approve CST for gift" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Approve CST for gift" }));
    expect(onApprove).toHaveBeenCalledWith(25n * ONE);
    expect(onFund).not.toHaveBeenCalled();
  });

  it("does not permit gifts larger than the wallet balance", async () => {
    render(
      <FundingPanel
        snapshot={snapshot()}
        connected
        pending={null}
        onApprove={vi.fn()}
        onFund={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText("Gift amount in CST"), "101");
    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough CST");
    expect(screen.getByRole("button", { name: "Approve CST for gift" })).toBeDisabled();
  });

  it("submits the actual quoted exact outputs only after approval", async () => {
    const state = snapshot();
    state.user!.allowance = 100n * ONE;
    const onTrade = vi.fn().mockResolvedValue(true);
    render(
      <TradePanel
        snapshot={state}
        question={0}
        yes
        buy
        connected
        pending={null}
        onMode={vi.fn()}
        onSide={vi.fn()}
        onApprove={vi.fn()}
        onTrade={onTrade}
      />,
    );
    await userEvent.type(screen.getByLabelText(/CST to spend/), "10");
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy YES" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Buy YES" }));
    expect(onTrade).toHaveBeenCalledOnce();
    expect(onTrade.mock.calls[0][0]).toBe(10n * ONE);
    expect(onTrade.mock.calls[0][1]).toBeGreaterThan(19n * ONE);
    expect(screen.getByLabelText(/CST to spend/)).toHaveValue("");
  });

  it("does not submit a dust trade with no verifiable output", async () => {
    const state = snapshot();
    state.user!.allowance = ONE;
    const onTrade = vi.fn();
    render(
      <TradePanel
        snapshot={state}
        question={0}
        yes
        buy
        connected
        pending={null}
        onMode={vi.fn()}
        onSide={vi.fn()}
        onApprove={vi.fn()}
        onTrade={onTrade}
      />,
    );
    await userEvent.type(screen.getByLabelText(/CST to spend/), "0.000000000000000001");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no executable quote"));
    expect(screen.getByRole("button", { name: "Buy YES" })).toBeDisabled();
    expect(onTrade).not.toHaveBeenCalled();
  });

  it("sell quotes are limited to the selected user's actual positions", async () => {
    const state = snapshot();
    state.pool.yes = [20n * ONE, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    state.user!.yes = [5n * ONE, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    render(
      <TradePanel
        snapshot={state}
        question={0}
        yes
        buy={false}
        connected
        pending={null}
        onMode={vi.fn()}
        onSide={vi.fn()}
        onApprove={vi.fn()}
        onTrade={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Position units to sell/), "6");
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough YES units");
    expect(screen.getByRole("button", { name: "Sell YES" })).toBeDisabled();
  });

  it("lets a wallet clear losing resolved positions without claiming a payout", () => {
    const state = snapshot();
    state.pool.knownMask = 1;
    state.user!.yes = [5n * ONE, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    render(<Portfolio snapshot={state} pending={null} onClaim={vi.fn()} onSell={vi.fn()} />);
    expect(screen.getByTestId("shared-claimable")).toHaveTextContent("0 CST");
    expect(screen.getByRole("button", { name: "Clear resolved positions" })).toBeEnabled();
  });

  it("retrieves partial-known winners without presenting unresolved positions as payouts", () => {
    const state = snapshot();
    state.pool.knownMask = 1;
    state.pool.values = 1;
    state.user!.yes = [5n * ONE, 7n * ONE, 0n, 0n, 0n, 0n, 0n, 0n];
    render(<Portfolio snapshot={state} pending={null} onClaim={vi.fn()} onSell={vi.fn()} />);
    expect(screen.getByTestId("shared-claimable")).toHaveTextContent("5 CST");
    expect(screen.getByText("Ready to retrieve")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("shared-portfolio")).getAllByRole("button", { name: /Sell/ }),
    ).toHaveLength(1);
  });
});
