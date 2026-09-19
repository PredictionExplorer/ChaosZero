import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { independentMarketAbi, settlementVaultAbi } from "../frontend/src/independent/abi";
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

test("independent pools: isolated prices, full closure, protected late claims, history and carry", async ({
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
  }
  await expect(page.getByTestId("question-0")).toContainText("Trading");
  await expect(page.getByRole("button", { name: "Retrieve winnings", exact: true })).toBeDisabled();
  await trade.getByLabel(/CST to spend/).fill("1");
  await trade.getByRole("button", { name: "Approve CST to trade" }).click();
  await trade.getByRole("button", { name: "Buy YES", exact: true }).click();
  await expect(trade.getByLabel(/CST to spend/)).toHaveValue("");
  const middlePrice = (await qs(1n))[0].currentYesBps;
  await page.getByRole("button", { name: "Advance 1 hour", exact: true }).click();
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
  const fund = page.getByTestId("independent-funding-panel");
  await fund.getByLabel(/New CST to add/).fill("8.000000000000000003");
  await fund.getByRole("checkbox").check();
  await fund.getByRole("button", { name: "Approve CST for funding" }).click();
  await fund.getByRole("button", { name: "Start and fund all eight pools" }).click();
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
  // No-trade cycle: every remaining CST can start the next pools with no new money.
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
  await page
    .getByTestId("independent-funding-panel")
    .getByRole("button", { name: "Start pools with carried CST" })
    .click();
  await expect(page.getByText("Cycle funding confirmed.", { exact: true }).first()).toBeVisible();
  await expect
    .poll(async () => (await qs(3n)).map((q) => q.activeCollateral))
    .toEqual(carryPreview.allocations);
  await expect(
    page
      .getByTestId("independent-funding-panel")
      .getByRole("button", { name: "Fund all eight pools", exact: true }),
  ).toBeVisible();
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
