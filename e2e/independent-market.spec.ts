import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  independentMarketAbi,
  independentSourceAbi,
  settlementVaultAbi,
} from "../frontend/src/independent/abi";
import { localGameAbi } from "../frontend/src/shared/abi";
import { quoteIndependentTrade } from "../frontend/src/shared/independent-math";
const requireFrontend = createRequire(path.resolve("frontend/package.json"));
const { createPublicClient, createTestClient, http, parseAbi } = requireFrontend(
  "viem",
) as typeof import("../frontend/node_modules/viem");
const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const ONE = 10n ** 18n;
let restore: { rpc: string; id: `0x${string}`; block: bigint } | null = null;
test.beforeEach(async () => {
  const d = JSON.parse(await readFile(path.resolve(".local/shared-deployment.json"), "utf8"));
  test.skip(d.marketKind !== "independent", "This flow targets the independently funded engine.");
  expect(d.chainId).toBe(31337);
  const url = new URL(d.rpcUrl);
  expect(url.protocol).toBe("http:");
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(url.hostname);
  const client = createPublicClient({ transport: http(d.rpcUrl) });
  expect(await client.getChainId()).toBe(31337);
  const tester = createTestClient({ mode: "anvil", transport: http(d.rpcUrl) });
  restore = {
    rpc: d.rpcUrl,
    block: await client.getBlockNumber({ cacheTime: 0 }),
    id: await tester.snapshot(),
  };
});
test.afterEach(async () => {
  if (!restore) return;
  const saved = restore;
  restore = null;
  await createTestClient({ mode: "anvil", transport: http(saved.rpc) }).revert({ id: saved.id });
  expect(
    await createPublicClient({ transport: http(saved.rpc) }).getBlockNumber({ cacheTime: 0 }),
  ).toBe(saved.block);
});

