import { render, screen, waitFor, within } from "@testing-library/react";
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
import { quoteIndependentTrade } from "@/shared/independent-math";
import { MAX_COLLATERAL, ONE } from "@/shared/math";
import { fixedAmounts } from "./models";
const mocks = vi.hoisted(() => ({ funding: vi.fn() }));
/** An unfunded cycle whose next trade opens it with 16 carried + 8 held CST. */
function startable() {
  const state = snapshot();
  state.funded = false;
  for (const q of state.questions) {
    q.funded = false;
    q.pool = { ...q.pool, collateral: 0n };
  }
  state.poolCustody = 0n;
  state.pendingCarry = 16n * ONE;
  state.availableCarry = 16n * ONE;
  state.heldContributions = 8n * ONE;
  state.funding = {
    ...state.funding!,
    availableCarry: 16n * ONE,
    carryUsed: 16n * ONE,
    totalFunding: 24n * ONE,
    allocations: fixedAmounts(Array<bigint>(8).fill(3n * ONE)),
    needsSettlement: true,
    canFund: true,
    unallocated: 8n * ONE,
  };
  return state;
}
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
  it("a fully known but open cycle keeps every question tradeable and unresolved", () => {
    // Markets never end early: all eight answers known still means trading until closure.
    const state = snapshot();
    state.observedMask = 0xff;
    state.observedValues = 0xa5;
    state.values = 0xa5;
    state.open = true;
    state.finalized = false;
    const { unmount } = render(
      <>
        {([0, 1, 2, 3, 4, 5, 6, 7] as const).map((q) => (
          <IndependentQuestionCard
            key={q}
            question={q}
            snapshot={state}
            selected={false}
            onSelect={vi.fn()}
          />
        ))}
      </>,
    );
    for (let q = 0; q < 8; q++) {
      const card = within(screen.getByTestId(`question-${q}`));
      expect(card.getByText("Trading")).toBeInTheDocument();
      expect(card.queryByText(/Resolved (YES|NO)/)).not.toBeInTheDocument();
      for (const side of [/^Buy YES:/, /^Buy NO:/]) {
        const button = card.getByRole("button", { name: side });
        expect(button).toBeEnabled();
        expect(button).not.toHaveTextContent(/(^|[^.\d])(100|0)%/);
      }
    }
    unmount();
    render(<IndependentPortfolio snapshot={state} actions={noopActions()} onSell={vi.fn()} />);
    expect(screen.getByTestId("independent-claimable")).toHaveTextContent("0 CST");
    expect(screen.getByRole("button", { name: "Retrieve winnings" })).toBeDisabled();
  });
  it("keeps splitting open for a fully known but open cycle", async () => {
    const state = snapshot();
    state.observedMask = 0xff;
    state.observedValues = 0xa5;
    state.user!.allowance = 100n * ONE;
    const actions = { ...noopActions(), split: vi.fn().mockResolvedValue(true) };
    render(
      <IndependentSetsPanel
        roundId={1n}
        user={state.user}
        collaterals={state.questions.map((q) => q.pool.collateral)}
        open
        finalized={false}
        connected
        actions={actions}
      />,
    );
    expect(screen.queryByText(/Splitting is closed/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("CST to split"), "2");
    expect(screen.getByRole("button", { name: "Split into YES + NO" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Split into YES + NO" }));
    expect(actions.split).toHaveBeenCalledWith(0, 2n * ONE);
  });
  it("shows the live gesture parity against its fixed condition", () => {
    render(
      <IndependentQuestionCard
        question={5}
        snapshot={snapshot()}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Odd gesture count?" })).toBeInTheDocument();
    expect(screen.getByText("This cycle")).toBeInTheDocument();
    expect(screen.getByTestId("current-5")).toHaveTextContent("7 · odd");
    expect(screen.getByText("Condition")).toBeInTheDocument();
    expect(screen.getByText("Odd total")).toBeInTheDocument();
    expect(screen.queryByText("Previous cycle")).not.toBeInTheDocument();
  });
  it("labels each card's live value and its comparison", () => {
    const { unmount } = render(
      <IndependentQuestionCard
        question={0}
        snapshot={snapshot()}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("current-0")).toHaveTextContent("7");
    expect(screen.getByText("Previous cycle").nextElementSibling).toHaveTextContent("6");
    unmount();
    render(
      <IndependentQuestionCard
        question={6}
        snapshot={snapshot()}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Endurance / Chrono")).toBeInTheDocument();
    expect(screen.getByTestId("current-6")).toHaveTextContent("#2 / #3");
    expect(screen.getByText("Condition").nextElementSibling).toHaveTextContent("Same gesture");
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

describe("trading through automatic absorption", () => {
  it("labels a startable cycle and prices it from the pools the first trade opens", () => {
    const state = startable();
    render(
      <IndependentQuestionCard question={0} snapshot={state} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Opens with the first trade")).toBeInTheDocument();
    expect(screen.getByTestId("question-incoming-0")).toHaveTextContent("+3 CST");
    expect(screen.getByRole("button", { name: "Buy YES: More gestures?" })).toHaveTextContent(
      "50%",
    );
  });
  it("keeps an unopenable cycle labeled as needing funding without prices", () => {
    const state = startable();
    state.funding = { ...state.funding!, canFund: false };
    render(
      <IndependentQuestionCard question={0} snapshot={state} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Needs funding")).toBeInTheDocument();
    expect(screen.queryByTestId("question-incoming-0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy YES: More gestures?" })).toHaveTextContent("—");
  });
  it("enables a trade that opens the pools, with an honest notice and an effective quote", async () => {
    const state = startable();
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
    expect(screen.getByTestId("independent-trade-absorption")).toHaveTextContent(
      "opens this cycle’s eight pools first, after settling the preceding cycle",
    );
    expect(screen.getByTestId("independent-trade-absorption")).toHaveTextContent(
      "higher network fee",
    );
    await userEvent.type(screen.getByLabelText(/CST to spend/), "1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy YES" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Buy YES" }));
    const pool = { collateral: 3n * ONE, yes: 0n, no: 0n, initialYesBps: 5000 };
    expect(actions.trade).toHaveBeenCalledWith(
      0,
      true,
      true,
      ONE,
      quoteIndependentTrade(pool, true, true, ONE),
    );
  });
  it("re-quotes when the pending allocation changes, even with unchanged on-chain pools", async () => {
    const state = snapshot();
    state.user!.allowance = 1000n * ONE;
    const quiet = { ...noopActions(), trade: vi.fn().mockResolvedValue(true) };
    const props = {
      question: 0 as const,
      yes: true,
      buy: true,
      connected: true,
      actions: quiet,
      onSide: vi.fn(),
      onMode: vi.fn(),
    };
    const { rerender } = render(<IndependentTradePanel snapshot={state} {...props} />);
    await userEvent.type(screen.getByLabelText(/CST to spend/), "10");
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy YES" })).toBeEnabled());
    const before = screen.getByTestId("independent-trade-output").textContent;
    const absorbing = snapshot();
    absorbing.user!.allowance = 1000n * ONE;
    absorbing.heldContributions = 800n * ONE;
    absorbing.funding = {
      ...absorbing.funding!,
      totalFunding: 800n * ONE,
      allocations: fixedAmounts(Array<bigint>(8).fill(100n * ONE)),
      canFund: true,
      unallocated: 800n * ONE,
    };
    rerender(<IndependentTradePanel snapshot={absorbing} {...props} />);
    expect(screen.getByTestId("independent-trade-absorption")).toHaveTextContent(
      "first distributes 800 CST of held contributions",
    );
    await waitFor(() => {
      const text = screen.getByTestId("independent-trade-output").textContent;
      expect(text).not.toBe(before);
      expect(text).not.toMatch(/Calculating/);
    });
    await userEvent.click(screen.getByRole("button", { name: "Buy YES" }));
    expect(quiet.trade).toHaveBeenCalledWith(
      0,
      true,
      true,
      10n * ONE,
      quoteIndependentTrade(
        { ...state.questions[0].pool, collateral: 1100n * ONE },
        true,
        true,
        10n * ONE,
      ),
    );
  });
  it("keeps the trade form closed when nothing can open the pools", () => {
    const state = startable();
    state.funding = { ...state.funding!, canFund: false };
    render(
      <IndependentTradePanel
        snapshot={state}
        question={0}
        yes
        buy
        connected
        actions={noopActions()}
        onSide={vi.fn()}
        onMode={vi.fn()}
      />,
    );
    expect(screen.getByTestId("independent-trade-unfunded")).toHaveTextContent("“Add CST” gift");
    expect(screen.queryByLabelText(/CST to spend/)).not.toBeInTheDocument();
  });
});

describe("independent funding and complete sets", () => {
  it("opens pools from carry and held CST with the bare trigger, without a gift", async () => {
    const state = startable();
    const actions = {
      ...noopActions(),
      distribute: vi.fn().mockResolvedValue(true),
      fund: vi.fn(),
      approve: vi.fn(),
    };
    render(<IndependentFundingPanel snapshot={state} connected actions={actions} />);
    expect(screen.getByTestId("funding-available-carry")).toHaveTextContent("16 CST");
    expect(screen.getByTestId("funding-held")).toHaveTextContent("8 CST");
    expect(screen.getByTestId("trigger-explanation")).toHaveTextContent(
      "Opens the eight pools with 16 carried and 8 held CST, after settling the preceding cycle",
    );
    expect(screen.getByRole("button", { name: "Add CST to all eight pools" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Open pools now" }));
    expect(actions.distribute).toHaveBeenCalledOnce();
    expect(actions.fund).not.toHaveBeenCalled();
    expect(actions.approve).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(mocks.funding).toHaveBeenLastCalledWith(state.market, state.roundId, null, true);
  });
  it("distributes held CST on a trading cycle and explains when it must wait", async () => {
    const state = snapshot();
    state.heldContributions = 5n * ONE;
    state.funding = {
      ...state.funding!,
      totalFunding: 5n * ONE,
      allocations: fixedAmounts(Array<bigint>(8).fill((5n * ONE) / 8n)),
      canFund: true,
      unallocated: 5n * ONE,
    };
    const actions = { ...noopActions(), distribute: vi.fn().mockResolvedValue(true) };
    const { rerender } = render(
      <IndependentFundingPanel snapshot={state} connected actions={actions} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Distribute 5 CST now" }));
    expect(actions.distribute).toHaveBeenCalledOnce();
    const cases: [bigint, bigint, RegExp, string][] = [
      [0n, 0n, /Nothing is waiting/, "Distribute held CST now"],
      [
        ONE / 2n,
        ONE / 2n,
        /Amounts under 1 CST wait: any “Add CST” gift/,
        "Distribute 0.5 CST now",
      ],
      [2n * ONE, ONE / 2n, /at capacity/, "Distribute 2 CST now"],
    ];
    for (const [held, total, explanation, label] of cases) {
      const waiting = snapshot();
      waiting.heldContributions = held;
      waiting.funding = { ...waiting.funding!, totalFunding: total, canFund: false };
      rerender(<IndependentFundingPanel snapshot={waiting} connected actions={actions} />);
      expect(screen.getByTestId("trigger-explanation")).toHaveTextContent(explanation);
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
  });
  it("explains why an unstarted cycle cannot open yet", () => {
    const state = startable();
    const cases: [Partial<NonNullable<typeof state.funding>>, RegExp][] = [
      [{ canFund: false }, /preceding funded cycle cannot be settled yet/],
      [{ canFund: false, needsSettlement: false, totalFunding: 0n }, /Nothing is carried or held/],
      [{ canFund: false, needsSettlement: false, totalFunding: 5n }, /below the opening minimum/],
    ];
    const { rerender } = render(
      <IndependentFundingPanel snapshot={state} connected={false} actions={noopActions()} />,
    );
    expect(screen.queryByRole("button", { name: "Open pools now" })).not.toBeInTheDocument();
    for (const [change, explanation] of cases) {
      const next = startable();
      next.funding = { ...next.funding!, ...change };
      rerender(<IndependentFundingPanel snapshot={next} connected actions={noopActions()} />);
      expect(screen.getByTestId("trigger-explanation")).toHaveTextContent(explanation);
      expect(screen.getByRole("button", { name: "Open pools now" })).toBeDisabled();
    }
  });
  it("blocks a gift while its preview is refreshing or unavailable", async () => {
    const state = snapshot();
    state.user!.allowance = 10n * ONE;
    const data = { ...state.funding!, totalFunding: ONE, canFund: true };
    mocks.funding.mockReturnValue({ data, error: null, isFetching: true });
    const { rerender } = render(
      <IndependentFundingPanel snapshot={state} connected actions={noopActions()} />,
    );
    await userEvent.type(screen.getByLabelText(/New CST to add/), "1");
    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Add CST to all eight pools" })).toBeDisabled();
    mocks.funding.mockReturnValue({ data, error: new Error("RPC offline"), isFetching: false });
    rerender(<IndependentFundingPanel snapshot={state} connected actions={noopActions()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("preview is unavailable");
    expect(screen.getByRole("button", { name: "Add CST to all eight pools" })).toBeDisabled();
  });
  it("shows carry, the gift and swept held CST separately, then sends the exact gift", async () => {
    const state = startable();
    state.user!.allowance = 10n * ONE;
    mocks.funding.mockReturnValue({
      data: {
        ...state.funding!,
        totalFunding: 26n * ONE,
        allocations: fixedAmounts(Array<bigint>(8).fill((26n * ONE) / 8n)),
        deferredCarry: 3n,
      },
      error: null,
      isFetching: false,
    });
    const actions = { ...noopActions(), fund: vi.fn().mockResolvedValue(true) };
    render(<IndependentFundingPanel snapshot={state} connected actions={actions} />);
    await userEvent.type(screen.getByLabelText(/New CST to add/), "2");
    expect(mocks.funding).toHaveBeenLastCalledWith(state.market, state.roundId, 2n * ONE, true);
    expect(screen.getByTestId("funding-carry")).toHaveTextContent("16 CST");
    expect(screen.getByTestId("funding-held-included")).toHaveTextContent("8 CST");
    expect(screen.getByText(/This gift opens this cycle’s pools, first settling/)).toBeVisible();
    expect(screen.getByText(/stays carried for a later cycle/)).toBeVisible();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Add CST to all eight pools" }));
    expect(actions.fund).toHaveBeenCalledWith(2n * ONE);
    expect(screen.getByLabelText(/New CST to add/)).toHaveValue("");
  });
  it("rejects a gift over the capacity left after carry", async () => {
    const state = snapshot();
    mocks.funding.mockReturnValue({
      data: { ...state.funding!, maxNewAmount: ONE },
      error: null,
      isFetching: false,
    });
    render(<IndependentFundingPanel snapshot={state} connected actions={noopActions()} />);
    await userEvent.type(screen.getByLabelText(/New CST to add/), "2");
    expect(screen.getByRole("alert")).toHaveTextContent("exceeds capacity");
    await userEvent.clear(screen.getByLabelText(/New CST to add/));
    await userEvent.type(screen.getByLabelText(/New CST to add/), "5000");
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough CST");
  });
  it("shows the market address, copies it, and warns that direct transfers are CST-only gifts", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const state = snapshot();
    state.open = false;
    render(<IndependentFundingPanel snapshot={state} connected actions={noopActions()} />);
    expect(screen.getByText(/Funding is closed for this cycle/)).toHaveTextContent(
      "joins the next cycle’s pools when they open",
    );
    const notice = screen.getByTestId("independent-direct-transfer");
    expect(screen.getByTestId("independent-market-address")).toHaveTextContent(state.market);
    expect(notice).toHaveTextContent("Send only CST");
    expect(notice).toHaveTextContent("irrevocable gift");
    expect(notice).toHaveTextContent("under 1 CST waits");
    await userEvent.click(screen.getByRole("button", { name: "Copy market address" }));
    expect(writeText).toHaveBeenCalledWith(state.market);
    expect(screen.getByText("Address copied.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy market address" }));
    expect(screen.getByText(/Copy failed/)).toBeInTheDocument();
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
