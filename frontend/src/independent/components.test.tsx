import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IndependentFundingPanel,
  IndependentPortfolio,
  IndependentQuestionCard,
  IndependentSetsPanel,
  IndependentTradePanel,
} from "./components";
import { noopActions, snapshot, zero } from "./test-fixtures";
import { MAX_COLLATERAL, ONE } from "@/shared/math";
import { fixedAmounts } from "./models";
const mocks = vi.hoisted(() => ({ funding: vi.fn() }));
vi.mock("./use-independent-market", () => ({ useIndependentFundingPreview: mocks.funding }));
vi.mock("@/components/wallet/connect-button", () => ({
  ConnectButton: () => <button>Connect wallet</button>,
}));
beforeEach(() =>
  mocks.funding.mockReturnValue({ data: snapshot().funding, error: null, isFetching: false }),
);

describe("independent question interface", () => {
  it("continues trading when an observed comparison is already known but the cycle is open", () => {
    render(
      <IndependentQuestionCard
        question={0}
        snapshot={snapshot()}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Trading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy YES: More gestures?" })).toBeEnabled();
    expect(screen.queryByText("Resolved YES")).not.toBeInTheDocument();
  });
  it("never rounds an unresolved tiny price into apparent certainty", () => {
    const state = snapshot();
    state.questions[0].pool = {
      collateral: MAX_COLLATERAL,
      yes: MAX_COLLATERAL - 1n,
      no: 0n,
      initialYesBps: 9999,
    };
    render(
      <IndependentQuestionCard question={0} snapshot={state} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Buy YES: More gestures?" })).not.toHaveTextContent(
      "100%",
    );
    expect(screen.getByRole("button", { name: "Buy NO: More gestures?" })).toHaveTextContent(
      "<0.01%",
    );
  });
  it("distinguishes cleared active collateral from reserved old claims", () => {
    const state = snapshot();
    state.finalized = true;
    state.settled = true;
    state.open = false;
    state.questions[0].pool.collateral = 0n;
    state.questions[0].escrowRemaining = 7n * ONE;
    render(
      <IndependentQuestionCard question={0} snapshot={state} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Reserved for claims")).toBeInTheDocument();
    expect(screen.getByTestId("question-collateral-0")).toHaveTextContent("7 CST");
    expect(screen.getByTestId("question-reserve-0")).toHaveTextContent("0 CST");
    expect(screen.getByRole("button", { name: "Buy YES: More gestures?" })).toBeDisabled();
  });
  it("does not enable early claims when source facts are known", () => {
    render(<IndependentPortfolio snapshot={snapshot()} actions={noopActions()} onSell={vi.fn()} />);
    expect(screen.getByTestId("independent-claimable")).toHaveTextContent("0 CST");
    expect(screen.getByRole("button", { name: "Retrieve winnings" })).toBeDisabled();
  });
  it("pays normal 1:1 claims once finalized, without carried-fund bonuses", () => {
    const state = snapshot();
    state.finalized = true;
    state.pendingCarry = 10000n * ONE;
    render(<IndependentPortfolio snapshot={state} actions={noopActions()} onSell={vi.fn()} />);
    expect(screen.getByTestId("independent-claimable")).toHaveTextContent("10 CST");
    expect(screen.getByRole("button", { name: "Retrieve winnings" })).toBeEnabled();
  });
  it("quotes one question and submits exact amounts after approval", async () => {
    const state = snapshot();
    state.user!.allowance = 1000n * ONE;
    const actions = { ...noopActions(), trade: vi.fn().mockResolvedValue(true) };
    render(
      <IndependentTradePanel
        snapshot={state}
        question={0}
        yes
        buy
        connected
        actions={actions}
        onSide={vi.fn()}
        onMode={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/CST to spend/), "10");
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy YES" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Buy YES" }));
    expect(actions.trade).toHaveBeenCalledWith(0, true, true, 10n * ONE, expect.any(BigInt));
    expect(actions.trade.mock.calls[0][4]).toBeGreaterThan(19n * ONE);
  });
});

