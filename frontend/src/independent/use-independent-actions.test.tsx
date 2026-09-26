import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIndependentActions } from "./use-independent-actions";
import { ACCOUNT, GAME, MARKET, TOKEN, VAULT, snapshot, zero } from "./test-fixtures";
import type { IndependentRecovery, IndependentSnapshot } from "./models";
import { ONE } from "@/shared/math";

const mocks = vi.hoisted(() => ({
  chain: { id: 31337 },
  rpc: "http://127.0.0.1:8555" as string | null,
  account: "0x1111111111111111111111111111111111111111" as `0x${string}` | undefined,
  walletChain: 31337,
  available: true,
  getChainId: vi.fn(),
  getBlock: vi.fn(),
  simulate: vi.fn(),
  submit: vi.fn(),
  receipt: vi.fn(),
  createTest: vi.fn(),
  increase: vi.fn(),
  mine: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  appConfig: {
    chain: mocks.chain,
    get rpcUrl() {
      return mocks.rpc;
    },
  },
}));
vi.mock("wagmi", () => ({
  useConnection: () => ({ address: mocks.account, chainId: mocks.walletChain }),
  usePublicClient: () =>
    mocks.available
      ? {
          getChainId: mocks.getChainId,
          getBlock: mocks.getBlock,
          simulateContract: mocks.simulate,
          waitForTransactionReceipt: mocks.receipt,
        }
      : undefined,
  useWriteContract: () => ({ writeContractAsync: mocks.submit }),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createTestClient: mocks.createTest,
}));
vi.mock("sonner", () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() } }));
const clients: QueryClient[] = [];
function setup(
  state: IndependentSnapshot | undefined = snapshot(),
  recovery?: IndependentRecovery,
) {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(query);
  const invalidation = vi.spyOn(query, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={query}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(() => useIndependentActions(MARKET, state, recovery), { wrapper }),
    invalidation,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.chain.id = 31337;
  mocks.walletChain = 31337;
  mocks.rpc = "http://127.0.0.1:8555";
  mocks.account = ACCOUNT;
  mocks.available = true;
  mocks.getChainId.mockResolvedValue(31337);
  mocks.getBlock.mockResolvedValue({ timestamp: 1000n });
  mocks.simulate.mockResolvedValue({ request: {} });
  mocks.submit.mockResolvedValue(`0x${"ab".repeat(32)}`);
  mocks.receipt.mockResolvedValue({ status: "success" });
  mocks.createTest.mockReturnValue({ increaseTime: mocks.increase, mine: mocks.mine });
  mocks.increase.mockResolvedValue(60);
  mocks.mine.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  for (const q of clients.splice(0)) q.clear();
  vi.restoreAllMocks();
});

