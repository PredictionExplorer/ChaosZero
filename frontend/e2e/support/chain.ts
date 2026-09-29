import { readFile, writeFile } from "node:fs/promises";
import type {
  Abi,
  Address,
  ContractFunctionArgs,
  ContractFunctionName,
  Hash,
  Hex,
  PublicClient,
  TestClient,
  Transport,
} from "viem";
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi } from "viem";
import { anvil } from "viem/chains";
import { erc20Abi } from "../../src/lib/abi/erc20";
import { gestureSeriesMarketAbi } from "../../src/lib/abi/gesture-series-market";
import type { LocalChainEnv } from "./env";

/**
 * anvil's default dev accounts (mnemonic "test test … junk"): unlocked, so
 * anvil signs for them, and funded with CST by script/DeployLocal.s.sol.
 * Public test keys: they never hold real value on any real network.
 */
export const ACCOUNTS = {
  /** #0 — broadcasts DeployLocal and seeds the pool. */
  deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  /** #1 — the first account of the app's Mock Connector: "the user" in the browser. */
  wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  /** #2 — another trader, driven from Node. */
  trader: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
} as const satisfies Record<string, Address>;

export type Side = "yes" | "no";

/** MockGame (test/utils/Mocks.sol): the real game's round getter, plus the two setters tests drive it with. */
const mockGameAbi = parseAbi([
  "function roundNum() view returns (uint256)",
  "function setRoundNum(uint256 roundNum)",
  "function setNumBids(uint256 roundNum, uint256 numBids)",
]);

/** Env var naming the file that holds the current pristine-state snapshot id. */
export const SNAPSHOT_FILE_ENV = "E2E_CHAIN_SNAPSHOT_FILE";

/** Enough CST allowance for any single seeded action. */
const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * The local anvil chain the app under test is built against: state isolation
 * (snapshot / revert), the mock game's controls, and exact on-chain reads that
 * UI assertions are checked against.
 */
export class LocalChain {
  private constructor(
    readonly market: Address,
    readonly game: Address,
    readonly cst: Address,
    private readonly transport: Transport,
    private readonly client: PublicClient,
    private readonly test: TestClient<"anvil">,
  ) {}

  static async connect(env: LocalChainEnv): Promise<LocalChain> {
    // A local node answers instantly or not at all: fail fast, poll fast.
    const transport = http(env.rpcUrl, { retryCount: 0, timeout: 10_000 });
    const client = createPublicClient({ chain: anvil, transport, pollingInterval: 50 });
    const chainId = await client.getChainId();
    if (chainId !== anvil.id) {
      throw new Error(`E2E_RPC_URL ${env.rpcUrl} serves chain ${chainId}, expected anvil (${anvil.id}).`);
    }
    const code = await client.getCode({ address: env.market });
    if (!code || code === "0x") {
      throw new Error(`No contract at E2E_MARKET_ADDRESS ${env.market} — was script/DeployLocal.s.sol broadcast?`);
    }
    const [game, cst] = await Promise.all([
      client.readContract({ address: env.market, abi: gestureSeriesMarketAbi, functionName: "game" }),
      client.readContract({ address: env.market, abi: gestureSeriesMarketAbi, functionName: "cst" }),
    ]);
    const test = createTestClient({ chain: anvil, mode: "anvil", transport });
    return new LocalChain(env.market, game, cst, transport, client, test);
  }

  // ---------------------------------------------------------------- isolation

  snapshot(): Promise<Hex> {
    return this.test.snapshot();
  }

  async revert(id: Hex): Promise<void> {
    // viem types evm_revert as void, but anvil answers `false` (rather than an
    // error) for an unknown id — which would silently leave state dirty.
    const reverted = (await this.test.request({ method: "evm_revert", params: [id] })) as unknown;
    if (reverted !== true) throw new Error(`evm_revert(${id}) failed: the snapshot does not exist.`);
  }

  /**
   * Rewinds the chain to the pristine post-deploy state recorded by the
   * global setup, then re-snapshots (a revert consumes its snapshot). The id
   * lives in a file so it survives worker restarts after a failed test.
   */
  async resetToPristine(): Promise<void> {
    const file = process.env[SNAPSHOT_FILE_ENV];
    if (!file) throw new Error(`${SNAPSHOT_FILE_ENV} is not set — the Playwright global setup did not run.`);
    const { id } = JSON.parse(await readFile(file, "utf8")) as { id: Hex };
    await this.revert(id);
    await writeFile(file, JSON.stringify({ id: await this.snapshot() }));
  }

  // --------------------------------------------------------------- the game

  currentRound(): Promise<bigint> {
    return this.client.readContract({ address: this.game, abi: mockGameAbi, functionName: "roundNum" });
  }

  /** Sets a round's live gesture count, as players placing bids would. */
  async setGestureCount(round: bigint, count: bigint): Promise<void> {
    await this.send(ACCOUNTS.deployer, {
      address: this.game,
      abi: mockGameAbi,
      functionName: "setNumBids",
      args: [round, count],
    });
  }

