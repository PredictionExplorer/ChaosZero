import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { sharedMarketAbi, localGameAbi } from "../frontend/src/shared/abi";
import { quoteTrade, type SharedPool } from "../frontend/src/shared/math";

const requireFrontend = createRequire(path.resolve("frontend/package.json"));
const { createPublicClient, createTestClient, http, parseAbi, toFunctionSelector } =
  requireFrontend("viem") as typeof import("../frontend/node_modules/viem");
const ONE = 10n ** 18n;
const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

// A Playwright retry uses the same Anvil process. Restore the entire browser
// flow, not merely the nested snapshot used by local-smoke.mjs.
let savedChain: { rpcUrl: string; id: `0x${string}`; blockNumber: bigint } | null = null;

test.beforeEach(async () => {
  const deployment = JSON.parse(
    await readFile(path.resolve(".local/shared-deployment.json"), "utf8"),
  );
  const rpcUrl = new URL(deployment.rpcUrl);
  expect(deployment.chainId).toBe(31337);
  expect(rpcUrl.protocol).toBe("http:");
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(rpcUrl.hostname);
  const client = createPublicClient({ transport: http(rpcUrl.href) });
  expect(await client.getChainId()).toBe(31337);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const tester = createTestClient({ mode: "anvil", transport: http(rpcUrl.href) });
  savedChain = { rpcUrl: rpcUrl.href, id: await tester.snapshot(), blockNumber };
});

test.afterEach(async () => {
  if (!savedChain) return;
  const restore = savedChain;
  savedChain = null;
  const tester = createTestClient({ mode: "anvil", transport: http(restore.rpcUrl) });
  await tester.revert({ id: restore.id });
  const client = createPublicClient({ transport: http(restore.rpcUrl) });
  expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(restore.blockNumber);
});

