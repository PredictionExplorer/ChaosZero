import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatCst } from "@/lib/format";
import { minTokensOutForSlippage, ONE, quoteBet, takeFee, type PoolState } from "@/lib/math";
import { BetPanel, type BetPanelProps } from "./bet-panel";

const LIQ = 10_000n * ONE;

/** A funded 50/50 pool whose LPs vote a 2% fee. */
const POOL: PoolState = {
  reserveYes: LIQ,
  reserveNo: LIQ,
  totalShares: LIQ,
  accFeePerShare: 0n,
  feeReserve: 0n,
  feeWeight: LIQ * 200n,
};

function renderPanel(overrides: Partial<BetPanelProps> = {}) {
  const props: BetPanelProps = {
    pool: POOL,
    balance: 1_000n * ONE,
    allowance: 10_000_000n * ONE,
    pendingAction: null,
    onConnect: vi.fn(),
    onApprove: vi.fn().mockResolvedValue(true),
    onBet: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  const utils = render(<BetPanel {...props} />);
  return { props, ...utils };
}

describe("BetPanel", () => {
  it("quotes with the shared math library at the pool's voted fee", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByTestId("amount-input"), "100");

    const expected = quoteBet("yes", POOL, 100n * ONE);
    const tokens = screen.getByTestId("quote-tokens");
    expect(tokens.textContent).toContain(formatCst(expected));
    expect(tokens.textContent).toContain("YES");
    // The fee line shows the LP-voted 2% and the exact CST amount.
    const { fee } = takeFee(100n * ONE, 200n);
    expect(screen.getByText(/Fee \(2%, LP-voted\)/)).toBeInTheDocument();
    expect(screen.getByTestId("quote-fee").textContent).toContain(formatCst(fee));
    const minOut = minTokensOutForSlippage(expected, 50);
    expect(screen.getByTestId("quote-min-out").textContent).toContain(formatCst(minOut));
  });

  it("switches sides and submits NO bets with the slippage floor", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByTestId("tab-no"));
    await user.type(screen.getByTestId("amount-input"), "50");
    await user.click(screen.getByTestId("bet-submit"));

    expect(screen.getByTestId("tab-no")).toHaveAttribute("aria-selected", "true");
    const expected = quoteBet("no", POOL, 50n * ONE);
    expect(props.onBet).toHaveBeenCalledWith(
      "no",
      50n * ONE,
      minTokensOutForSlippage(expected, 50),
    );
  });

  it("adjusting slippage tightens the submitted floor", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByLabelText("Slippage settings"));
    await user.click(screen.getByRole("button", { name: "0.1%" }));
    await user.type(screen.getByTestId("amount-input"), "50");
    await user.click(screen.getByTestId("bet-submit"));

    const expected = quoteBet("yes", POOL, 50n * ONE);
    expect(props.onBet).toHaveBeenCalledWith(
      "yes",
      50n * ONE,
      minTokensOutForSlippage(expected, 10),
    );
  });

  it("routes through approval when allowance is too low", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ allowance: 0n });

    await user.type(screen.getByTestId("amount-input"), "10");
    expect(screen.getByTestId("bet-submit")).toHaveTextContent(/approve/i);
    await user.click(screen.getByTestId("bet-submit"));

    expect(props.onApprove).toHaveBeenCalledWith(10n * ONE);
    expect(props.onBet).not.toHaveBeenCalled();
  });

  it("blocks oversized bets and flags bad input", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ balance: 5n * ONE });

    await user.type(screen.getByTestId("amount-input"), "10");
    expect(screen.getByTestId("bet-submit")).toHaveTextContent(/insufficient/i);
    await user.click(screen.getByTestId("bet-submit"));
    expect(props.onBet).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId("amount-input"));
    await user.type(screen.getByTestId("amount-input"), "1.2.3");
    expect(screen.getByTestId("input-error")).toBeInTheDocument();
  });

  it("disables betting into an unfunded pool", () => {
    renderPanel({
      pool: { ...POOL, reserveYes: 0n, reserveNo: 0n, totalShares: 0n, feeWeight: 0n },
    });
    expect(screen.getByTestId("bet-submit")).toHaveTextContent(/no liquidity/i);
    expect(screen.getByTestId("bet-submit")).toBeDisabled();
  });

  it("prompts to connect when no wallet is present", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ balance: null, allowance: null });

    expect(screen.getByTestId("bet-submit")).toHaveTextContent(/connect wallet/i);
    await user.click(screen.getByTestId("bet-submit"));
    expect(props.onConnect).toHaveBeenCalled();
  });

  it("clears the input only after a successful bet", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ onBet: vi.fn().mockResolvedValue(false) });

    const input = screen.getByTestId<HTMLInputElement>("amount-input");
    await user.type(input, "50");
    await user.click(screen.getByTestId("bet-submit"));
    expect(props.onBet).toHaveBeenCalled();
    expect(input.value).toBe("50");
  });
});