  /** Moves the game to another round (ending the current one). */
  async setGameRound(round: bigint): Promise<void> {
    await this.send(ACCOUNTS.deployer, {
      address: this.game,
      abi: mockGameAbi,
      functionName: "setRoundNum",
      args: [round],
    });
  }

  // ------------------------------------------------------------------ reads

  async roundState(round: bigint) {
    const [initialized, thresholdKnown, resolved, yesWon, threshold, currentCount] = await this.client.readContract({
      address: this.market,
      abi: gestureSeriesMarketAbi,
      functionName: "roundState",
      args: [round],
    });
    return { initialized, thresholdKnown, resolved, yesWon, threshold, currentCount };
  }

  async pool(round: bigint) {
    const [reserveYes, reserveNo, totalShares] = await this.client.readContract({
      address: this.market,
      abi: gestureSeriesMarketAbi,
      functionName: "pool",
      args: [round],
    });
    return { reserveYes, reserveNo, totalShares };
  }

  feeBps(round: bigint): Promise<bigint> {
    return this.client.readContract({
      address: this.market,
      abi: gestureSeriesMarketAbi,
      functionName: "currentFeeBps",
      args: [round],
    });
  }

  quoteBet(side: Side, round: bigint, cstIn: bigint): Promise<bigint> {
    return this.client.readContract({
      address: this.market,
      abi: gestureSeriesMarketAbi,
      functionName: side === "yes" ? "quoteBetYes" : "quoteBetNo",
      args: [round, cstIn],
    });
  }

  cstBalance(owner: Address): Promise<bigint> {
    return this.client.readContract({ address: this.cst, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  }

  cstAllowance(owner: Address): Promise<bigint> {
    return this.client.readContract({
      address: this.cst,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, this.market],
    });
  }

  async outcomeBalances(round: bigint, owner: Address): Promise<{ yes: bigint; no: bigint }> {
    const [yes, no] = await this.client.readContract({
      address: this.market,
      abi: gestureSeriesMarketAbi,
      functionName: "balancesOf",
      args: [round, owner],
    });
    return { yes, no };
  }

  async lpPosition(round: bigint, owner: Address) {
    const [shares, pendingFees, declaredFeeBps] = await this.client.readContract({
      address: this.market,
      abi: gestureSeriesMarketAbi,
      functionName: "lpPositionOf",
      args: [round, owner],
    });
    return { shares, pendingFees, declaredFeeBps };
  }

  // ---------------------------------------------------------------- seeding

  /** Places a bet straight through the contract (no UI), as `from`. */
  async bet(from: Address, side: Side, round: bigint, cstIn: bigint): Promise<void> {
    await this.send(from, {
      address: this.cst,
      abi: erc20Abi,
      functionName: "approve",
      args: [this.market, MAX_UINT256],
    });
    await this.send(from, {
      address: this.market,
      abi: gestureSeriesMarketAbi,
      functionName: side === "yes" ? "betYes" : "betNo",
      args: [round, cstIn, 0n, await this.deadline()],
    });
    await this.revokeAllowance(from);
  }

  /** Joins the round's pool straight through the contract (no UI), as `from`. */
  async addLiquidity(from: Address, round: bigint, cstIn: bigint, declaredFeeBps: number): Promise<void> {
    await this.send(from, {
      address: this.cst,
      abi: erc20Abi,
      functionName: "approve",
      args: [this.market, MAX_UINT256],
    });
    await this.send(from, {
      address: this.market,
      abi: gestureSeriesMarketAbi,
      functionName: "addLiquidity",
      // The opening-odds argument only matters for the first LP; the pool is already open.
      args: [round, cstIn, declaredFeeBps, 5_000n, 0n, await this.deadline()],
    });
    await this.revokeAllowance(from);
  }

  /** Leaves no allowance behind, so the UI's approve step stays under test. */
  private async revokeAllowance(from: Address): Promise<void> {
    await this.send(from, { address: this.cst, abi: erc20Abi, functionName: "approve", args: [this.market, 0n] });
  }

  // --------------------------------------------------------------- plumbing

  private async deadline(): Promise<bigint> {
    const block = await this.client.getBlock();
    return block.timestamp + 3_600n;
  }

  /** Sends a transaction from an unlocked anvil account and requires success. */
  private async send<const abi extends Abi, name extends ContractFunctionName<abi, "nonpayable">>(
    from: Address,
    call: {
      address: Address;
      abi: abi;
      functionName: name;
      args: ContractFunctionArgs<abi, "nonpayable", name>;
    },
  ): Promise<Hash> {
    const wallet = createWalletClient({ account: from, chain: anvil, transport: this.transport });
    // `call` is fully checked against its ABI by this method's signature;
    // viem's own overloads cannot follow a generic ABI, hence the cast.
    const hash = await wallet.writeContract(call as unknown as Parameters<typeof wallet.writeContract>[0]);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${call.functionName} reverted (tx ${hash}).`);
    return hash;
  }
}
