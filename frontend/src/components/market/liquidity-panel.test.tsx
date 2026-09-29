import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  currentFeeBps,
  EMPTY_POOL,
  feeAfterDeclarationChange,
  joinPool,
  minTokensOutForSlippage,
  ONE,
  openPool,
  removeLiquidity,
  type PoolState,
} from "@/lib/math";
import { LiquidityPanel, type LiquidityPanelProps } from "./liquidity-panel";

const LIQ = 10_000n * ONE;

/** A skewed funded pool (2:1) whose LPs vote a 2% fee. */
const POOL: PoolState = {
  reserveYes: LIQ,
  reserveNo: LIQ / 2n,
  totalShares: LIQ,
  accFeePerShare: 0n,
  feeReserve: 0n,
  feeWeight: LIQ * 200n,
};

function renderPanel(overrides: Partial<LiquidityPanelProps> = {}) {
  const props: LiquidityPanelProps = {
    pool: POOL,
    lpShares: 0n,
    lpPendingFees: 0n,
    lpDeclaredFeeBps: 0,
    canAdd: true,
    balance: 100_000n * ONE,
    allowance: 10_000_000n * ONE,
    pendingAction: null,
    onConnect: vi.fn(),
    onApprove: vi.fn().mockResolvedValue(true),
    onAdd: vi.fn().mockResolvedValue(true),
    onRemove: vi.fn().mockResolvedValue(true),
    onUpdateFee: vi.fn().mockResolvedValue(true),
    onClaimFees: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  const utils = render(<LiquidityPanel {...props} />);
  return { props, ...utils };
}

describe("LiquidityPanel — adding", () => {
  it("shows the pool's live weighted fee", () => {
    renderPanel();
    expect(screen.getByTestId("lp-pool-fee")).toHaveTextContent("2%");
  });

  it("joins at the pool ratio and submits with the fee vote and a share floor", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    // Vote 5% instead of the default 2%.
    fireEvent.change(screen.getByTestId("lp-fee-vote-slider"), { target: { value: "500" } });
    expect(screen.getByTestId("lp-fee-vote-value")).toHaveTextContent("5%");

    await user.type(screen.getByTestId("lp-amount-input"), "100");
    const preview = joinPool(POOL, 100n * ONE, 500n)!;
    // The preview shows how the deposit moves the pool's fee.
    expect(screen.getByTestId("lp-preview-fee").textContent).toContain("2%");
    expect(screen.getByTestId("lp-preview-fee").textContent).toContain(
      `${Number(currentFeeBps(preview.pool)) / 100}%`,
    );
    // Skewed pool: the NO side is deposited partially, excess returned.
    expect(preview.excessNo).toBeGreaterThan(0n);
    expect(screen.getByTestId("lp-preview-excess").textContent).toContain("NO");

    await user.click(screen.getByTestId("lp-add-submit"));
    expect(props.onAdd).toHaveBeenCalledWith(
      100n * ONE,
      500,
      5_000n, // ignored by the contract when joining
      minTokensOutForSlippage(preview.sharesOut, 50),
    );
  });

  it("first LP picks the opening odds and their vote becomes the pool fee", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ pool: EMPTY_POOL });

    expect(screen.getByTestId("lp-pool-fee")).toHaveTextContent("—");
    expect(screen.getByTestId("lp-odds")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("lp-odds-slider"), { target: { value: "30" } });
    expect(screen.getByTestId("lp-odds-value")).toHaveTextContent("30%");
    fireEvent.change(screen.getByTestId("lp-fee-vote-slider"), { target: { value: "100" } });

    await user.type(screen.getByTestId("lp-amount-input"), "10");
    const preview = openPool(10n * ONE, 3_000n, 100n);
    expect(screen.getByTestId("lp-preview-fee").textContent).toContain("1%");

    await user.click(screen.getByTestId("lp-add-submit"));
    expect(props.onAdd).toHaveBeenCalledWith(
      10n * ONE,
      100,
      3_000n,
      minTokensOutForSlippage(preview.sharesOut, 50),
    );
  });

  it("rejects first deposits below the contract minimum", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ pool: EMPTY_POOL });
    await user.type(screen.getByTestId("lp-amount-input"), "0.0000001");
    expect(screen.getByTestId("lp-add-error")).toHaveTextContent(/minimum/i);
    await user.click(screen.getByTestId("lp-add-submit"));
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("routes through approval when allowance is too low", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ allowance: 0n });
    await user.type(screen.getByTestId("lp-amount-input"), "10");
    await user.click(screen.getByTestId("lp-add-submit"));
    expect(props.onApprove).toHaveBeenCalledWith(10n * ONE);
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("hides the add flow when the round no longer accepts liquidity", () => {
    renderPanel({ canAdd: false });
    expect(screen.getByTestId("lp-add-closed")).toBeInTheDocument();
    expect(screen.queryByTestId("lp-amount-input")).not.toBeInTheDocument();
  });

  it("prompts to connect when no wallet is present", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ balance: null, allowance: null });
    await user.type(screen.getByTestId("lp-amount-input"), "10");
    await user.click(screen.getByTestId("lp-add-submit"));
    expect(props.onConnect).toHaveBeenCalled();
  });
});

