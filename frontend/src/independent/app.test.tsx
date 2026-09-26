import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ONE } from "@/shared/math";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndependentDashboard } from "./app";
import { ACCOUNT, MARKET, noopActions, snapshot } from "./test-fixtures";
const mocks = vi.hoisted(() => ({ market: vi.fn(), recovery: vi.fn(), actions: vi.fn() }));
vi.mock("./use-independent-market", () => ({
  useIndependentMarket: mocks.market,
  useIndependentRecovery: mocks.recovery,
  useIndependentFundingPreview: vi.fn(),
}));
vi.mock("./use-independent-actions", () => ({ useIndependentActions: mocks.actions }));
vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: "connected",
    address: "0x1111111111111111111111111111111111111111",
  }),
  useChainId: () => 31337,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/shared",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/wallet/connect-button", () => ({
  ConnectButton: () => <button>Connect wallet</button>,
}));
beforeEach(() => {
  mocks.recovery.mockReturnValue({
    data: undefined,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  });
  mocks.actions.mockReturnValue(noopActions());
});
describe("independent dashboard failure boundaries", () => {
  it("does not pass a cached normal snapshot to write actions after source failure", () => {
    mocks.market.mockReturnValue({
      data: snapshot(),
      error: new Error("Source offline"),
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<IndependentDashboard market={MARKET} override={null} />);
    expect(mocks.actions).toHaveBeenLastCalledWith(MARKET, undefined, undefined);
    expect(screen.queryByTestId("independent-trade-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("independent-funding-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("independent-recovery")).toBeInTheDocument();
    expect(mocks.recovery).toHaveBeenCalledWith(MARKET, 1n, true);
  });
  it("never guesses a recovery cycle when initial source reads fail", () => {
    mocks.market.mockReturnValue({
      data: undefined,
      error: new Error("Source offline"),
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<IndependentDashboard market={MARKET} override={null} />);
    expect(mocks.recovery).toHaveBeenCalledWith(MARKET, null, true);
    expect(screen.getByText(/cannot be guessed/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retrieve settled winnings" }),
    ).not.toBeInTheDocument();
  });
  it("passes only a completed fresh recovery read to source-independent actions", () => {
    const state = snapshot();
    const data = {
      market: MARKET,
      token: state.token,
      vault: state.vault,
      roundId: 1n,
      timestamp: 500n,
      settled: true,
      values: 1,
      questions: state.questions,
      user: { ...state.user!, owner: ACCOUNT },
    };
    mocks.market.mockReturnValue({
      data: state,
      error: new Error("Source offline"),
      refetch: vi.fn(),
    });
    mocks.recovery.mockReturnValue({ data, error: null, isFetching: true, refetch: vi.fn() });
    const { rerender } = render(<IndependentDashboard market={MARKET} override={null} />);
    expect(mocks.actions).toHaveBeenLastCalledWith(MARKET, undefined, undefined);
    mocks.recovery.mockReturnValue({ data, error: null, isFetching: false, refetch: vi.fn() });
    rerender(<IndependentDashboard market={MARKET} override={null} />);
    expect(mocks.actions).toHaveBeenLastCalledWith(MARKET, undefined, data);
  });
});

describe("independent dashboard contributions", () => {
  it("separates carried CST from held contributions waiting to enter pools", () => {
    const state = snapshot();
    state.pendingCarry = 12n * ONE;
    state.heldContributions = 3n * ONE;
    mocks.market.mockReturnValue({ data: state, error: null, isFetching: false, refetch: vi.fn() });
    render(<IndependentDashboard market={MARKET} override={null} />);
    expect(screen.getByTestId("independent-waiting")).toHaveTextContent("15 CST");
    expect(screen.getByTestId("independent-carry")).toHaveTextContent("12 CST");
    expect(screen.getByTestId("independent-held")).toHaveTextContent("3 CST");
    expect(screen.getByTestId("independent-held-note")).toHaveTextContent(
      "next trade on a trading cycle or when anyone distributes them",
    );
  });
  it("offers a local-only direct transfer to exercise automatic distribution", async () => {
    const actions = { ...noopActions(), local: vi.fn().mockResolvedValue(true) };
    mocks.actions.mockReturnValue(actions);
    const state = snapshot();
    mocks.market.mockReturnValue({ data: state, error: null, isFetching: false, refetch: vi.fn() });
    const { rerender } = render(<IndependentDashboard market={MARKET} override={null} />);
    expect(screen.queryByTestId("independent-held-note")).not.toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: "Send 100 test CST directly to the market",
    });
    await userEvent.click(button);
    expect(actions.local).toHaveBeenCalledWith("direct");
    const poor = snapshot();
    poor.user!.balance = 99n * ONE;
    mocks.market.mockReturnValue({ data: poor, error: null, isFetching: false, refetch: vi.fn() });
    rerender(<IndependentDashboard market={MARKET} override={null} />);
    expect(
      screen.getByRole("button", { name: "Send 100 test CST directly to the market" }),
    ).toBeDisabled();
  });
});