describe("independent transaction boundaries", () => {
  it.each([
    {
      name: "approve",
      invoke: (a: ReturnType<typeof useIndependentActions>) => a.approve(ONE),
      target: TOKEN,
      fn: "approve",
      args: [MARKET, ONE],
    },
    {
      name: "gift",
      invoke: (a: ReturnType<typeof useIndependentActions>) => a.fund(ONE),
      target: MARKET,
      fn: "fundRound",
      args: [1n, ONE],
    },
    {
      name: "bare distribution trigger",
      invoke: (a: ReturnType<typeof useIndependentActions>) => a.distribute(),
      target: MARKET,
      fn: "fundRound",
      args: [1n, 0n],
    },
    {
      name: "settlement",
      invoke: (a: ReturnType<typeof useIndependentActions>) => a.settle(),
      target: MARKET,
      fn: "settleRound",
      args: [1n],
    },
    {
      name: "claim",
      invoke: (a: ReturnType<typeof useIndependentActions>) => a.claim(),
      target: MARKET,
      fn: "claimKnown",
      args: [1n],
    },
    {
      name: "split",
      invoke: (a: ReturnType<typeof useIndependentActions>) => a.split(2, ONE),
      target: MARKET,
      fn: "splitPosition",
      args: [1n, 2, ONE],
    },
    {
      name: "merge",
      invoke: (a: ReturnType<typeof useIndependentActions>) => a.merge(2, ONE),
      target: MARKET,
      fn: "mergePosition",
      args: [1n, 2, ONE],
    },
    {
      name: "batch merge",
      invoke: (a: ReturnType<typeof useIndependentActions>) => a.mergeAll(zero()),
      target: MARKET,
      fn: "mergePositions",
      args: [1n, zero()],
    },
    {
      name: "transfer",
      invoke: (a: ReturnType<typeof useIndependentActions>) => a.transfer(2, true, ONE, GAME),
      target: MARKET,
      fn: "safeTransferFrom",
      args: [ACCOUNT, GAME, 21n, ONE, "0x"],
    },
  ])("preflights and confirms exact $name arguments", async ({ invoke, target, fn, args }) => {
    const { result, invalidation } = setup();
    await act(async () => {
      expect(await invoke(result.current)).toBe(true);
    });
    expect(mocks.simulate).toHaveBeenCalledWith(
      expect.objectContaining({
        address: target,
        functionName: fn,
        args,
        account: ACCOUNT,
        gas: 4_000_000n,
      }),
    );
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        address: target,
        functionName: fn,
        args,
        account: ACCOUNT,
        chainId: 31337,
      }),
    );
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["independent"] });
    expect(result.current.pending).toBeNull();
  });
  it.each([true, false])(
    "keeps exact %s quote amounts and uses the chain clock deadline",
    async (buy) => {
      const { result } = setup();
      await act(async () => {
        expect(await result.current.trade(7, false, buy, ONE, 2n * ONE)).toBe(true);
      });
      expect(mocks.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: buy ? "buy" : "sell",
          args: [1n, 7, false, ONE, 2n * ONE, 1900n],
        }),
      );
    },
  );
  it.each([
    "configured chain",
    "wallet chain",
    "RPC chain",
    "missing account",
    "missing client",
    "missing snapshot",
    "missing user",
    "different wallet",
    "different market",
  ])("blocks writes for %s", async (reason) => {
    const state = snapshot();
    if (reason === "configured chain") mocks.chain.id = 42161;
    if (reason === "wallet chain") mocks.walletChain = 42161;
    if (reason === "RPC chain") mocks.getChainId.mockResolvedValue(42161);
    if (reason === "missing account") mocks.account = undefined;
    if (reason === "missing client") mocks.available = false;
    if (reason === "missing user") state.user = null;
    if (reason === "different wallet") state.user!.owner = GAME;
    if (reason === "different market") state.market = GAME;
    const { result } =
      reason === "missing snapshot"
        ? (() => {
            const h = setup();
            h.unmount();
            const q = new QueryClient();
            clients.push(q);
            return renderHook(() => useIndependentActions(MARKET, undefined), {
              wrapper: ({ children }) => (
                <QueryClientProvider client={q}>{children}</QueryClientProvider>
              ),
            });
          })()
        : setup(state);
    await act(async () => {
      expect(await result.current.fund(ONE)).toBe(false);
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("never sends a zero gift; the bare trigger is a separate action", async () => {
    const { result } = setup();
    await act(async () => {
      expect(await result.current.fund(0n)).toBe(false);
    });
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(result.current.message).toMatch(/greater than zero/);
  });
  it("labels the distribution trigger and explains an empty trigger revert", async () => {
    mocks.simulate.mockRejectedValueOnce(new Error("InvalidParameters"));
    const { result } = setup();
    await act(async () => {
      expect(await result.current.distribute()).toBe(false);
    });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(result.current.message).toMatch(/Nothing is waiting to enter the pools/);
  });
  it("does not submit a failed preflight and resets controls", async () => {
    mocks.simulate.mockRejectedValueOnce(new Error("ProductWouldDecrease"));
    const { result, invalidation } = setup();
    await act(async () => {
      expect(await result.current.trade(0, true, true, ONE, 2n * ONE)).toBe(false);
    });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(result.current.message).toMatch(/new quote/);
    expect(result.current.pending).toBeNull();
    expect(invalidation).toHaveBeenCalledOnce();
  });
  it.each(["wallet", "reverted receipt", "receipt RPC"])(
    "cleans up %s failure and permits retry",
    async (kind) => {
      if (kind === "wallet") mocks.submit.mockRejectedValueOnce(new Error("User rejected request"));
      if (kind === "reverted receipt") mocks.receipt.mockResolvedValueOnce({ status: "reverted" });
      if (kind === "receipt RPC") mocks.receipt.mockRejectedValueOnce(new Error("RPC lost"));
      const { result, invalidation } = setup();
      await act(async () => {
        expect(await result.current.fund(ONE)).toBe(false);
      });
      expect(result.current.pending).toBeNull();
      expect(invalidation).toHaveBeenCalledOnce();
      await act(async () => {
        expect(await result.current.fund(ONE)).toBe(true);
      });
    },
  );
  it("locks duplicate requests until confirmation and fresh reads complete", async () => {
    const receipt = deferred<{ status: string }>();
    mocks.receipt.mockReturnValueOnce(receipt.promise);
    const { result, invalidation } = setup();
    const refresh = deferred<void>();
    invalidation.mockReturnValueOnce(refresh.promise);
    let original!: Promise<boolean>;
    act(() => {
      original = result.current.fund(ONE);
    });
    await waitFor(() => expect(mocks.receipt).toHaveBeenCalledOnce());
    await act(async () => {
      expect(await result.current.split(0, ONE)).toBe(false);
    });
    await act(async () => {
      receipt.resolve({ status: "success" });
    });
    await waitFor(() => expect(invalidation).toHaveBeenCalledOnce());
    expect(result.current.pending).toBe("Cycle funding");
    await act(async () => {
      refresh.resolve();
      await original;
    });
    expect(result.current.pending).toBeNull();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("pins the original account if the wallet changes during preflight", async () => {
    const flight = deferred<object>();
    mocks.simulate.mockReturnValueOnce(flight.promise);
    const { result, rerender } = setup();
    let started!: Promise<boolean>;
    act(() => {
      started = result.current.split(0, ONE);
    });
    await waitFor(() => expect(mocks.simulate).toHaveBeenCalledOnce());
    mocks.account = GAME;
    rerender();
    await act(async () => {
      flight.resolve({});
      await started;
    });
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ account: ACCOUNT, chainId: 31337 }),
    );
  });
});

describe("independent recovery and local controls", () => {
  const recovery = (): IndependentRecovery => ({
    market: MARKET,
    token: TOKEN,
    vault: VAULT,
    roundId: 5n,
    timestamp: 100n,
    settled: true,
    values: 1,
    questions: snapshot().questions,
    user: snapshot().user!,
  });
  it("permits merges, transfers and cached settled claims without a source snapshot", async () => {
    const r = recovery();
    const { result } = setup(undefined, r);
    await act(async () => {
      expect(await result.current.merge(0, ONE)).toBe(true);
      expect(await result.current.claim()).toBe(true);
      expect(await result.current.transfer(0, false, ONE, GAME)).toBe(true);
    });
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "claimKnown", args: [5n] }),
    );
    await act(async () => {
      expect(await result.current.fund(ONE)).toBe(false);
      expect(await result.current.split(0, ONE)).toBe(false);
    });
    expect(mocks.submit).toHaveBeenCalledTimes(3);
  });
  it.each(["unsettled claim", "different owner", "different market", "disconnected"])(
    "rejects unsafe recovery: %s",
    async (kind) => {
      const r = recovery();
      if (kind === "unsettled claim") r.settled = false;
      if (kind === "different owner") r.user.owner = GAME;
      if (kind === "different market") r.market = GAME;
      if (kind === "disconnected") mocks.account = undefined;
      const { result } = setup(undefined, r);
      await act(async () => {
        expect(await result.current.claim()).toBe(false);
      });
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it.each(["", "invalid", ACCOUNT, MARKET, "0x0000000000000000000000000000000000000000"])(
    "rejects transfer target %s",
    async (recipient) => {
      const { result } = setup();
      await act(async () => {
        expect(await result.current.transfer(0, true, ONE, recipient)).toBe(false);
      });
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it.each(["faucet", "eth", "cst", "close", "direct"] as const)(
    "preflights local %s calls",
    async (kind) => {
      const { result } = setup();
      await act(async () => {
        expect(await result.current.local(kind)).toBe(true);
      });
      expect(mocks.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          address: kind === "faucet" || kind === "direct" ? TOKEN : GAME,
          functionName: {
            faucet: "faucet",
            eth: "bidEth",
            cst: "bidCst",
            close: "closeCycle",
            direct: "transfer",
          }[kind],
        }),
      );
    },
  );
  it("sends the local direct transfer to the market with no market call", async () => {
    const { result } = setup();
    await act(async () => {
      expect(await result.current.local("direct")).toBe(true);
    });
    expect(mocks.simulate).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TOKEN,
        functionName: "transfer",
        args: [MARKET, 100n * ONE],
      }),
    );
    expect(result.current.message).toBe("Local direct CST transfer confirmed.");
  });
  it("refuses simulator writes without local snapshot data", async () => {
    const state = snapshot();
    state.local = null;
    const { result } = setup(state);
    await act(async () => {
      expect(await result.current.local("eth")).toBe(false);
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("advances the verified local clock and refreshes reads", async () => {
    const { result, invalidation } = setup();
    await act(async () => {
      await result.current.advance(60);
    });
    expect(mocks.increase).toHaveBeenCalledWith({ seconds: 60 });
    expect(mocks.mine).toHaveBeenCalledWith({ blocks: 1 });
    expect(invalidation).toHaveBeenCalledOnce();
    expect(result.current.pending).toBeNull();
  });
  it.each(["RPC chain", "increase", "mine"])(
    "cleans up failed local time control: %s",
    async (kind) => {
      if (kind === "RPC chain") mocks.getChainId.mockResolvedValueOnce(42161);
      if (kind === "increase") mocks.increase.mockRejectedValueOnce(new Error("Failed"));
      if (kind === "mine") mocks.mine.mockRejectedValueOnce(new Error("Failed"));
      const { result } = setup();
      await act(async () => {
        await result.current.advance(60);
      });
      expect(result.current.pending).toBeNull();
      await act(async () => {
        await result.current.advance(60);
      });
      expect(result.current.message).toBe("Local time advanced.");
    },
  );
  it("blocks concurrent time and financial operations", async () => {
    const time = deferred<number>();
    mocks.increase.mockReturnValueOnce(time.promise);
    const { result } = setup();
    let started!: Promise<void>;
    act(() => {
      started = result.current.advance(60);
    });
    await waitFor(() => expect(mocks.increase).toHaveBeenCalledOnce());
    await act(async () => {
      await result.current.advance(60);
      expect(await result.current.fund(ONE)).toBe(false);
    });
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(async () => {
      time.resolve(60);
      await started;
    });
  });
});