describe("independent funding and complete sets", () => {
  it("starts with zero new CST using the actual carry preview", async () => {
    const state = snapshot();
    state.funded = false;
    mocks.funding.mockReturnValue({
      data: {
        ...state.funding!,
        carryUsed: 8000n * ONE,
        availableCarry: 8000n * ONE,
        totalFunding: 8000n * ONE,
        allocations: fixedAmounts(Array<bigint>(8).fill(1000n * ONE)),
        canFund: true,
      },
      error: null,
      isFetching: false,
    });
    const actions = { ...noopActions(), fund: vi.fn().mockResolvedValue(true), approve: vi.fn() };
    render(<IndependentFundingPanel snapshot={state} connected actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Start pools with carried CST" }));
    expect(actions.fund).toHaveBeenCalledWith(0n);
    expect(actions.approve).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("blocks funding while the preview is refreshing or unavailable", async () => {
    const state = snapshot();
    state.funded = false;
    const data = { ...state.funding!, totalFunding: ONE, carryUsed: ONE, canFund: true };
    mocks.funding.mockReturnValue({ data, error: null, isFetching: true });
    const { rerender } = render(
      <IndependentFundingPanel snapshot={state} connected actions={noopActions()} />,
    );
    expect(screen.getByRole("button", { name: "Start pools with carried CST" })).toBeDisabled();
    mocks.funding.mockReturnValue({ data, error: new Error("RPC offline"), isFetching: false });
    rerender(<IndependentFundingPanel snapshot={state} connected actions={noopActions()} />);
    expect(screen.getByRole("button", { name: "Start pools with carried CST" })).toBeDisabled();
  });
  it("requires acknowledgment for new gifts and shows exact remainder allocations", async () => {
    const state = snapshot();
    const allocations = fixedAmounts([2n, 1n, 1n, 1n, 1n, 1n, 1n, 1n]);
    mocks.funding.mockReturnValue({
      data: { ...state.funding!, totalFunding: 9n, allocations, canFund: true },
      error: null,
      isFetching: false,
    });
    const actions = { ...noopActions(), approve: vi.fn().mockResolvedValue(true) };
    render(<IndependentFundingPanel snapshot={state} connected actions={actions} />);
    await userEvent.type(screen.getByLabelText(/New CST to add/), "0.000000000000000009");
    expect(screen.getByRole("button", { name: "Approve CST for funding" })).toBeDisabled();
    expect(screen.getByTestId("funding-allocations")).toHaveTextContent(
      "Q1: 0.000000000000000002 CST",
    );
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Approve CST for funding" }));
    expect(actions.approve).toHaveBeenCalledWith(9n);
  });
  it("checks the selected question's split cap, not global custody", async () => {
    const state = snapshot();
    state.user!.allowance = 100n * ONE;
    const actions = { ...noopActions(), split: vi.fn().mockResolvedValue(true) };
    render(
      <IndependentSetsPanel
        roundId={1n}
        user={state.user}
        collaterals={[1000n * ONE, MAX_COLLATERAL, ...Array<bigint>(6).fill(0n)]}
        open
        finalized={false}
        connected
        actions={actions}
      />,
    );
    await userEvent.type(screen.getByLabelText("CST to split"), "2");
    expect(screen.getByRole("button", { name: "Split into YES + NO" })).toBeEnabled();
    await userEvent.selectOptions(screen.getByRole("combobox"), "1");
    await userEvent.type(screen.getByLabelText("CST to split"), "2");
    expect(screen.getByRole("alert")).toHaveTextContent("question’s collateral limit");
    expect(screen.getByRole("button", { name: "Split into YES + NO" })).toBeDisabled();
  });
  it("merges matched pairs after finality without a trading quote", async () => {
    const state = snapshot();
    state.user!.no = state.user!.yes;
    const actions = { ...noopActions(), merge: vi.fn().mockResolvedValue(true) };
    render(
      <IndependentSetsPanel
        roundId={1n}
        user={state.user}
        collaterals={zero()}
        open={false}
        finalized
        connected
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Merge pairs" }));
    await userEvent.type(screen.getByLabelText("Pairs to merge"), "0.000000000000000001");
    expect(screen.getByTestId("independent-set-output")).toHaveTextContent(
      "0.000000000000000001 CST",
    );
    await userEvent.click(screen.getByRole("button", { name: "Merge pairs into CST" }));
    expect(actions.merge).toHaveBeenCalledWith(0, 1n);
  });
});