describe("LiquidityPanel — position, re-voting, removing, fees", () => {
  const position = { lpShares: 4_000n * ONE, lpPendingFees: 12n * ONE, lpDeclaredFeeBps: 200 };

  it("shows the position with the user's vote and claims fees", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel(position);

    expect(screen.getByTestId("lp-position")).toBeInTheDocument();
    expect(screen.getByTestId("lp-my-vote")).toHaveTextContent("2%");
    expect(screen.getByTestId("lp-pending-fees")).toHaveTextContent("12");
    await user.click(screen.getByTestId("claim-fees-button"));
    expect(props.onClaimFees).toHaveBeenCalled();
  });

  it("re-votes the fee with a live pool-average preview", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel(position);

    await user.click(screen.getByTestId("lp-my-vote"));
    fireEvent.change(screen.getByTestId("lp-revote-slider"), { target: { value: "800" } });
    expect(screen.getByTestId("lp-revote-value")).toHaveTextContent("8%");

    const expected = feeAfterDeclarationChange(POOL, position.lpShares, 200n, 800n);
    expect(screen.getByTestId("lp-revote-preview").textContent).toContain(`${Number(expected) / 100}%`);

    await user.click(screen.getByTestId("lp-revote-submit"));
    expect(props.onUpdateFee).toHaveBeenCalledWith(800);
  });

  it("previews and submits a partial removal with slippage floors", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel(position);

    await user.click(screen.getByTestId("lp-mode-remove"));
    fireEvent.change(screen.getByTestId("lp-remove-slider"), { target: { value: "50" } });
    expect(screen.getByTestId("lp-remove-pct")).toHaveTextContent("50%");

    const shares = (position.lpShares * 50n) / 100n;
    const preview = removeLiquidity(POOL, shares, 200n);
    expect(screen.getByTestId("lp-remove-preview").textContent).toContain("YES");

    await user.click(screen.getByTestId("lp-remove-submit"));
    expect(props.onRemove).toHaveBeenCalledWith(
      shares,
      minTokensOutForSlippage(preview.yesOut, 50),
      minTokensOutForSlippage(preview.noOut, 50),
    );
  });

  it("explains when there is nothing to remove", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId("lp-mode-remove"));
    expect(screen.getByTestId("lp-no-position")).toBeInTheDocument();
  });

  it("keeps the re-vote panel open when the vote transaction fails", async () => {
    const user = userEvent.setup();
    renderPanel({ ...position, onUpdateFee: vi.fn().mockResolvedValue(false) });

    await user.click(screen.getByTestId("lp-my-vote"));
    fireEvent.change(screen.getByTestId("lp-revote-slider"), { target: { value: "500" } });
    await user.click(screen.getByTestId("lp-revote-submit"));

    expect(screen.getByTestId("lp-revote")).toBeInTheDocument();
    expect(screen.getByTestId("lp-revote-value")).toHaveTextContent("5%");
  });

  it("closes the re-vote panel once the new vote is confirmed", async () => {
    const user = userEvent.setup();
    renderPanel(position);

    await user.click(screen.getByTestId("lp-my-vote"));
    fireEvent.change(screen.getByTestId("lp-revote-slider"), { target: { value: "500" } });
    await user.click(screen.getByTestId("lp-revote-submit"));

    expect(screen.queryByTestId("lp-revote")).not.toBeInTheDocument();
  });
});

