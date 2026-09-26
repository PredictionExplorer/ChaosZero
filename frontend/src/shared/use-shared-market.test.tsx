import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  UserRejectedRequestError,
} from "viem";
import { sharedMarketAbi } from "./abi";
import type { PositionRecovery } from "./use-position-recovery";
import {
  useSharedActions,
  useSharedMarket,
  type CycleStats,
  type SharedSnapshot,
} from "./use-shared-market";

const mocks = vi.hoisted(() => ({
  config: { chain: { id: 31337, name: "Anvil" }, rpcUrl: "http://127.0.0.1:8555" as string | null },
  connection: {
    address: "0x1111111111111111111111111111111111111111" as `0x${string}` | undefined,
    chainId: 31337 as number | undefined,
  },
  clientAvailable: true,
  getBlock: vi.fn(),
  getChainId: vi.fn(),
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  submitContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  increaseTime: vi.fn(),
  mine: vi.fn(),
  createTestClient: vi.fn(),
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/config", () => ({ appConfig: mocks.config }));
vi.mock("wagmi", () => ({
  useConnection: () => mocks.connection,
  usePublicClient: () =>
    mocks.clientAvailable
      ? {
          getBlock: mocks.getBlock,
          getChainId: mocks.getChainId,
          readContract: mocks.readContract,
          simulateContract: mocks.simulateContract,
          waitForTransactionReceipt: mocks.waitForTransactionReceipt,
        }
      : undefined,
  useWriteContract: () => ({ writeContractAsync: mocks.submitContract }),
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createTestClient: mocks.createTestClient,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const SOURCE = "0x4444444444444444444444444444444444444444" as const;
const GAME = "0x5555555555555555555555555555555555555555" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const ONE = 10n ** 18n;
const zeros = () => Array<bigint>(8).fill(0n);
const stats = (gestureCount: bigint): CycleStats => ({
  gestureCount,
  ethSpent: ONE / 10n,
  cstBurned: 500n * ONE,
  highestCstPaid: 200n * ONE,
  enduranceDuration: 600n,
  chronoDuration: 800n,
  enduranceGesture: 2n,
  chronoGesture: 3n,
  firstGestureTime: 200n,
  lastGestureTime: 800n,
  finalized: false,
});
function snapshot(): SharedSnapshot {
  return {
    roundId: 6n,
    currentRound: 7n,
    timestamp: 1_000n,
    token: TOKEN,
    source: SOURCE,
    game: GAME,
    funded: true,
    open: true,
    finalized: false,
    pool: { collateral: 10_000n * ONE, yes: zeros(), no: zeros(), knownMask: 0, values: 0 },
    user: {
      yes: [ONE, ...zeros().slice(1)],
      no: zeros(),
      balance: 1_000n * ONE,
      allowance: 20n * ONE,
    },
    local: {
      ethPrice: ONE / 100n,
      cstPrice: 400n * ONE,
      deadline: 2_000n,
      current: stats(7n),
      previous: stats(6n),
    },
  };
}

let readResults: Record<string, unknown>;
const clients: QueryClient[] = [];
function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidate, wrapper };
}
function actions(value: SharedSnapshot | undefined = snapshot()) {
  const context = harness();
  return {
    ...context,
    ...renderHook(() => useSharedActions(MARKET, value), { wrapper: context.wrapper }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.chain.id = 31337;
  mocks.config.rpcUrl = "http://127.0.0.1:8555";
  mocks.connection.address = ACCOUNT;
  mocks.connection.chainId = 31337;
  mocks.clientAvailable = true;
  mocks.getBlock.mockResolvedValue({ number: 456n, timestamp: 1_234n });
  mocks.getChainId.mockResolvedValue(31337);
  mocks.simulateContract.mockResolvedValue({ request: {} });
  mocks.submitContract.mockResolvedValue(HASH);
  mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  mocks.increaseTime.mockResolvedValue(60);
  mocks.mine.mockResolvedValue(undefined);
  mocks.createTestClient.mockReturnValue({ increaseTime: mocks.increaseTime, mine: mocks.mine });
  mocks.toast.loading.mockReturnValue("toast-1");
  readResults = {
    cst: TOKEN,
    source: SOURCE,
    game: GAME,
    decimals: 18,
    roundNum: 7n,
    roundAccounting: [10_000n * ONE, true, 1, 1],
    liabilities: [zeros(), zeros()],
    outcomeState: [true, false, 9, 9],
    balancesOf: [[ONE, ...zeros().slice(1)], zeros()],
    balanceOf: 1_000n * ONE,
    allowance: 20n * ONE,
    getNextEthPrice: ONE / 100n,
    getNextCstPrice: 400n * ONE,
    mainPrizeTime: 2_000n,
  };
  mocks.readContract.mockImplementation(
    async (request: { functionName: string; args?: readonly unknown[] }) => {
      if (request.functionName === "roundStats") return stats(request.args?.[0] === 7n ? 7n : 6n);
      if (!(request.functionName in readResults))
        throw new Error(`Unexpected RPC read ${request.functionName}`);
      return readResults[request.functionName];
    },
  );
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

describe("useSharedMarket snapshot assembly", () => {
  it("pins every dependent read to one block and uses live source bits instead of cached bits", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, null), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.getBlock).toHaveBeenCalledOnce();
    expect(mocks.readContract.mock.calls.length).toBeGreaterThan(10);
    for (const [request] of mocks.readContract.mock.calls) expect(request.blockNumber).toBe(456n);
    expect(result.current.data).toMatchObject({
      roundId: 7n,
      currentRound: 7n,
      timestamp: 1_234n,
      token: TOKEN,
      source: SOURCE,
      game: GAME,
      funded: true,
      open: true,
      finalized: false,
    });
    expect(result.current.data!.pool).toEqual({
      collateral: 10_000n * ONE,
      yes: zeros(),
      no: zeros(),
      knownMask: 9,
      values: 9,
    });
    expect(result.current.data!.user).toEqual({
      yes: [ONE, ...zeros().slice(1)],
      no: zeros(),
      balance: 1_000n * ONE,
      allowance: 20n * ONE,
    });
    expect(result.current.data!.local).toMatchObject({
      ethPrice: ONE / 100n,
      cstPrice: 400n * ONE,
      deadline: 2_000n,
      current: { gestureCount: 7n },
      previous: { gestureCount: 6n },
    });
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: SOURCE, functionName: "outcomeState", args: [7n] }),
    );
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TOKEN,
        functionName: "allowance",
        args: [ACCOUNT, MARKET],
      }),
    );
  });

  it("scopes historical market, wallet and baseline reads to the requested cycle", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, 3n), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.roundId).toBe(3n);
    expect(result.current.data!.currentRound).toBe(7n);
    for (const name of ["roundAccounting", "liabilities", "outcomeState"])
      expect(mocks.readContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: name, args: [3n] }),
      );
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "balancesOf", args: [3n, ACCOUNT] }),
    );
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "roundStats", args: [2n] }),
    );
  });

  it("does not query a negative baseline for cycle zero", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, 0n), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.local!.previous).toBeNull();
    expect(
      mocks.readContract.mock.calls.filter(([request]) => request.functionName === "roundStats"),
    ).toHaveLength(1);
  });

  it("skips all wallet reads when disconnected without inventing zero balances", async () => {
    mocks.connection.address = undefined;
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, null), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.user).toBeNull();
    expect(
      mocks.readContract.mock.calls.some(([request]) =>
        ["balancesOf", "balanceOf", "allowance"].includes(request.functionName),
      ),
    ).toBe(false);
  });

  it("never requests simulator-specific metrics on a public chain", async () => {
    mocks.config.chain.id = 42161;
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, null), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.local).toBeNull();
    expect(
      mocks.readContract.mock.calls.some(([request]) =>
        ["roundStats", "getNextEthPrice", "getNextCstPrice", "mainPrizeTime"].includes(
          request.functionName,
        ),
      ),
    ).toBe(false);
  });

  it("waits for a public client and safely rejects an explicit refetch before one exists", async () => {
    mocks.clientAvailable = false;
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mocks.getBlock).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.error?.message).toMatch(/connection is not ready/));
  });

  it("rejects token decimals before treating token units as CST", async () => {
    readResults.decimals = 6;
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, null), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/18-decimal/);
    expect(result.current.data).toBeUndefined();
    expect(
      mocks.readContract.mock.calls.some(([request]) => request.functionName === "roundAccounting"),
    ).toBe(false);
  });

  it.each([
    { name: "value without a known bit", cached: [0, 0], source: [true, false, 0, 1] },
    { name: "forgotten known bit", cached: [1, 1], source: [true, false, 0, 0] },
    { name: "changed known value", cached: [1, 1], source: [true, false, 1, 0] },
    { name: "finalized but open", cached: [0, 0], source: [true, true, 255, 1] },
    { name: "finalized but incomplete", cached: [0, 0], source: [false, true, 1, 1] },
  ])("rejects an inconsistent outcome source: $name", async ({ cached, source }) => {
    readResults.roundAccounting = [10_000n * ONE, true, ...cached];
    readResults.outcomeState = source;
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, null), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/inconsistent state/);
    expect(result.current.data).toBeUndefined();
  });

  it("accepts a consistent final result containing both YES and NO answers", async () => {
    readResults.outcomeState = [false, true, 255, 137];
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, null), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      open: false,
      finalized: true,
      pool: { knownMask: 255, values: 137 },
    });
  });

  it("exposes a refresh failure even when a prior good snapshot remains cached", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useSharedMarket(MARKET, null), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    mocks.getBlock.mockRejectedValueOnce(new Error("RPC unavailable"));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toBeDefined();
    await waitFor(() => expect(result.current.error?.message).toBe("RPC unavailable"));
    expect(result.current.isError).toBe(true);
  });
});

