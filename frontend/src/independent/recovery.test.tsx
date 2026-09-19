import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IndependentRecoveryPanel } from "./recovery";
import { ACCOUNT, GAME, MARKET, TOKEN, VAULT, noopActions, snapshot, zero } from "./test-fixtures";
import { fixedAmounts, type IndependentRecovery } from "./models";
import { MAX_ROUND_ID } from "@/shared/positions";
import { ONE } from "@/shared/math";
vi.mock("@/components/wallet/connect-button", () => ({
  ConnectButton: () => <button>Connect wallet</button>,
}));
function props() {
  const user = snapshot().user!;
  user.no = fixedAmounts([2n * ONE, ...zero().slice(1)]);
  const data: IndependentRecovery = {
    market: MARKET,
    token: TOKEN,
    vault: VAULT,
    roundId: 1n,
    timestamp: 500n,
    settled: true,
    values: 1,
    questions: snapshot().questions,
    user,
  };
  return {
    market: MARKET,
    owner: ACCOUNT as `0x${string}` | undefined,
    roundId: 1n as bigint | null,
    onRound: vi.fn(),
    query: {
      data: data as IndependentRecovery | undefined,
      error: null as Error | null,
      isFetching: false,
      refetch: vi.fn(),
    },
    actions: { ...noopActions(), claim: vi.fn().mockResolvedValue(true) },
    connected: true,
  };
}
describe("independent recovery interface", () => {
  it("retrieves only cached settled payouts while ordinary funding/trading are unavailable", async () => {
    const p = props();
    render(<IndependentRecoveryPanel {...p} />);
    expect(screen.getByTestId("recovery-claimable")).toHaveTextContent("10 CST");
    await userEvent.click(screen.getByRole("button", { name: "Retrieve settled winnings" }));
    expect(p.actions.claim).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Split CST" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fund all/ })).not.toBeInTheDocument();
  });
  it("does not offer claims before recorded settlement", () => {
    const p = props();
    p.query.data!.settled = false;
    render(<IndependentRecoveryPanel {...p} />);
    expect(
      screen.queryByRole("button", { name: "Retrieve settled winnings" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Claims need recorded settlement/)).toBeInTheDocument();
  });
  it("preserves same-owner drafts during polling and locks operations until fresh reads complete", async () => {
    const p = props();
    const { rerender } = render(<IndependentRecoveryPanel {...p} />);
    await userEvent.type(screen.getByLabelText("Pairs to merge"), "1.25");
    await userEvent.click(screen.getByRole("button", { name: "Transfer YES: More gestures?" }));
    await userEvent.type(screen.getByLabelText("Recipient address"), GAME);
    rerender(<IndependentRecoveryPanel {...p} query={{ ...p.query, isFetching: true }} />);
    expect(screen.getByLabelText("Pairs to merge")).toHaveValue("1.25");
    expect(screen.getByLabelText("Recipient address")).toHaveValue(GAME);
    expect(screen.getByRole("button", { name: "Merge pairs into CST" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retrieve settled winnings" })).toBeDisabled();
    rerender(<IndependentRecoveryPanel {...p} />);
    expect(screen.getByRole("button", { name: "Merge pairs into CST" })).toBeEnabled();
  });
  it.each(["owner", "market", "cycle", "RPC"])(
    "fails closed on recovery %s mismatch or failure",
    (reason) => {
      const p = props();
      if (reason === "owner") p.owner = GAME;
      if (reason === "market") p.query.data!.market = GAME;
      if (reason === "cycle") p.roundId = 2n;
      if (reason === "RPC") p.query.error = new Error("RPC down");
      render(<IndependentRecoveryPanel {...p} />);
      expect(screen.queryByTestId("independent-sets-panel")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Retrieve settled winnings" }),
      ).not.toBeInTheDocument();
    },
  );
  it("requires an explicit supported cycle when no earlier snapshot exists", async () => {
    const p = props();
    p.roundId = null;
    p.query.data = undefined;
    render(<IndependentRecoveryPanel {...p} />);
    expect(screen.getByText(/cannot be guessed/)).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Explicit cycle number"),
      (MAX_ROUND_ID + 1n).toString(),
    );
    expect(screen.getByRole("button", { name: "Load positions" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Explicit cycle number"));
    await userEvent.type(screen.getByLabelText("Explicit cycle number"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Load positions" }));
    expect(p.onRound).toHaveBeenCalledWith(2n);
  });
});