describe("LiquidityPanel — deposit guards", () => {
  it("blocks deposits larger than the wallet balance", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({ balance: 5n * ONE });

    await user.type(screen.getByTestId("lp-amount-input"), "10");
    expect(screen.getByTestId("lp-add-submit")).toHaveTextContent("Insufficient CST balance");
    await user.click(screen.getByTestId("lp-add-submit"));

    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onApprove).not.toHaveBeenCalled();
  });

  it("keeps the typed amount when the deposit fails, and clears it once confirmed", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderPanel({ onAdd });
    const input = screen.getByTestId<HTMLInputElement>("lp-amount-input");

    await user.type(input, "10");
    await user.click(screen.getByTestId("lp-add-submit"));
    expect(input.value).toBe("10");

    await user.click(screen.getByTestId("lp-add-submit"));
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(input.value).toBe("");
  });

  it("returns the excess YES tokens when the pool leans toward YES winning", async () => {
    const user = userEvent.setup();
    // Few YES tokens left in the pool = YES is the likely side; a balanced
    // deposit can only add YES at that ratio, so the extra YES comes back.
    const yesLikely: PoolState = { ...POOL, reserveYes: LIQ / 2n, reserveNo: LIQ };
    renderPanel({ pool: yesLikely });

    await user.type(screen.getByTestId("lp-amount-input"), "100");

    const joined = joinPool(yesLikely, 100n * ONE, 200n)!;
    expect(joined.excessYes).toBeGreaterThan(0n);
    expect(screen.getByTestId("lp-preview-excess")).toHaveTextContent(/YES$/);
  });
});

describe("LiquidityPanel — tooltips", () => {
  it('explains "Returned to you" as excess outcome tokens, not a cost', async () => {
    const user = userEvent.setup();
    renderPanel();

    // The skewed 2:1 pool returns excess NO tokens for any join.
    await user.type(screen.getByTestId("lp-amount-input"), "100");
    expect(screen.getByTestId("lp-preview-excess")).toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: 'About "Returned to you"' }));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(/leftover side comes straight back to your wallet/i);
    expect(tip).toHaveTextContent(/nothing is lost/i);
    expect(tip).toHaveTextContent(/1 YES \+ 1 NO always redeems for 1 CST/i);
  });

  it("explains LP shares in the add preview", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByTestId("lp-amount-input"), "100");
    await user.hover(screen.getByRole("button", { name: "About LP shares" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/your slice of the pool/i);
  });

  it("explains the pool fee as a share-weighted vote", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.hover(screen.getByRole("button", { name: "About the pool fee" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/share-weighted average/i);
  });

  it("warns that any removal pays out ALL accrued fees", async () => {
    const user = userEvent.setup();
    renderPanel({ lpShares: 4_000n * ONE, lpPendingFees: 12n * ONE, lpDeclaredFeeBps: 200 });

    await user.click(screen.getByTestId("lp-mode-remove"));
    await user.hover(screen.getByRole("button", { name: "About accrued fees" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/even if you only withdraw part/i);
  });

  it("explains the position summary terms on hover", async () => {
    const user = userEvent.setup();
    renderPanel({ lpShares: 4_000n * ONE, lpPendingFees: 12n * ONE, lpDeclaredFeeBps: 200 });

    await user.hover(screen.getByText("shares"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/your slice of the pool/i);
    await user.unhover(screen.getByText("shares"));

    await user.hover(screen.getByText("CST earned"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/claim them anytime/i);
  });
});
