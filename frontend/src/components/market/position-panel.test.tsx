import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RoundSnapshot, UserSnapshot } from "@/lib/market";
import { ONE } from "@/lib/math";
import { PositionPanel, type PositionPanelProps } from "./position-panel";

const SERIES = "0x1111111111111111111111111111111111111111" as const;

function snapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    seriesAddress: SERIES,
    roundId: 5n,
    initialized: true,
    thresholdKnown: true,
    resolved: false,
    yesWon: false,
    threshold: 800n,
    currentCount: 500n,
    gameRoundNum: 5n,
    prevRoundCount: 800n,
    pool: {
      reserveYes: 1_000n * ONE,
      reserveNo: 1_000n * ONE,
      totalShares: 1_000n * ONE,
      accFeePerShare: 0n,
      feeReserve: 0n,
      feeWeight: 1_000n * ONE * 200n,
    },
    cstAddress: "0x2222222222222222222222222222222222222222",
    gameAddress: "0x3333333333333333333333333333333333333333",
    ...overrides,
  };
}

function user(overrides: Partial<UserSnapshot> = {}): UserSnapshot {
  return {
    address: "0x4444444444444444444444444444444444444444",
    yesBalance: 100n * ONE,
    noBalance: 40n * ONE,
    cstBalance: 1_000n * ONE,
    cstAllowance: 0n,
    lpShares: 0n,
    lpPendingFees: 0n,
    lpDeclaredFeeBps: 0,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<PositionPanelProps> = {}) {
  const props: PositionPanelProps = {
    snapshot: snapshot(),
    user: user(),
    pendingAction: null,
    onRedeemSets: vi.fn().mockResolvedValue(true),
    onClaim: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  const utils = render(<PositionPanel {...props} />);
  return { props, ...utils };
}

describe("PositionPanel", () => {
  it("renders nothing without a position", () => {
    renderPanel({ user: user({ yesBalance: 0n, noBalance: 0n }) });
    expect(screen.queryByTestId("position-panel")).not.toBeInTheDocument();
  });

  it("shows balances marked at the pool probability while live", () => {
    renderPanel();
    expect(screen.getByTestId("yes-balance")).toHaveTextContent("100");
    expect(screen.getByTestId("no-balance")).toHaveTextContent("40");
    // 50% pool: value = 100*0.5 + 40*0.5 = 70.
    expect(screen.getByTestId("position-value")).toHaveTextContent("70");
  });

  it("redeems complete sets while live", async () => {
    const u = userEvent.setup();
    const { props } = renderPanel();
    await u.click(screen.getByTestId("redeem-button"));
    expect(props.onRedeemSets).toHaveBeenCalledWith(40n * ONE); // min(yes, no)
  });

  it("explains a decided outcome and values YES at par", () => {
    renderPanel({ snapshot: snapshot({ currentCount: 801n }) });
    expect(screen.getByTestId("decided-note")).toBeInTheDocument();
    expect(screen.getByTestId("position-value")).toHaveTextContent("100");
  });

  it("claims the exact winning balance after resolution", async () => {
    const u = userEvent.setup();
    const { props } = renderPanel({ snapshot: snapshot({ resolved: true, yesWon: true }) });
    const button = screen.getByTestId("claim-button");
    expect(button).toHaveTextContent("100");
    await u.click(button);
    expect(props.onClaim).toHaveBeenCalled();
    expect(screen.queryByTestId("redeem-button")).not.toBeInTheDocument();
  });

  it("shows zero claimable when the user lost", () => {
    renderPanel({ snapshot: snapshot({ resolved: true, yesWon: false }) });
    expect(screen.getByTestId("claim-button")).toHaveTextContent("40");
  });

  it("future-round positions mark at the pool price and stay redeemable", async () => {
    const u = userEvent.setup();
    const { props } = renderPanel({
      snapshot: snapshot({
        roundId: 7n,
        gameRoundNum: 5n,
        thresholdKnown: false,
        threshold: 0n,
        currentCount: 0n,
        prevRoundCount: 640n,
      }),
    });
    // 50% pool: value = 100*0.5 + 40*0.5 = 70, same as live.
    expect(screen.getByTestId("position-value")).toHaveTextContent("70");
    expect(screen.queryByTestId("claim-button")).not.toBeInTheDocument();
    await u.click(screen.getByTestId("redeem-button"));
    expect(props.onRedeemSets).toHaveBeenCalledWith(40n * ONE);
  });

  it("redeems as many sets as the smaller side, whichever side that is", async () => {
    const u = userEvent.setup();
    const { props } = renderPanel({ user: user({ yesBalance: 15n * ONE, noBalance: 60n * ONE }) });

    await u.click(screen.getByTestId("redeem-button"));
    expect(props.onRedeemSets).toHaveBeenCalledWith(15n * ONE);
  });

  it("offers no redemption for a one-sided position", () => {
    renderPanel({ user: user({ noBalance: 0n }) });
    expect(screen.queryByTestId("redeem-button")).not.toBeInTheDocument();
  });

  it("admits there is no market price while the pool is unfunded", async () => {
    const u = userEvent.setup();
    renderPanel({
      snapshot: snapshot({
        pool: {
          reserveYes: 0n,
          reserveNo: 0n,
          totalShares: 0n,
          accFeePerShare: 0n,
          feeReserve: 0n,
          feeWeight: 0n,
        },
      }),
    });

    await u.hover(screen.getByText("no market price yet"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/no liquidity yet/i);
  });

  it("names the winning side once settled", () => {
    renderPanel({ snapshot: snapshot({ resolved: true, yesWon: false }) });
    expect(screen.getByText("settled — NO won")).toBeInTheDocument();
  });

  it.each([
    ["claim", { resolved: true, yesWon: true }, "claim-button"],
    ["redeem", {}, "redeem-button"],
  ] as const)("spins the %s button while it is in flight", (pendingAction, overrides, testId) => {
    renderPanel({ snapshot: snapshot(overrides), pendingAction });
    expect(screen.getByTestId(testId)).toBeDisabled();
  });
});

describe("PositionPanel — tooltips", () => {
  it('flags "Value now" as a mark-to-market estimate, not an exit price', async () => {
    const u = userEvent.setup();
    renderPanel();

    await u.hover(screen.getByRole("button", { name: 'About "Value now"' }));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(/mark-to-market estimate/i);
    expect(tip).toHaveTextContent(/not a guaranteed exit price/i);
  });

  it("switches to an exact-claim tooltip once resolved", async () => {
    const u = userEvent.setup();
    renderPanel({ snapshot: snapshot({ resolved: true, yesWon: true }) });

    await u.hover(screen.getByRole("button", { name: "About your claimable amount" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/1 CST for every winning token/i);
  });

  it("explains what YES and NO tokens pay", async () => {
    const u = userEvent.setup();
    renderPanel();

    await u.hover(screen.getByRole("button", { name: "About YES tokens" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      /pays exactly 1 CST if this round beats/i,
    );
    await u.unhover(screen.getByRole("button", { name: "About YES tokens" }));

    await u.hover(screen.getByRole("button", { name: "About NO tokens" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/a tie counts as NO/i);
  });

  it("explains complete sets on the redeem row", async () => {
    const u = userEvent.setup();
    renderPanel();

    await u.hover(screen.getByText("complete sets"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      /worth exactly 1 CST no matter how the round ends/i,
    );
  });

  it("explains the mark price in the header caption", async () => {
    const u = userEvent.setup();
    renderPanel();

    await u.hover(screen.getByText(/marked at 50% YES/i));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/implied chance of YES/i);
  });
});