test("independent pools: isolated prices, direct transfers, full closure, protected late claims, history and carry", async ({
  page,
}) => {
  test.setTimeout(300_000);
  execFileSync(process.execPath, ["scripts/local-smoke.mjs"], {
    cwd: process.cwd(),
    timeout: 120_000,
  });
  const d = JSON.parse(await readFile(path.resolve(".local/shared-deployment.json"), "utf8"));
  const client = createPublicClient({ transport: http(d.rpcUrl), pollingInterval: 100 });
  const market = d.marketAddress as `0x${string}`;
  const game = d.gameAddress as `0x${string}`;
  const vault = d.vaultAddress as `0x${string}`;
  const qs = (round: bigint) =>
    client.readContract({
      address: market,
      abi: independentMarketAbi,
      functionName: "questionStates",
      args: [round],
    });
  const walletPositions = (round: bigint, owner: `0x${string}` = ACCOUNT) =>
    client.readContract({
      address: market,
      abi: independentMarketAbi,
      functionName: "balancesOf",
      args: [round, owner],
    });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/shared");
  await expect(page.getByRole("heading", { name: /Eight independent pools/ })).toBeVisible();
  await expect(page.getByTestId("independent-cycle")).toHaveText("Cycle 1");
  await expect(page.getByTestId("independent-active")).toHaveText("10,000 CST");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mock Connector 1", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Get 1,000 test CST" }).click();
  await expect(
    page.getByText("Local CST faucet confirmed.", { exact: true }).first(),
  ).toBeVisible();
  const before = await qs(1n);
  const quote = quoteIndependentTrade(
    {
      collateral: before[0].activeCollateral,
      yes: before[0].yesSupply,
      no: before[0].noSupply,
      initialYesBps: before[0].initialYesBps,
    },
    true,
    true,
    10n * ONE,
  );
  const trade = page.getByTestId("independent-trade-panel");
  await trade.getByLabel(/CST to spend/).fill("10");
  await trade.getByRole("button", { name: "Approve CST to trade" }).click();
  await trade.getByRole("button", { name: "Buy YES", exact: true }).click();
  await expect(
    page.getByText("Position purchase confirmed.", { exact: true }).first(),
  ).toBeVisible();
  const afterBuy = await qs(1n);
  expect(afterBuy.slice(1)).toEqual(before.slice(1));
  expect((await walletPositions(1n))[0][0]).toBe(quote);
  await page
    .getByTestId("independent-portfolio")
    .getByRole("button", { name: "Sell", exact: true })
    .click();
  await trade.getByLabel("Position units to sell", { exact: false }).fill("1");
  await trade.getByRole("button", { name: "Sell YES", exact: true }).click();
  await expect(trade.getByLabel("Position units to sell", { exact: false })).toHaveValue("");
  expect((await walletPositions(1n))[0][0]).toBe(quote - ONE);
  expect((await qs(1n)).slice(1)).toEqual(before.slice(1));
  await trade.getByRole("button", { name: "Buy", exact: true }).click();
  // A plain CST transfer runs no market code. The next buy absorbs it before
  // pricing, deepening all eight pools by exactly the previewed allocation.
  const fund = page.getByTestId("independent-funding-panel");
  await page
    .getByRole("button", { name: "Send 100 test CST directly to the market", exact: true })
    .click();
  await expect(
    page.getByText("Local direct CST transfer confirmed.", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("independent-held")).toHaveText("100 CST");
  const heldPreview = await client.readContract({
    address: market,
    abi: independentMarketAbi,
    functionName: "fundingPreview",
    args: [1n, 0n],
  });
  expect(heldPreview.canFund).toBe(true);
  expect(heldPreview.unallocated).toBe(100n * ONE);
  expect(heldPreview.allocations).toEqual(Array(8).fill((100n * ONE) / 8n));
  await expect(fund.getByRole("button", { name: "Distribute 100 CST now" })).toBeEnabled();
  await expect(trade.getByTestId("independent-trade-absorption")).toContainText("100 CST");
  const beforeAbsorb = await qs(1n);
  const unitsBeforeAbsorb = (await walletPositions(1n))[0][0];
  const absorbQuote = quoteIndependentTrade(
    {
      collateral: beforeAbsorb[0].activeCollateral + heldPreview.allocations[0],
      yes: beforeAbsorb[0].yesSupply,
      no: beforeAbsorb[0].noSupply,
      initialYesBps: beforeAbsorb[0].initialYesBps,
    },
    true,
    true,
    2n * ONE,
  );
  await trade.getByLabel(/CST to spend/).fill("2");
  await trade.getByRole("button", { name: "Approve CST to trade" }).click();
  await trade.getByRole("button", { name: "Buy YES", exact: true }).click();
  await expect(trade.getByLabel(/CST to spend/)).toHaveValue("");
  const afterAbsorb = await qs(1n);
  for (let q = 0; q < 8; q++) {
    expect(afterAbsorb[q].activeCollateral).toBe(
      beforeAbsorb[q].activeCollateral + heldPreview.allocations[q] + (q === 0 ? 2n * ONE : 0n),
    );
    if (q !== 0) expect(afterAbsorb[q].yesSupply).toBe(beforeAbsorb[q].yesSupply);
  }
  expect((await walletPositions(1n))[0][0]).toBe(unitsBeforeAbsorb + absorbQuote);
  await expect(page.getByTestId("independent-held")).toHaveText("0 CST");
  // Standard ERC1155 and fixed-rate sets remain available without moving prices.
  const sets = page.getByTestId("independent-sets-panel");
  await sets.getByRole("combobox").selectOption("2");
  await sets.getByLabel("CST to split").fill("2");
  await sets.getByRole("button", { name: "Approve CST to split" }).click();
  await sets.getByRole("button", { name: "Split into YES + NO" }).click();
  await expect(sets.getByTestId("independent-matched-pairs")).toHaveText("2");
  expect((await qs(1n))[2].currentYesBps).toBe(before[2].currentYesBps);
  for (const side of ["YES", "NO"]) {
    await page
      .getByRole("button", { name: `Transfer ${side}: Longer Chrono?`, exact: true })
      .click();
    const panel = page.getByTestId("transfer-position-panel");
    await panel.getByLabel("Recipient address").fill(RECIPIENT);
    await panel.getByLabel("Position units to transfer").fill("2");
    await panel.getByRole("button", { name: "Transfer positions", exact: true }).click();
    await expect(panel).not.toBeVisible();
  }
  await page
    .getByRole("banner")
    .getByRole("button", { name: /0x7099/ })
    .click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mock Connector 2", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await sets.getByRole("combobox").selectOption("2");
  await sets.getByRole("button", { name: "Merge pairs", exact: true }).click();
  await sets.getByLabel("Pairs to merge").fill("2");
  await sets.getByRole("button", { name: "Merge pairs into CST" }).click();
  await expect(sets.getByTestId("independent-matched-pairs")).toHaveText("0");
  expect((await walletPositions(1n, RECIPIENT))[0][2]).toBe(0n);
  await page
    .getByRole("banner")
    .getByRole("button", { name: /0x3C44/ })
    .click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mock Connector 1", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  // Exceed a known comparison: the new design still trades, but pays no early claims.
  for (let i = 0; i < 7; i++) {
    await page.getByRole("button", { name: /^ETH gesture/ }).click();
    await expect(page.getByTestId("current-0")).toHaveText(String(i + 1));
    await expect(page.getByTestId("current-5")).toHaveText(
      `${i + 1} · ${i % 2 === 0 ? "odd" : "even"}`,
    );
  }
  await expect(page.getByTestId("question-0")).toContainText("Trading");
  // Parity flips with every gesture, so question 5 stays unknown until closure.
  const [, , knownMask] = await client.readContract({
    address: d.sourceAddress,
    abi: independentSourceAbi,
    functionName: "outcomeState",
    args: [1n],
  });
  expect(knownMask & (1 << 5)).toBe(0);
  await expect(page.getByRole("button", { name: "Retrieve winnings", exact: true })).toBeDisabled();
  await trade.getByLabel(/CST to spend/).fill("1");
  await trade.getByRole("button", { name: "Approve CST to trade" }).click();
  await trade.getByRole("button", { name: "Buy YES", exact: true }).click();
  await expect(trade.getByLabel(/CST to spend/)).toHaveValue("");
  const middlePrice = (await qs(1n))[0].currentYesBps;
  await page.getByRole("button", { name: "Advance 1 hour", exact: true }).click();
  // Markets never end early: the countdown has elapsed and question 0 is known, yet
  // trading stays open until the round-ending transaction closes the cycle.
  await expect(page.getByText(/Trading stays open until the cycle is closed/)).toBeVisible();
  const knownCard = page.getByTestId("question-0");
  await expect(knownCard).toContainText("Trading");
  await expect(knownCard).not.toContainText("Resolved");
  await expect(knownCard.getByRole("button", { name: /^Buy YES:/ })).toBeEnabled();
  await expect(knownCard.getByRole("button", { name: /^Buy NO:/ })).toBeEnabled();
  await page.getByRole("button", { name: "Close current cycle", exact: true }).click();
  await expect(page.getByTestId("independent-cycle")).toHaveText("Cycle 2");
  const oldUnsettled = await client.readContract({
    address: market,
    abi: independentMarketAbi,
    functionName: "roundState",
    args: [1n],
  });
  expect(oldUnsettled.settled).toBe(false);
  const oldClaims = (await walletPositions(1n))[0][0];
  // Splits/merges before sponsorship, including outcome-source read failure.
  await sets.getByLabel("CST to split").fill("1");
  await sets.getByRole("button", { name: "Approve CST to split" }).click();
  await sets.getByRole("button", { name: "Split into YES + NO" }).click();
  await expect(sets.getByTestId("independent-matched-pairs")).toHaveText("1");
  const blockSource = async () =>
    page.route(d.rpcUrl, async (route) => {
      const request = route.request().postDataJSON();
      if (
        !Array.isArray(request) &&
        request?.method === "eth_call" &&
        request.params?.[0]?.to?.toLowerCase() === d.sourceAddress.toLowerCase()
      )
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32000, message: "Outcome source unavailable" },
          }),
        });
      else await route.continue();
    });
  await blockSource();
  await page.getByRole("button", { name: "Refresh market" }).click();
  let recovery = page.getByTestId("independent-recovery");
  await expect(recovery).toBeVisible();
  await recovery.getByLabel("Pairs to merge").fill("1");
  await recovery.getByRole("button", { name: "Merge pairs into CST" }).click();
  await expect(recovery.getByTestId("independent-matched-pairs")).toHaveText("0");
  await page.unroute(d.rpcUrl);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByTestId("independent-cycle")).toHaveText("Cycle 2");
  // One new gift plus all old surplus, divided exactly; first fund auto-settles.
  const newMoney = 8n * ONE + 3n;
  const preview = await client.readContract({
    address: market,
    abi: independentMarketAbi,
    functionName: "fundingPreview",
    args: [2n, newMoney],
  });
  await fund.getByLabel(/New CST to add/).fill("8.000000000000000003");
  await fund.getByRole("checkbox").check();
  await fund.getByRole("button", { name: "Approve CST for funding" }).click();
  await fund.getByRole("button", { name: "Add CST to all eight pools" }).click();
  await expect(page.getByText("Cycle funding confirmed.", { exact: true }).first()).toBeVisible();
  const second = await qs(2n);
  expect(second.map((q) => q.activeCollateral)).toEqual(preview.allocations);
  expect(second[0].initialYesBps).toBe(middlePrice);
  expect(second[0].seedUsedHistory).toBe(true);
  const settledOld = await client.readContract({
    address: market,
    abi: independentMarketAbi,
    functionName: "roundState",
    args: [1n],
  });
  expect(settledOld.settled).toBe(true);
  expect(settledOld.activeCollateral).toBe(0n);
  expect((await qs(1n)).every((q) => q.activeCollateral === 0n)).toBe(true);
  expect(
    await client.readContract({
      address: vault,
      abi: settlementVaultAbi,
      functionName: "totalEscrowed",
    }),
  ).toBe(oldClaims);
  // A much later old claim, with source offline, cannot consume the new pools.
  await page.getByRole("link", { name: "Previous cycle" }).click();
  await expect(page.getByTestId("independent-cycle")).toHaveText("Cycle 1");
  // Seven gestures closed cycle 1 on an odd total.
  await expect(page.getByTestId("current-5")).toHaveText("7 · odd");
  await expect(page.getByTestId("question-5")).toContainText("Resolved YES");
  const unchangedSecond = await qs(2n);
  const token = await client.readContract({
    address: market,
    abi: independentMarketAbi,
    functionName: "cst",
  });
  const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const balanceBefore = await client.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [ACCOUNT],
  });
  await blockSource();
  await page.getByRole("button", { name: "Refresh market" }).click();
  recovery = page.getByTestId("independent-recovery");
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: "Retrieve settled winnings" }).click();
  await expect(recovery.getByTestId("recovery-claimable")).toHaveText("0 CST");
  expect(await qs(2n)).toEqual(unchangedSecond);
  expect(
    await client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [ACCOUNT],
    }),
  ).toBe(balanceBefore + oldClaims);
  await page.unroute(d.rpcUrl);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("link", { name: "Follow current cycle" }).click();
  await expect(page.getByTestId("independent-cycle")).toHaveText("Cycle 2");
  // No-trade cycle: its first buy settles it and opens the next pools from carry,
  // with no start transaction and no new sponsor money.
  await page.getByRole("button", { name: /^ETH gesture/ }).click();
  await expect(page.getByTestId("current-0")).toHaveText("1");
  await page.getByRole("button", { name: "Advance 1 hour" }).click();
  await page.getByRole("button", { name: "Close current cycle" }).click();
  await expect(page.getByTestId("independent-cycle")).toHaveText("Cycle 3");
  const carryPreview = await client.readContract({
    address: market,
    abi: independentMarketAbi,
    functionName: "fundingPreview",
    args: [3n, 0n],
  });
  expect(carryPreview.canFund).toBe(true);
  expect(carryPreview.needsSettlement).toBe(true);
  const [seeds] = await client.readContract({
    address: market,
    abi: independentMarketAbi,
    functionName: "seedPreview",
    args: [3n],
  });
  await expect(page.getByTestId("question-0")).toContainText("Opens with the first trade");
  await expect(fund.getByRole("button", { name: "Open pools now" })).toBeEnabled();
  await expect(trade.getByTestId("independent-trade-absorption")).toContainText(
    "opens this cycle’s eight pools first, after settling the preceding cycle",
  );
  const firstQuote = quoteIndependentTrade(
    { collateral: carryPreview.allocations[0], yes: 0n, no: 0n, initialYesBps: seeds[0] },
    true,
    true,
    ONE,
  );
  await trade.getByLabel(/CST to spend/).fill("1");
  await trade.getByRole("button", { name: "Approve CST to trade" }).click();
  await trade.getByRole("button", { name: "Buy YES", exact: true }).click();
  await expect(trade.getByLabel(/CST to spend/)).toHaveValue("");
  expect((await qs(3n)).map((q) => q.activeCollateral)).toEqual(
    carryPreview.allocations.map((amount, q) => amount + (q === 0 ? ONE : 0n)),
  );
  expect((await qs(3n)).map((q) => q.initialYesBps)).toEqual([...seeds]);
  expect((await walletPositions(3n))[0][0]).toBe(firstQuote);
  expect(
    (
      await client.readContract({
        address: market,
        abi: independentMarketAbi,
        functionName: "roundState",
        args: [2n],
      })
    ).settled,
  ).toBe(true);
  await expect(page.getByTestId("question-0")).toContainText("Trading");
  await expect(fund.getByRole("button", { name: "Add CST to all eight pools" })).toBeVisible();
  expect(
    await client.readContract({ address: game, abi: localGameAbi, functionName: "roundNum" }),
  ).toBe(3n);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/independent-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/independent-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});
