import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ONE } from "./math";
import { TransferPositionPanel } from "./transfer-position-panel";

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
