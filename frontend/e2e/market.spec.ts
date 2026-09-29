import { parseEther } from "viem";
import { formatBps, formatCount, formatCst, shortAddress } from "../src/lib/format";
import { expect, test } from "./fixtures";
import { ACCOUNTS } from "./support/chain";
import { LIVE_UPDATE_TIMEOUT } from "./support/market-page";

/**
 * The market, end to end: the production build in a browser, a wallet
 * connected through the app's own dialog (the Mock Connector signs with
 * anvil's unlocked account #1), real transactions against the real
 * GestureSeriesMarket bytecode, and the game driven from Node.
 *
 * Every number the UI shows is checked against the contract's own view
 * functions, rendered through the app's display formatter — so these tests
 * prove the screen tells the on-chain truth, not merely that it renders.
 * Each test starts from the pristine post-deploy snapshot.
 */

const { wallet, trader } = ACCOUNTS;

/** The headline odds as the hero renders them: NO reserve ÷ both reserves, one decimal. */
function impliedYesPercent(pool: { reserveYes: bigint; reserveNo: bigint }): string {
  const scaled = (pool.reserveNo * 1_000_000n) / (pool.reserveYes + pool.reserveNo);
  const percent = (Number(scaled) / 1_000_000) * 100;
  return `${percent.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

test.describe("market", { tag: "@chain" }, () => {
  test("bets YES then NO: exact quotes, approvals, fills, position, odds and activity", async ({ market, chain }) => {
    const round = await chain.currentRound();
    await market.goto();
    await expect(market.currentRoundLabel(round)).toBeVisible();
    await expect(market.betPanel.getByRole("button", { name: "Connect wallet to bet" })).toBeVisible();

    await market.connectWallet();
    const startBalance = await chain.cstBalance(wallet);
    await expect(market.betPanel.getByRole("button", { name: `Balance: ${formatCst(startBalance)}` })).toBeVisible();
    await expect(market.positionPanel).toBeHidden();

    // YES: the quote shown is the contract's quote, and the fill matches it exactly.
    const yesIn = parseEther("100");
    const yesQuote = await chain.quoteBet("yes", round, yesIn);
    await market.chooseSide("yes");
    await market.betAmount().fill("100");
    await expect(market.betPanel.getByTestId("quote-tokens")).toHaveText(`${formatCst(yesQuote)} YES`);
    await expect(market.betPanel.getByTestId("quote-payout")).toHaveText(`${formatCst(yesQuote)} CST`);
    await market.approveAndBet("yes");

    expect(await chain.outcomeBalances(round, wallet)).toEqual({ yes: yesQuote, no: 0n });
    expect(await chain.cstBalance(wallet)).toBe(startBalance - yesIn);
    await expect(market.betAmount()).toHaveValue("");
    await expect(market.positionPanel.getByTestId("yes-balance")).toHaveText(formatCst(yesQuote));
    await expect(market.positionPanel.getByTestId("no-balance")).toHaveText("0");
    await expect(market.probability).toHaveText(impliedYesPercent(await chain.pool(round)));
    await expect(market.activityItem("bet 100 CST on YES")).toContainText(shortAddress(wallet));

    // NO: a second approval (the first was for exactly 100 CST) and the other side.
    const noIn = parseEther("50");
    const noQuote = await chain.quoteBet("no", round, noIn);
    await market.chooseSide("no");
    await market.betAmount().fill("50");
    await expect(market.betPanel.getByTestId("quote-tokens")).toHaveText(`${formatCst(noQuote)} NO`);
    await market.approveAndBet("no");

    expect(await chain.outcomeBalances(round, wallet)).toEqual({ yes: yesQuote, no: noQuote });
    const endBalance = startBalance - yesIn - noIn;
    expect(await chain.cstBalance(wallet)).toBe(endBalance);
    await expect(market.positionPanel.getByTestId("no-balance")).toHaveText(formatCst(noQuote));
    await expect(market.betPanel.getByRole("button", { name: `Balance: ${formatCst(endBalance)}` })).toBeVisible();
    await expect(market.probability).toHaveText(impliedYesPercent(await chain.pool(round)));
    await expect(market.activityItem("bet 50 CST on NO")).toContainText(shortAddress(wallet));
    // Holding both sides makes complete sets, redeemable 1:1.
    await expect(market.positionPanel.getByRole("button", { name: "Redeem" })).toBeEnabled();
  });

  test("adds liquidity from the Liquidity tab: the preview is what the pool mints", async ({ market, chain }) => {
    const round = await chain.currentRound();
    await market.goto();
    await market.connectWallet();
    await market.openTab("Liquidity");
    const lp = market.liquidityPanel;
    const feeBefore = await chain.feeBps(round);
    await expect(lp.getByTestId("lp-pool-fee")).toHaveText(formatBps(feeBefore));
    await expect(lp.getByTestId("lp-position")).toBeHidden();

    await lp.getByRole("textbox", { name: "Amount" }).fill("500");
    // Vote a 2.5% fee from the keyboard: the slider moves in 0.1% steps from 2%.
    const vote = lp.getByRole("slider", { name: "Your fee vote in percent" });
    await vote.focus();
    for (let step = 0; step < 5; step++) await vote.press("ArrowRight");
    await expect(lp.getByTestId("lp-fee-vote-value")).toHaveText("2.5%");
    await expect(lp.getByTestId("lp-add-preview")).toBeVisible();
    const previewShares = await lp.getByTestId("lp-preview-shares").textContent();
    const previewFee = await lp.getByTestId("lp-preview-fee").textContent();

    await lp.getByRole("button", { name: "Approve CST" }).click();
    await lp.getByRole("button", { name: "Add liquidity", exact: true }).click();
    await expect(market.toast("Adding liquidity confirmed.")).toBeVisible();

    const position = await chain.lpPosition(round, wallet);
    const feeAfter = await chain.feeBps(round);
    expect(position.declaredFeeBps).toBe(250);
    expect(previewShares).toBe(formatCst(position.shares));
    expect(previewFee).toBe(`${formatBps(feeBefore)} → ${formatBps(feeAfter)}`);

    const lpBox = lp.getByTestId("lp-position");
    await expect(lpBox).toContainText(`${formatCst(position.shares)} shares`);
    await expect(lpBox.getByTestId("lp-my-vote")).toHaveText("2.5%");
    await expect(lp.getByTestId("lp-pool-fee")).toHaveText(formatBps(feeAfter));
    await expect(market.tradeTabs.getByRole("tab", { name: /you have a liquidity position/ })).toBeVisible();
    await expect(market.activityItem("added 500 CST of liquidity")).toContainText("voting 2.5%");
  });

  test("an LP earns fees from other traders' bets, claims them, then withdraws", async ({ market, chain }) => {
    const round = await chain.currentRound();
    await chain.addLiquidity(wallet, round, parseEther("2000"), 200);

    await market.goto();
    await market.connectWallet();
    await market.openTab("Liquidity");
    const lp = market.liquidityPanel;
    await expect(lp.getByTestId("lp-pending-fees")).toHaveText("0");
    await expect(lp.getByRole("button", { name: "Claim fees" })).toBeDisabled();

    // Another trader bets; the LP's cut of the fee shows up live.
    await chain.bet(trader, "yes", round, parseEther("1000"));
    const { pendingFees } = await chain.lpPosition(round, wallet);
    expect(pendingFees).toBeGreaterThan(0n);
    await expect(lp.getByTestId("lp-pending-fees")).toHaveText(formatCst(pendingFees), {
      timeout: LIVE_UPDATE_TIMEOUT,
    });
    await expect(market.activityItem("bet 1,000 CST on YES")).toContainText(shortAddress(trader), {
      timeout: LIVE_UPDATE_TIMEOUT,
    });

    const beforeClaim = await chain.cstBalance(wallet);
    await lp.getByRole("button", { name: "Claim fees" }).click();
    await expect(market.toast("Claiming LP fees confirmed.")).toBeVisible();
    expect(await chain.cstBalance(wallet)).toBe(beforeClaim + pendingFees);
    await expect(lp.getByTestId("lp-pending-fees")).toHaveText("0");
    await expect(market.activityItem("in LP fees")).toContainText(formatCst(pendingFees));

    // Withdraw everything: the preview is exactly what comes back.
    const tokensBefore = await chain.outcomeBalances(round, wallet);
    await lp.getByRole("tab", { name: /^remove$/i }).click();
    await expect(lp.getByTestId("lp-remove-pct")).toHaveText("100%");
    const preview = await lp.getByTestId("lp-remove-preview").textContent();
    await lp.getByRole("button", { name: "Remove liquidity" }).click();
    await expect(market.toast("Removing liquidity confirmed.")).toBeVisible();

    expect((await chain.lpPosition(round, wallet)).shares).toBe(0n);
    const tokensAfter = await chain.outcomeBalances(round, wallet);
    expect(preview).toBe(
      `${formatCst(tokensAfter.yes - tokensBefore.yes)} YES + ${formatCst(tokensAfter.no - tokensBefore.no)} NO`,
    );
    await expect(lp.getByTestId("lp-no-position")).toBeVisible();
    await expect(market.positionPanel.getByTestId("yes-balance")).toHaveText(formatCst(tokensAfter.yes));
    await expect(market.positionPanel.getByTestId("no-balance")).toHaveText(formatCst(tokensAfter.no));
  });

  test("early resolution: the count crosses the threshold live, then resolve and claim pay YES", async ({
    market,
    chain,
  }) => {
    const round = await chain.currentRound();
    const { threshold } = await chain.roundState(round);
    await chain.bet(wallet, "yes", round, parseEther("200"));
    const { yes } = await chain.outcomeBalances(round, wallet);

    await market.goto();
    await market.connectWallet();
    await expect(market.positionPanel.getByTestId("yes-balance")).toHaveText(formatCst(yes));
    await expect(market.resolveBanner).toBeHidden();

    // Players pile in mid-round: one gesture past last round's count.
    const finalCount = threshold + 1n;
    await chain.setGestureCount(round, finalCount);
    await expect(
      market.resolveBanner.getByRole("heading", { name: "Threshold crossed — YES already won" }),
    ).toBeVisible({
      timeout: LIVE_UPDATE_TIMEOUT,
    });
    await expect(market.resolveBanner.getByTestId("banner-count")).toHaveText(formatCount(finalCount));
    // Betting halted in the same block; the bet panel explains why.
    await expect(market.betPanel.getByTestId("bet-closed")).toBeVisible();
    await expect(market.positionPanel.getByTestId("decided-note")).toBeVisible();

    await market.resolveBanner.getByRole("button", { name: "Resolve round" }).click();
    await expect(market.toast("Resolving round confirmed.")).toBeVisible();
    expect(await chain.roundState(round)).toMatchObject({ resolved: true, yesWon: true, currentCount: finalCount });
    await expect(market.resolveBanner).toBeHidden();
    await expect(market.positionPanel).toContainText("settled — YES won");
    await expect(market.activityItem("round resolved")).toContainText(`YES at ${formatCount(finalCount)} gestures`);

    const beforeClaim = await chain.cstBalance(wallet);
    await market.positionPanel.getByRole("button", { name: `Claim ${formatCst(yes)} CST` }).click();
    await expect(market.toast("Claiming winnings confirmed.")).toBeVisible();
    // Every winning token paid exactly 1 CST.
    expect(await chain.cstBalance(wallet)).toBe(beforeClaim + yes);
    expect(await chain.outcomeBalances(round, wallet)).toEqual({ yes: 0n, no: 0n });
    await expect(market.positionPanel).toBeHidden();
    await expect(market.activityItem(`claimed ${formatCst(yes)} CST`)).toContainText(shortAddress(wallet));
  });

  test("normal resolution: the round ends short of the threshold, then resolve and claim pay NO", async ({
    market,
    chain,
  }) => {
    const round = await chain.currentRound();
    const { threshold } = await chain.roundState(round);
    await chain.bet(wallet, "no", round, parseEther("300"));
    const { no } = await chain.outcomeBalances(round, wallet);

    await market.goto();
    await market.connectWallet();
    await expect(market.positionPanel.getByTestId("no-balance")).toHaveText(formatCst(no));

    // The round ends below the threshold and the game moves on: the app
    // follows the new live round, whose market nobody has opened yet.
    const finalCount = threshold - 10n;
    await chain.setGestureCount(round, finalCount);
    await chain.setGameRound(round + 1n);
    await expect(market.currentRoundLabel(round + 1n)).toBeVisible({ timeout: LIVE_UPDATE_TIMEOUT });
    await expect(market.betPanel.getByTestId("bet-closed")).toBeVisible();

    // Back to the ended round to settle it.
    await market.roundNav.getByRole("button", { name: `Round ${round}`, exact: true }).click();
    await expect(market.page).toHaveURL(new RegExp(`\\?round=${round}$`));
    await expect(market.currentRoundLabel(round)).toBeVisible();
    await expect(market.resolveBanner.getByRole("heading", { name: "The round has ended" })).toBeVisible();
    await expect(market.resolveBanner.getByTestId("banner-count")).toHaveText(formatCount(finalCount));

    await market.resolveBanner.getByRole("button", { name: "Resolve round" }).click();
    await expect(market.toast("Resolving round confirmed.")).toBeVisible();
    expect(await chain.roundState(round)).toMatchObject({ resolved: true, yesWon: false, currentCount: finalCount });
    await expect(market.positionPanel).toContainText("settled — NO won");

    const beforeClaim = await chain.cstBalance(wallet);
    await market.positionPanel.getByRole("button", { name: `Claim ${formatCst(no)} CST` }).click();
    await expect(market.toast("Claiming winnings confirmed.")).toBeVisible();
    expect(await chain.cstBalance(wallet)).toBe(beforeClaim + no);
    expect(await chain.outcomeBalances(round, wallet)).toEqual({ yes: 0n, no: 0n });
    await expect(market.positionPanel).toBeHidden();
  });
});
