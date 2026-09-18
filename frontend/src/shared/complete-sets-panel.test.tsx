import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  CompleteSetsPanel,
  TransferPositionPanel,
  type CompleteSetsPanelProps,
} from "./complete-sets-panel";
import { ONE } from "./math";
vi.mock("@/components/wallet/connect-button", () => ({
  ConnectButton: () => <button>Connect wallet</button>,
}));
const zero = () => Array<bigint>(8).fill(0n);
function props(overrides: Partial<CompleteSetsPanelProps> = {}): CompleteSetsPanelProps {
  return {
    roundId: 1n,
    user: {
      yes: [5n * ONE, 2n * ONE, ...zero().slice(2)],
      no: [3n * ONE, 4n * ONE, ...zero().slice(2)],
      balance: 100n * ONE,
      allowance: 0n,
    },
    collateral: 1000n * ONE,
    open: true,
    knownMask: 0,
    connected: true,
    pending: null,
    onApprove: vi.fn().mockResolvedValue(true),
    onSplit: vi.fn().mockResolvedValue(true),
    onMerge: vi.fn().mockResolvedValue(true),
    onMergeAll: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("complete-set controls", () => {
  it("allows a price-neutral split before AMM sponsorship, with exact CST approval first", async () => {
    const p = props({ collateral: 0n });
    const { rerender } = render(<CompleteSetsPanel {...p} />);
    await userEvent.type(screen.getByLabelText("CST to split"), "2.5");
    expect(screen.getByTestId("complete-set-output")).toHaveTextContent("Receive 2.5 YES + 2.5 NO");
    await userEvent.click(screen.getByRole("button", { name: "Approve CST to split" }));
    expect(p.onApprove).toHaveBeenCalledWith((25n * ONE) / 10n);
    expect(p.onSplit).not.toHaveBeenCalled();
    rerender(<CompleteSetsPanel {...p} user={{ ...p.user!, allowance: 100n * ONE }} />);
    await userEvent.click(screen.getByRole("button", { name: "Split into YES + NO" }));
    expect(p.onSplit).toHaveBeenCalledWith(0, (25n * ONE) / 10n);
  });

  it("merges exact matched units after cycle closure without approval or an AMM quote", async () => {
    const p = props({ open: false, knownMask: 255 });
    render(<CompleteSetsPanel {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Merge pairs" }));
    expect(screen.getByTestId("selected-matched-pairs")).toHaveTextContent("3");
    await userEvent.click(screen.getByRole("button", { name: "Use maximum" }));
    await userEvent.click(screen.getByRole("button", { name: "Merge pairs into CST" }));
    expect(p.onMerge).toHaveBeenCalledWith(0, 3n * ONE);
    expect(p.onApprove).not.toHaveBeenCalled();
  });

  it("batches only same-question pairs and reports the exact aggregate CST payout", async () => {
    const p = props();
    render(<CompleteSetsPanel {...p} />);
    expect(screen.getByTestId("all-matched-pairs")).toHaveTextContent("5 CST");
    await userEvent.click(screen.getByRole("button", { name: "Merge all matched pairs" }));
    expect(p.onMergeAll).toHaveBeenCalledWith([3n * ONE, 2n * ONE, 0n, 0n, 0n, 0n, 0n, 0n]);
  });

  it("does not match opposite outcomes from different questions", () => {
    const p = props({
      user: {
        yes: [5n * ONE, ...zero().slice(1)],
        no: [0n, 5n * ONE, ...zero().slice(2)],
        balance: ONE,
        allowance: 0n,
      },
    });
    render(<CompleteSetsPanel {...p} />);
    expect(screen.getByTestId("all-matched-pairs")).toHaveTextContent("0 CST");
    expect(screen.getByRole("button", { name: "Merge all matched pairs" })).toBeDisabled();
  });

  it("rejects overprecision, insufficient matching balances and closed-question splits", async () => {
    const p = props({ knownMask: 1 });
    render(<CompleteSetsPanel {...p} />);
    await userEvent.type(screen.getByLabelText("CST to split"), "1");
    expect(screen.getByRole("button", { name: "Approve CST to split" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Merge pairs" }));
    await userEvent.type(screen.getByLabelText("Pairs to merge"), "4");
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough matched");
    await userEvent.clear(screen.getByLabelText("Pairs to merge"));
    await userEvent.type(screen.getByLabelText("Pairs to merge"), "0.0000000000000000001");
    expect(screen.getByRole("alert")).toHaveTextContent("Max 18 decimal places");
    expect(screen.getByRole("button", { name: "Merge pairs into CST" })).toBeDisabled();
  });

  it("shows exact dust and large conversions without rounding the promised payout", async () => {
    const p = props({
      user: {
        yes: [1n, ...zero().slice(1)],
        no: [1n, ...zero().slice(1)],
        balance: 999999999999999999999999999999999999n,
        allowance: 999999999999999999999999999999999999n,
      },
    });
    render(<CompleteSetsPanel {...p} />);
    await userEvent.type(screen.getByLabelText("CST to split"), "0.000000000000000001");
    expect(screen.getByTestId("complete-set-output")).toHaveTextContent(
      "0.000000000000000001 YES + 0.000000000000000001 NO",
    );
    expect(screen.getByTestId("batch-merge-exact")).toHaveTextContent("0.000000000000000001 CST");
    await userEvent.clear(screen.getByLabelText("CST to split"));
    await userEvent.type(
      screen.getByLabelText("CST to split"),
      "123456789012345.123456789012345678",
    );
    expect(screen.getByTestId("complete-set-output")).toHaveTextContent(
      "123456789012345.123456789012345678 YES",
    );
  });

  it("keeps a split draft after a rejected transaction so it can be reviewed and retried", async () => {
    const p = props();
    p.user!.allowance = 100n * ONE;
    p.onSplit = vi.fn().mockResolvedValue(false);
    render(<CompleteSetsPanel {...p} />);
    await userEvent.type(screen.getByLabelText("CST to split"), "2.25");
    await userEvent.click(screen.getByRole("button", { name: "Split into YES + NO" }));
    expect(p.onSplit).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("CST to split")).toHaveValue("2.25");
  });

  it("locks modes, inputs and all operations during an in-progress transaction", () => {
    render(<CompleteSetsPanel {...props({ pending: "Complete-set split" })} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});

describe("position transfer controls", () => {
  const sender = "0x1111111111111111111111111111111111111111" as const;
  const market = "0x2222222222222222222222222222222222222222" as const;
  const recipient = "0x3333333333333333333333333333333333333333" as const;
  function transferProps() {
    return {
      roundId: 1n,
      question: 0 as const,
      yes: true,
      available: 5n * ONE,
      market,
      sender,
      pending: null,
      onTransfer: vi.fn().mockResolvedValue(true),
      onCancel: vi.fn(),
    };
  }
  it("clears an invalid-recipient error after correction and sends exact owner units", async () => {
    const p = transferProps();
    render(<TransferPositionPanel {...p} />);
    await userEvent.type(screen.getByLabelText("Recipient address"), market);
    expect(screen.getByRole("alert")).toHaveTextContent("market contract");
    await userEvent.clear(screen.getByLabelText("Recipient address"));
    await userEvent.type(screen.getByLabelText("Recipient address"), recipient);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Position units to transfer"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Transfer positions" }));
    expect(p.onTransfer).toHaveBeenCalledWith(0, true, 2n * ONE, recipient);
    await waitFor(() => expect(p.onCancel).toHaveBeenCalledOnce());
  });
  it("preserves the recipient and amount after wallet rejection and allows explicit cancellation", async () => {
    const p = transferProps();
    p.onTransfer.mockResolvedValue(false);
    render(<TransferPositionPanel {...p} />);
    await userEvent.type(screen.getByLabelText("Recipient address"), recipient);
    await userEvent.type(
      screen.getByLabelText("Position units to transfer"),
      "0.000000000000000001",
    );
    expect(screen.getByText(/Send 0.000000000000000001 YES/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Transfer positions" }));
    expect(p.onCancel).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Recipient address")).toHaveValue(recipient);
    expect(screen.getByLabelText("Position units to transfer")).toHaveValue("0.000000000000000001");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onCancel).toHaveBeenCalledOnce();
  });
  it("rejects an overdraw and prevents writes while pending", async () => {
    const p = transferProps();
    const { rerender } = render(<TransferPositionPanel {...p} />);
    await userEvent.type(screen.getByLabelText("Recipient address"), recipient);
    await userEvent.type(screen.getByLabelText("Position units to transfer"), "6");
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough position");
    expect(screen.getByRole("button", { name: "Transfer positions" })).toBeDisabled();
    rerender(<TransferPositionPanel {...p} pending="Position transfer" />);
    for (const input of within(screen.getByTestId("transfer-position-panel")).getAllByRole(
      "textbox",
    ))
      expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