describe("useSharedActions transaction boundaries", () => {
  it.each([
    {
      label: "split",
      invoke: (hook: ReturnType<typeof useSharedActions>) => hook.split(2, 3n * ONE),
      address: MARKET,
      name: "splitPosition",
      args: [6n, 2, 3n * ONE],
    },
    {
      label: "merge",
      invoke: (hook: ReturnType<typeof useSharedActions>) => hook.merge(2, 3n * ONE),
      address: MARKET,
      name: "mergePosition",
      args: [6n, 2, 3n * ONE],
    },
    {
      label: "batch merge",
      invoke: (hook: ReturnType<typeof useSharedActions>) =>
        hook.mergeAll([ONE, 0n, 2n * ONE, 0n, 0n, 0n, 0n, 0n]),
      address: MARKET,
      name: "mergePositions",
      args: [6n, [ONE, 0n, 2n * ONE, 0n, 0n, 0n, 0n, 0n]],
    },
    {
      label: "approval",
      invoke: (hook: ReturnType<typeof useSharedActions>) => hook.approve(25n * ONE),
      address: TOKEN,
      name: "approve",
      args: [MARKET, 25n * ONE],
    },
    {
      label: "funding",
      invoke: (hook: ReturnType<typeof useSharedActions>) => hook.fund(50n * ONE),
      address: MARKET,
      name: "fundRound",
      args: [6n, 50n * ONE],
    },
    {
      label: "claim",
      invoke: (hook: ReturnType<typeof useSharedActions>) => hook.claim(),
      address: MARKET,
      name: "claimKnown",
      args: [6n],
    },
    {
      label: "rollover",
      invoke: (hook: ReturnType<typeof useSharedActions>) => hook.rollover(),
      address: MARKET,
      name: "rollover",
      args: [6n, 7n],
    },
  ])(
    "preflights and submits exact $label arguments, then confirms and invalidates reads",
    async ({ invoke, address, name, args }) => {
      const { result, invalidate } = actions();
      await act(async () => {
        expect(await invoke(result.current)).toBe(true);
      });
      expect(mocks.simulateContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address,
          functionName: name,
          args,
          account: ACCOUNT,
          gas: 2_000_000n,
        }),
      );
      expect(mocks.submitContract).toHaveBeenCalledWith(
        expect.objectContaining({ address, functionName: name, args, gas: 2_000_000n }),
      );
      expect(mocks.simulateContract.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.submitContract.mock.invocationCallOrder[0],
      );
      expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["shared-market"] });
      expect(result.current.pending).toBeNull();
      expect(result.current.message).toMatch(/confirmed/);
      expect(mocks.toast.success).toHaveBeenCalledOnce();
    },
  );

  it.each([true, false])(
    "uses exact %s trade amounts and a deadline from the current chain clock",
    async (buy) => {
      vi.spyOn(Date, "now").mockReturnValue(9_999_999_999_000);
      const { result } = actions();
      await act(async () => {
        expect(await result.current.trade(7, false, buy, 10n * ONE, 17n * ONE)).toBe(true);
      });
      const expected = {
        address: MARKET,
        functionName: buy ? "buy" : "sell",
        args: [6n, 7, false, 10n * ONE, 17n * ONE, 2_134n],
        gas: 24_000_000n,
      };
      expect(mocks.simulateContract).toHaveBeenCalledWith(
        expect.objectContaining({ ...expected, account: ACCOUNT }),
      );
      expect(mocks.submitContract).toHaveBeenCalledWith(expect.objectContaining(expected));
    },
  );

  it("transfers only the connected owner's exact ERC-1155 position ID and units", async () => {
    const { result, invalidate } = actions();
    await act(async () => {
      expect(await result.current.transfer(2, true, 3n * ONE, GAME)).toBe(true);
    });
    expect(mocks.submitContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MARKET,
        functionName: "safeTransferFrom",
        args: [ACCOUNT, GAME, 101n, 3n * ONE, "0x"],
        gas: 2_000_000n,
        chainId: 31337,
      }),
    );
    expect(mocks.simulateContract).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it.each(["", "not-an-address", "0x0000000000000000000000000000000000000000", ACCOUNT, MARKET])(
    "rejects invalid transfer recipient %s before preflight",
    async (recipient) => {
      const { result } = actions();
      await act(async () => {
        expect(await result.current.transfer(0, true, ONE, recipient)).toBe(false);
      });
      expect(mocks.simulateContract).not.toHaveBeenCalled();
      expect(mocks.submitContract).not.toHaveBeenCalled();
      expect(result.current.message).not.toBeNull();
    },
  );

  it("cannot transfer without a connected owner", async () => {
    mocks.connection.address = undefined;
    const { result } = actions();
    await act(async () => {
      expect(await result.current.transfer(0, true, ONE, GAME)).toBe(false);
    });
    expect(result.current.message).toMatch(/Connect your wallet/);
    expect(mocks.submitContract).not.toHaveBeenCalled();
  });

  it("merges and transfers freshly read recovery positions without a game snapshot or source reads", async () => {
    const { wrapper, invalidate } = harness();
    const recovered: PositionRecovery = {
      owner: ACCOUNT,
      roundId: 3n,
      token: TOKEN,
      timestamp: 1234n,
      collateral: 100n * ONE,
      user: snapshot().user!,
    };
    const { result } = renderHook(() => useSharedActions(MARKET, undefined, recovered), {
      wrapper,
    });
    await act(async () => {
      expect(await result.current.merge(1, ONE)).toBe(true);
    });
    expect(mocks.submitContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ functionName: "mergePosition", args: [3n, 1, ONE] }),
    );
    await act(async () => {
      expect(await result.current.mergeAll([ONE, 0n, 0n, 0n, 0n, 0n, 0n, 0n])).toBe(true);
    });
    expect(mocks.submitContract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: "mergePositions",
        args: [3n, [ONE, 0n, 0n, 0n, 0n, 0n, 0n, 0n]],
      }),
    );
    await act(async () => {
      expect(await result.current.transfer(0, false, ONE, GAME)).toBe(true);
    });
    expect(mocks.submitContract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: "safeTransferFrom",
        args: [ACCOUNT, GAME, 48n, ONE, "0x"],
      }),
    );
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.getBlock).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(3);
    await act(async () => {
      expect(await result.current.split(0, ONE)).toBe(false);
    });
    expect(result.current.message).toMatch(/Only merges and owner transfers/);
    expect(mocks.submitContract).toHaveBeenCalledTimes(3);
  });

  it("rejects cached recovery balances belonging to another or disconnected wallet", async () => {
    const { wrapper } = harness();
    const recovered: PositionRecovery = {
      owner: GAME,
      roundId: 3n,
      token: TOKEN,
      timestamp: 1234n,
      collateral: 100n * ONE,
      user: snapshot().user!,
    };
    const { result, rerender } = renderHook(() => useSharedActions(MARKET, undefined, recovered), {
      wrapper,
    });
    await act(async () => {
      expect(await result.current.merge(0, ONE)).toBe(false);
    });
    expect(result.current.message).toMatch(/different wallet/);
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    mocks.connection.address = undefined;
    rerender();
    await act(async () => {
      expect(await result.current.merge(0, ONE)).toBe(false);
    });
    expect(result.current.message).toMatch(/Connect your wallet/);
    expect(mocks.submitContract).not.toHaveBeenCalled();
  });

  it("pins the original sender when the wallet changes while preflight is in flight", async () => {
    const preflight = deferred<{ request: object }>();
    mocks.simulateContract.mockReturnValueOnce(preflight.promise);
    const { result, rerender } = actions();
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.split(0, ONE);
    });
    await waitFor(() => expect(mocks.simulateContract).toHaveBeenCalledOnce());
    mocks.connection.address = GAME;
    rerender();
    await act(async () => {
      preflight.resolve({ request: {} });
      expect(await first).toBe(true);
    });
    expect(mocks.submitContract).toHaveBeenCalledWith(
      expect.objectContaining({ account: ACCOUNT, chainId: 31337, functionName: "splitPosition" }),
    );
  });

  it("does not open the wallet when the contract rejects the preflight", async () => {
    mocks.simulateContract.mockRejectedValueOnce(
      new ContractFunctionRevertedError({
        abi: sharedMarketAbi,
        functionName: "buy",
        data: encodeErrorResult({ abi: sharedMarketAbi, errorName: "AnswerKnown" }),
      }),
    );
    const { result, invalidate } = actions();
    await act(async () => {
      expect(await result.current.trade(0, true, true, ONE, 2n * ONE)).toBe(false);
    });
    expect(mocks.submitContract).not.toHaveBeenCalled();
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(result.current.message).toMatch(/already known/);
    expect(result.current.pending).toBeNull();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(mocks.toast.error).toHaveBeenCalledOnce();
  });

  it("handles wallet cancellation and restores controls", async () => {
    mocks.submitContract.mockRejectedValueOnce(
      new BaseError("rejected", {
        cause: new UserRejectedRequestError(new Error("User rejected")),
      }),
    );
    const { result, invalidate } = actions();
    await act(async () => {
      expect(await result.current.approve(ONE)).toBe(false);
    });
    expect(result.current.message).toBe("Transaction cancelled in your wallet.");
    expect(result.current.pending).toBeNull();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("never presents a reverted receipt as successful", async () => {
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });
    const { result, invalidate } = actions();
    await act(async () => {
      expect(await result.current.fund(ONE)).toBe(false);
    });
    expect(result.current.message).toMatch(/Refresh and try again/);
    expect(result.current.pending).toBeNull();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("releases pending state after an RPC receipt failure", async () => {
    mocks.waitForTransactionReceipt.mockRejectedValueOnce(new Error("Receipt connection lost"));
    const { result, invalidate } = actions();
    await act(async () => {
      expect(await result.current.claim()).toBe(false);
    });
    expect(result.current.message).toBe("Receipt connection lost");
    expect(result.current.pending).toBeNull();
    expect(invalidate).toHaveBeenCalledOnce();
    await act(async () => {
      expect(await result.current.claim()).toBe(true);
    });
    expect(mocks.submitContract).toHaveBeenCalledTimes(2);
  });

  it("rejects public-chain configuration before any preflight or wallet request", async () => {
    mocks.config.chain.id = 42161;
    const { result, invalidate } = actions();
    await act(async () => {
      expect(await result.current.fund(ONE)).toBe(false);
    });
    expect(result.current.message).toMatch(/only allows transactions on the local/);
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submitContract).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refuses a wallet on a public chain even when the application targets Anvil", async () => {
    mocks.connection.chainId = 42161;
    const { result } = actions();
    await act(async () => {
      expect(await result.current.fund(ONE)).toBe(false);
    });
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submitContract).not.toHaveBeenCalled();
    expect(result.current.message).toMatch(/Switch your wallet.*local/);
  });

  it("rejects a misconfigured RPC reporting a public chain before wallet submission", async () => {
    mocks.getChainId.mockResolvedValueOnce(42161);
    const { result } = actions();
    await act(async () => {
      expect(await result.current.fund(ONE)).toBe(false);
    });
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submitContract).not.toHaveBeenCalled();
    expect(result.current.message).toMatch(/RPC.*local/);
  });

  it("passes the target chain to the wallet to prevent a switch after preflight", async () => {
    const { result } = actions();
    await act(async () => {
      expect(await result.current.fund(ONE)).toBe(true);
    });
    expect(mocks.submitContract).toHaveBeenCalledWith(expect.objectContaining({ chainId: 31337 }));
  });

  it("rejects a missing wallet or missing market snapshot", async () => {
    mocks.connection.address = undefined;
    const disconnected = actions();
    await act(async () => {
      expect(await disconnected.result.current.claim()).toBe(false);
    });
    expect(disconnected.result.current.message).toMatch(/Connect your wallet/);
    mocks.connection.address = ACCOUNT;
    const { wrapper, invalidate } = harness();
    const { result } = renderHook(() => useSharedActions(MARKET, undefined), { wrapper });
    await act(async () => {
      expect(await result.current.claim()).toBe(false);
    });
    expect(result.current.message).toBe("Market data unavailable");
    expect(invalidate).toHaveBeenCalledOnce();
    expect(mocks.submitContract).not.toHaveBeenCalled();
  });

  it("does not dispatch without an RPC client", async () => {
    mocks.clientAvailable = false;
    const { result, invalidate } = actions();
    await act(async () => {
      expect(await result.current.fund(ONE)).toBe(false);
    });
    expect(mocks.submitContract).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it("locks duplicate submissions through confirmation and the balance refresh", async () => {
    const receipt = deferred<{ status: string }>();
    mocks.waitForTransactionReceipt.mockReturnValueOnce(receipt.promise);
    const { result, invalidate } = actions();
    const refreshing = deferred<void>();
    invalidate.mockReturnValueOnce(refreshing.promise);
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.fund(ONE);
    });
    await waitFor(() => expect(mocks.waitForTransactionReceipt).toHaveBeenCalledOnce());
    expect(result.current.pending).toBe("Pool gift");
    await act(async () => {
      expect(await result.current.fund(2n * ONE)).toBe(false);
    });
    expect(mocks.submitContract).toHaveBeenCalledOnce();
    await act(async () => {
      receipt.resolve({ status: "success" });
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
    expect(result.current.pending).toBe("Pool gift");
    await act(async () => {
      expect(await result.current.claim()).toBe(false);
    });
    await act(async () => {
      refreshing.resolve();
      expect(await first).toBe(true);
    });
    expect(result.current.pending).toBeNull();
    await act(async () => {
      expect(await result.current.claim()).toBe(true);
    });
    expect(mocks.submitContract).toHaveBeenCalledTimes(2);
  });
});

