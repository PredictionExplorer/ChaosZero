import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ACCOUNTS, LocalChain, SNAPSHOT_FILE_ENV } from "./support/chain";
import { localChainEnv } from "./support/env";

/**
 * Validates the local chain once, then records its pristine post-deploy state
 * as an anvil snapshot that every test rewinds to (see the `pristineChain`
 * fixture). The returned teardown rewinds one last time, so a stack started
 * by hand is left exactly as it was found and can be re-tested.
 */
export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  const env = localChainEnv();
  if (env === null) return undefined; // remote deployment: chain-agnostic suites only

  const chain = await LocalChain.connect(env);
  await assertFreshSandbox(chain);

  const dir = await mkdtemp(path.join(tmpdir(), "chaoszero-e2e-"));
  const file = path.join(dir, "pristine-snapshot.json");
  await writeFile(file, JSON.stringify({ id: await chain.snapshot() }));
  // Inherited by the worker processes.
  process.env[SNAPSHOT_FILE_ENV] = file;

  return async () => {
    try {
      await chain.resetToPristine();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/**
 * The market specs assume the state script/DeployLocal.s.sol leaves behind:
 * a live, seeded round and a funded wallet with no position yet. Checking it
 * up front turns "someone already traded on this anvil" into one clear error
 * instead of a dozen confusing assertion failures.
 */
async function assertFreshSandbox(chain: LocalChain): Promise<void> {
  const round = await chain.currentRound();
  const state = await chain.roundState(round);
  const pool = await chain.pool(round);
  const problems: string[] = [];
  if (!state.initialized || pool.totalShares === 0n)
    problems.push(`round ${round} has no liquidity`);
  if (state.resolved) problems.push(`round ${round} is already resolved`);
  if (!state.thresholdKnown || state.currentCount > state.threshold)
    problems.push(`round ${round} is not live`);
  for (const [name, account] of Object.entries(ACCOUNTS)) {
    if (name === "deployer") continue;
    const [tokens, lp, allowance, balance] = await Promise.all([
      chain.outcomeBalances(round, account),
      chain.lpPosition(round, account),
      chain.cstAllowance(account),
      chain.cstBalance(account),
    ]);
    if (tokens.yes + tokens.no + lp.shares + allowance > 0n)
      problems.push(`${name} ${account} already traded`);
    if (balance === 0n) problems.push(`${name} ${account} holds no CST`);
  }
  if (problems.length > 0) {
    throw new Error(
      `The chain at E2E_RPC_URL is not a fresh DeployLocal sandbox (${problems.join("; ")}). ` +
        "Restart anvil and redeploy, or let tools/e2e.sh provision a fresh stack.",
    );
  }
}
