import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PositionRecoveryPanel } from "./position-recovery-panel";
import { MAX_ROUND_ID } from "./positions";
import { ONE } from "./math";
import type { PositionRecovery } from "./use-position-recovery";
import type { useSharedActions } from "./use-shared-market";
vi.mock("@/components/wallet/connect-button", () => ({
  ConnectButton: () => <button>Connect wallet</button>,
}));
const owner = "0x1111111111111111111111111111111111111111" as const;
const market = "0x2222222222222222222222222222222222222222" as const;
const data: PositionRecovery = {
  owner,
  roundId: 2n,
  token: market,
  timestamp: 100n,
  collateral: 10n * ONE,
  user: {
    yes: [2n * ONE, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    no: [2n * ONE, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    balance: ONE,
    allowance: 0n,
  },
};
function actions(): ReturnType<typeof useSharedActions> {
  return {
    pending: null,
    message: null,
    approve: vi.fn(),
    split: vi.fn(),
    merge: vi.fn().mockResolvedValue(true),
    mergeAll: vi.fn(),
    transfer: vi.fn(),
    fund: vi.fn(),
    trade: vi.fn(),
    claim: vi.fn(),
    rollover: vi.fn(),
    local: vi.fn(),
    advance: vi.fn(),
  };
}
function props() {
  return {
    market,
    sender: owner,
    roundId: 2n as bigint | null,
    onRound: vi.fn(),
    query: { data, error: null as Error | null, isFetching: false, refetch: vi.fn() },
    actions: actions(),
    connected: true,
  };
}

describe("source-independent recovery display", () => {
  it("preserves typed merge and transfer inputs through polling while disabling transactions", async () => {
    const p = props();
    const { rerender } = render(<PositionRecoveryPanel {...p} />);
    await userEvent.type(screen.getByLabelText("Pairs to merge"), "1.25");
    await userEvent.click(screen.getByRole("button", { name: "Transfer YES: More gestures?" }));
    await userEvent.type(
      screen.getByLabelText("Recipient address"),
      "0x3333333333333333333333333333333333333333",
    );
    await userEvent.type(screen.getByLabelText("Position units to transfer"), "0.5");
    rerender(<PositionRecoveryPanel {...p} query={{ ...p.query, isFetching: true }} />);
    expect(screen.getByLabelText("Pairs to merge")).toHaveValue("1.25");
    expect(screen.getByLabelText("Position units to transfer")).toHaveValue("0.5");
    expect(screen.getByRole("button", { name: "Merge pairs into CST" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Transfer positions" })).toBeDisabled();
    rerender(<PositionRecoveryPanel {...p} />);
    expect(screen.getByLabelText("Pairs to merge")).toHaveValue("1.25");
    expect(screen.getByRole("button", { name: "Merge pairs into CST" })).toBeEnabled();
  });
  it("removes recovery operations on refresh error or an owner/cycle mismatch", () => {
    const p = props();
    const { rerender } = render(<PositionRecoveryPanel {...p} />);
    expect(screen.getByTestId("complete-sets-panel")).toBeInTheDocument();
    rerender(
      <PositionRecoveryPanel {...p} query={{ ...p.query, error: new Error("RPC failed") }} />,
    );
    expect(screen.queryByTestId("complete-sets-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No recovery transaction is available");
    rerender(<PositionRecoveryPanel {...p} sender="0x3333333333333333333333333333333333333333" />);
    expect(screen.queryByTestId("complete-sets-panel")).not.toBeInTheDocument();
    rerender(<PositionRecoveryPanel {...p} roundId={3n} />);
    expect(screen.queryByTestId("complete-sets-panel")).not.toBeInTheDocument();
  });
  it("never offers source-dependent financial actions during recovery", () => {
    render(<PositionRecoveryPanel {...props()} />);
    const panel = within(screen.getByTestId("position-recovery"));
    expect(panel.queryByRole("button", { name: "Split CST" })).not.toBeInTheDocument();
    expect(
      panel.queryByRole("button", { name: /Gift|Buy|Retrieve known/ }),
    ).not.toBeInTheDocument();
  });
  it("requires an explicit supported cycle instead of guessing the current cycle", async () => {
    const p = props();
    render(<PositionRecoveryPanel {...p} roundId={null} query={{ ...p.query, data: undefined }} />);
    expect(screen.getByText(/cannot be inferred/)).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Explicit cycle number"),
      (MAX_ROUND_ID + 1n).toString(),
    );
    expect(screen.getByRole("button", { name: "Load cycle positions" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Explicit cycle number"));
    await userEvent.type(screen.getByLabelText("Explicit cycle number"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Load cycle positions" }));
    expect(p.onRound).toHaveBeenCalledWith(3n);
  });
});