describe("local development action boundaries", () => {
  it.each([
    {
      kind: "faucet" as const,
      address: TOKEN,
      name: "faucet",
      args: [1_000n * ONE],
      value: undefined,
    },
    { kind: "eth" as const, address: GAME, name: "bidEth", args: undefined, value: ONE / 100n },
    { kind: "cst" as const, address: GAME, name: "bidCst", args: [400n * ONE], value: undefined },
    {
      kind: "close" as const,
      address: GAME,
      name: "closeCycle",
      args: undefined,
      value: undefined,
    },
  ])(
    "sends exact local $kind calls through preflight and receipt confirmation",
    async ({ kind, address, name, args, value }) => {
      const { result, invalidate } = actions();
      await act(async () => {
        expect(await result.current.local(kind)).toBe(true);
      });
      const request = mocks.submitContract.mock.calls[0][0];
      expect(request.address).toBe(address);
      expect(request.functionName).toBe(name);
      expect(request.args).toEqual(args);
      expect(request.value).toBe(value);
      expect(request.gas).toBe(2_000_000n);
      expect(mocks.simulateContract).toHaveBeenCalledWith(
        expect.objectContaining({ address, functionName: name, account: ACCOUNT, gas: 2_000_000n }),
      );
      expect(invalidate).toHaveBeenCalledOnce();
    },
  );

  it("refuses local game writes if the snapshot has no simulator data", async () => {
    const state = snapshot();
    state.local = null;
    const { result } = actions(state);
    await act(async () => {
      expect(await result.current.local("eth")).toBe(false);
    });
    expect(result.current.message).toMatch(/Local controls are unavailable/);
    expect(mocks.submitContract).not.toHaveBeenCalled();
  });

  it("advances only the configured local RPC clock, then mines and refreshes", async () => {
    const { result, invalidate } = actions();
    await act(async () => {
      await result.current.advance(60);
    });
    expect(mocks.createTestClient).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: mocks.config.chain,
        mode: "anvil",
        transport: expect.any(Function),
      }),
    );
    expect(mocks.increaseTime).toHaveBeenCalledWith({ seconds: 60 });
    expect(mocks.mine).toHaveBeenCalledWith({ blocks: 1 });
    expect(mocks.increaseTime.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mine.mock.invocationCallOrder[0],
    );
    expect(invalidate).toHaveBeenCalledOnce();
    expect(result.current.message).toBe("Local time advanced.");
    expect(result.current.pending).toBeNull();
    expect(mocks.submitContract).not.toHaveBeenCalled();
  });

  it.each(["increase", "mine", "client"])(
    "cleans up a failed time-control %s step and permits retry",
    async (step) => {
      if (step === "increase")
        mocks.increaseTime.mockRejectedValueOnce(new Error("Time control failed"));
      if (step === "mine") mocks.mine.mockRejectedValueOnce(new Error("Time control failed"));
      if (step === "client")
        mocks.createTestClient.mockImplementationOnce(() => {
          throw new Error("Time control failed");
        });
      const { result, invalidate } = actions();
      await act(async () => {
        await result.current.advance(60);
      });
      expect(result.current.message).toBe("Time control failed");
      expect(result.current.pending).toBeNull();
      expect(invalidate).toHaveBeenCalledOnce();
      await act(async () => {
        await result.current.advance(3600);
      });
      expect(result.current.message).toBe("Local time advanced.");
      expect(invalidate).toHaveBeenCalledTimes(2);
    },
  );

  it("does not advance a misconfigured RPC that reports a public chain", async () => {
    mocks.getChainId.mockResolvedValueOnce(42161);
    const { result, invalidate } = actions();
    await act(async () => {
      await result.current.advance(60);
    });
    expect(mocks.createTestClient).not.toHaveBeenCalled();
    expect(mocks.increaseTime).not.toHaveBeenCalled();
    expect(result.current.message).toMatch(/RPC.*local/);
    expect(result.current.pending).toBeNull();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it.each(["public", "missing RPC"])(
    "does not create a development client for %s configuration",
    async (kind) => {
      if (kind === "public") mocks.config.chain.id = 42161;
      else mocks.config.rpcUrl = null;
      const { result, invalidate } = actions();
      await act(async () => {
        await result.current.advance(60);
      });
      expect(mocks.createTestClient).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
      expect(result.current.pending).toBeNull();
    },
  );

  it("shares the submission lock between local time controls and financial transactions", async () => {
    const delay = deferred<number>();
    mocks.increaseTime.mockReturnValueOnce(delay.promise);
    const { result } = actions();
    let first!: Promise<void>;
    act(() => {
      first = result.current.advance(60);
    });
    await waitFor(() => expect(result.current.pending).toBe("Advancing local time"));
    await act(async () => {
      await result.current.advance(60);
      expect(await result.current.fund(ONE)).toBe(false);
    });
    expect(mocks.increaseTime).toHaveBeenCalledOnce();
    expect(mocks.submitContract).not.toHaveBeenCalled();
    await act(async () => {
      delay.resolve(60);
      await first;
    });
    expect(result.current.pending).toBeNull();
  });
});