describe("BetPanel — tooltips", () => {
  it("explains every quote row", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("amount-input"), "100");

    const rows: ReadonlyArray<[string, RegExp]> = [
      ["About the tokens you receive", /pays exactly 1 CST if YES wins/i],
      ["About the payout", /1 CST per token/i],
      ["About your entry price", /CST in ÷ tokens out/i],
      ["About the fee", /share-weighted average of all LP fee votes/i],
      ["About the minimum received", /reverts instead of filling badly/i],
    ];
    for (const [name, copy] of rows) {
      const trigger = screen.getByRole("button", { name });
      await user.hover(trigger);
      expect(screen.getByRole("tooltip")).toHaveTextContent(copy);
      await user.unhover(trigger);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    }
  });

  it("frames the entry tooltip around the chosen side", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId("tab-no"));
    await user.type(screen.getByTestId("amount-input"), "100");
    await user.hover(screen.getByRole("button", { name: "About your entry price" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/NO's real chance/i);
  });

  it("explains max slippage in the settings row", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByLabelText("Slippage settings"));
    await user.hover(screen.getByRole("button", { name: "About max slippage" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/before your bet reverts/i);
  });
});

describe("BetPanel — amount shortcuts and progress", () => {
  it("MAX fills the whole balance, to the wei", async () => {
    const user = userEvent.setup();
    renderPanel({ balance: 1_234_567_890_123_456_789n });

    await user.click(screen.getByTestId("max-button"));

    expect(screen.getByTestId<HTMLInputElement>("amount-input").value).toBe("1.234567890123456789");
  });

  it("MAX with an empty wallet clears the amount instead of entering zero", async () => {
    const user = userEvent.setup();
    renderPanel({ balance: 0n });

    await user.type(screen.getByTestId("amount-input"), "5");
    await user.click(screen.getByTestId("max-button"));

    expect(screen.getByTestId<HTMLInputElement>("amount-input").value).toBe("");
  });

  it("hides the balance shortcut until a wallet is connected", () => {
    renderPanel({ balance: null, allowance: null });
    expect(screen.queryByTestId("max-button")).not.toBeInTheDocument();
  });

  it("switches back to YES after looking at NO", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByTestId("tab-no"));
    await user.click(screen.getByTestId("tab-yes"));
    await user.type(screen.getByTestId("amount-input"), "20");
    await user.click(screen.getByTestId("bet-submit"));

    expect(screen.getByTestId("tab-yes")).toHaveAttribute("aria-selected", "true");
    expect(props.onBet).toHaveBeenCalledWith("yes", 20n * ONE, expect.any(BigInt));
  });

  it.each([
    ["approve", "Approving…"],
    ["bet", "Confirming…"],
  ] as const)("shows %s progress and blocks resubmission", async (pendingAction, label) => {
    renderPanel({ pendingAction });

    expect(screen.getByTestId("bet-submit")).toHaveTextContent(label);
    expect(screen.getByTestId("bet-submit")).toBeDisabled();
  });

  it("clears the amount after a confirmed bet", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByTestId("amount-input"), "50");
    await user.click(screen.getByTestId("bet-submit"));

    expect(screen.getByTestId<HTMLInputElement>("amount-input").value).toBe("");
  });
});