test("eight shared markets: quote, gift, buy, sell, partial settlement, closure and rollover", async ({
  page,
}) => {
  test.setTimeout(300_000);
  execFileSync(process.execPath, ["scripts/local-smoke.mjs"], {
    cwd: process.cwd(),
    timeout: 120_000,
  });
  const deployment = JSON.parse(
    await readFile(path.resolve(".local/shared-deployment.json"), "utf8"),
  );
  const client = createPublicClient({ transport: http(deployment.rpcUrl) });
  const market = deployment.marketAddress as `0x${string}`;
  const game = deployment.gameAddress as `0x${string}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/shared");
  await expect(page.getByRole("heading", { name: /Eight questions/ })).toBeVisible();
  await expect(page.getByTestId("question-7")).toBeVisible();
  for (let i = 0; i < 8; i++) await expect(page.getByTestId(`question-${i}`)).toBeVisible();
  await expect(page.getByTestId("current-0")).toHaveText("0");
  await expect(page.getByTestId("shared-collateral")).toHaveText(/10,000 CST/);

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

  const funding = page.getByTestId("shared-funding-panel");
  await funding.getByLabel("Gift amount in CST").fill("25");
  await expect(funding.getByRole("button", { name: "Approve CST for gift" })).toBeDisabled();
  await funding.getByRole("checkbox").check();
  await funding.getByRole("button", { name: "Approve CST for gift" }).click();
  await funding.getByRole("button", { name: "Gift CST to this cycle" }).click();
  await expect(page.getByTestId("shared-collateral")).toHaveText("10,025 CST");

  // Funded complete sets change custody and liabilities equally, not AMM reserves.
  const sets = page.getByTestId("complete-sets-panel");
  await sets.getByLabel(/Question · cycle/).selectOption("2");
  await sets.getByLabel("CST to split").fill("4");
  await sets.getByRole("button", { name: "Approve CST to split" }).click();
  await sets.getByRole("button", { name: "Split into YES + NO" }).click();
  await expect(page.getByTestId("shared-collateral")).toHaveText("10,029 CST");
  await expect(page.getByTestId("shared-reserve")).toHaveText("10,025 CST");
  await sets.getByRole("button", { name: "Merge pairs", exact: true }).click();
  await sets.getByLabel("Pairs to merge").fill("4");
  await sets.getByRole("button", { name: "Merge pairs into CST" }).click();
  await expect(page.getByTestId("shared-collateral")).toHaveText("10,025 CST");
  await expect(page.getByTestId("shared-reserve")).toHaveText("10,025 CST");

  // Independently check the browser's quote solver against eth_call simulation of Solidity.
  const accounting = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "roundAccounting",
    args: [1n],
  });
  const liabilities = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "liabilities",
    args: [1n],
  });
  const pool: SharedPool = {
    collateral: accounting[0],
    yes: liabilities[0],
    no: liabilities[1],
    knownMask: accounting[2],
    values: accounting[3],
  };
  const expectedUnits = quoteTrade(pool, 0, true, true, 10n * ONE);
  const trade = page.getByTestId("shared-trade-panel");
  await trade.getByLabel(/CST to spend/).fill("10");
  await trade.getByRole("button", { name: "Approve CST to trade" }).click();
  await expect(trade.getByRole("button", { name: "Buy YES", exact: true })).toBeEnabled();
  const timestamp = (await client.getBlock()).timestamp;
  await client.simulateContract({
    account: WALLET,
    address: market,
    abi: sharedMarketAbi,
    functionName: "buy",
    args: [1n, 0, true, 10n * ONE, expectedUnits, timestamp + 900n],
  });
  await trade.getByRole("button", { name: "Buy YES", exact: true }).click();
  await expect(
    page.getByText("Position purchase confirmed.", { exact: true }).first(),
  ).toBeVisible();
  const bought = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "balancesOf",
    args: [1n, WALLET],
  });
  expect(bought[0][0]).toBe(expectedUnits);
  expect(bought[0][0]).toBeGreaterThan(19n * ONE);

  await page.getByTestId("shared-portfolio").getByRole("button", { name: "Sell" }).click();
  await trade.getByLabel(/Position units to sell/).fill("1");
  await trade.getByRole("button", { name: "Sell YES", exact: true }).click();
  await expect(page.getByText("Position sale confirmed.", { exact: true }).first()).toBeVisible();
  const sold = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "balancesOf",
    args: [1n, WALLET],
  });
  expect(sold[0][0]).toBe(expectedUnits - ONE);

  // Seven real ETH gestures exceed the replayed six-gesture baseline, settling question0 early.
  for (let i = 0; i < 7; i++) {
    await page.getByRole("button", { name: /^ETH gesture/ }).click();
    await expect(page.getByTestId("current-0")).toHaveText(String(i + 1));
  }
  await expect(page.getByTestId("question-0")).toContainText("Resolved YES");
  await expect(page.getByTestId("question-5")).toContainText("Open");
  await page.getByRole("button", { name: "Retrieve known winnings" }).click();
  await expect(page.getByTestId("shared-claimable")).toHaveText("0 CST");
  const claimed = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "balancesOf",
    args: [1n, WALLET],
  });
  expect(claimed[0][0]).toBe(0n);

  await page.getByRole("button", { name: "Advance 1 hour" }).click();
  await expect(page.getByRole("button", { name: "Close current cycle" })).toBeEnabled();
  await page.getByRole("button", { name: "Close current cycle" }).click();
  await expect(page.getByTestId("shared-cycle")).toHaveText("Cycle 2");
  expect(
    await client.readContract({ address: game, abi: localGameAbi, functionName: "roundNum" }),
  ).toBe(2n);
  // Round2 has no sponsor: complete sets still work and supply no AMM capacity.
  await sets.getByLabel("CST to split").fill("10");
  await sets.getByRole("button", { name: "Approve CST to split" }).click();
  await sets.getByRole("button", { name: "Split into YES + NO" }).click();
  await expect(page.getByTestId("shared-collateral")).toHaveText("10 CST");
  await expect(page.getByTestId("shared-reserve")).toHaveText("0 CST");
  const splitOnly = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "roundAccounting",
    args: [2n],
  });
  expect(splitOnly[1]).toBe(false);
  const id = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "positionId",
    args: [2n, 0, true],
  });
  expect(id).toBe(33n);
  expect(
    await client.readContract({
      address: market,
      abi: sharedMarketAbi,
      functionName: "balanceOf",
      args: [WALLET, id],
    }),
  ).toBe(10n * ONE);

  // Break only source RPC reads: recovery must retain fresh balances and permit a merge.
  const sourceSelector = toFunctionSelector("outcomeState(uint256)");
  await page.route(deployment.rpcUrl, async (route) => {
    const request = route.request().postDataJSON();
    if (
      !Array.isArray(request) &&
      request?.method === "eth_call" &&
      request.params?.[0]?.to?.toLowerCase() === deployment.sourceAddress.toLowerCase() &&
      request.params?.[0]?.data?.startsWith(sourceSelector)
    ) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: "Outcome source unavailable" },
        }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Refresh market" }).click();
  const recovery = page.getByTestId("position-recovery");
  await expect(recovery).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("shared-trade-panel")).not.toBeVisible();
  await recovery.getByLabel("Pairs to merge").fill("1");
  await recovery.getByRole("button", { name: "Merge pairs into CST" }).click();
  await expect(recovery.getByTestId("selected-matched-pairs")).toHaveText("9");
  await page.unroute(deployment.rpcUrl);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByTestId("shared-cycle")).toHaveText("Cycle 2");
  await sets.getByRole("button", { name: "Merge pairs", exact: true }).click();
  await sets.getByLabel("Pairs to merge").fill("3");
  await sets.getByRole("button", { name: "Merge pairs into CST" }).click();
  await expect(sets.getByTestId("selected-matched-pairs")).toHaveText("6");
  // Split in two other questions and redeem all same-question pairs in one transaction.
  await sets.getByRole("button", { name: "Split CST", exact: true }).click();
  for (const [question, amount] of [
    ["1", "2"],
    ["2", "3"],
  ]) {
    await sets.getByLabel(/Question · cycle/).selectOption(question);
    await sets.getByLabel("CST to split").fill(amount);
    await sets.getByRole("button", { name: "Approve CST to split" }).click();
    await sets.getByRole("button", { name: "Split into YES + NO" }).click();
    await expect(
      page.getByText("Complete-set split confirmed.", { exact: true }).first(),
    ).toBeVisible();
  }
  await expect(sets.getByTestId("all-matched-pairs")).toHaveText("11 CST");
  await sets.getByRole("button", { name: "Merge all matched pairs" }).click();
  await expect(page.getByTestId("shared-collateral")).toHaveText("0 CST");
  // Send both sides of a new pair to wallet2 using direct owner ERC-1155 transfers.
  await sets.getByLabel(/Question · cycle/).selectOption("0");
  await sets.getByLabel("CST to split").fill("2");
  await sets.getByRole("button", { name: "Approve CST to split" }).click();
  await sets.getByRole("button", { name: "Split into YES + NO" }).click();
  await expect(sets.getByTestId("selected-matched-pairs")).toHaveText("2");
  for (const side of ["YES", "NO"]) {
    await page
      .getByRole("button", { name: `Transfer ${side}: More gestures?`, exact: true })
      .click();
    const transfer = page.getByTestId("transfer-position-panel");
    await transfer.getByLabel("Recipient address").fill(RECIPIENT);
    await transfer.getByLabel("Position units to transfer").fill("2");
    await transfer.getByRole("button", { name: "Transfer positions", exact: true }).click();
    await expect(transfer).not.toBeVisible();
  }
  const incoming = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "balancesOf",
    args: [2n, RECIPIENT],
  });
  expect(incoming[0][0]).toBe(2n * ONE);
  expect(incoming[1][0]).toBe(2n * ONE);
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
  await sets.getByRole("button", { name: "Merge pairs", exact: true }).click();
  await sets.getByLabel("Pairs to merge").fill("2");
  await sets.getByRole("button", { name: "Merge pairs into CST" }).click();
  await expect(page.getByTestId("shared-collateral")).toHaveText("0 CST");
  const recipientAfter = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "balancesOf",
    args: [2n, RECIPIENT],
  });
  expect(recipientAfter[0][0]).toBe(0n);
  expect(recipientAfter[1][0]).toBe(0n);
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

  await page.getByRole("link", { name: "Previous cycle" }).click();
  await expect(page.getByTestId("shared-cycle")).toHaveText("Cycle 1");
  await expect(page.getByText("8 of 8 answers known.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Roll remaining funds forward" }).click();
  await expect(page.getByText("Pool rollover confirmed.", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Follow current cycle" }).click();
  await expect(page.getByTestId("shared-cycle")).toHaveText("Cycle 2");
  await expect(page.getByTestId("shared-collateral")).not.toHaveText("0 CST");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/shared-market-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/shared-market-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
  const token = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "cst",
  });
  const totalBalance = await client.readContract({
    address: token,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [market],
  });
  const first = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "roundAccounting",
    args: [1n],
  });
  const second = await client.readContract({
    address: market,
    abi: sharedMarketAbi,
    functionName: "roundAccounting",
    args: [2n],
  });
  expect(totalBalance).toBe(first[0] + second[0]);
});
