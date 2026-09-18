import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { erc20Abi } from "@/lib/abi/erc20";
import { gestureSeriesMarketAbi } from "@/lib/abi/gesture-series-market";
import { useMarketActions, type ActionKind, type MarketActions } from "./use-market-actions";

const boundary = vi.hoisted(() => ({
  write: vi.fn(),
  receipt: vi.fn(),
  invalidate: vi.fn(),
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  config: { uid: "isolated-wallet-config" },
  explorer: "https://arbiscan.io/" as string | undefined,
}));

vi.mock("wagmi", () => ({
  useConfig: () => boundary.config,
  useWriteContract: () => ({ writeContractAsync: boundary.write }),
}));
vi.mock("wagmi/actions", () => ({ waitForTransactionReceipt: boundary.receipt }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: boundary.invalidate }),
}));
vi.mock("sonner", () => ({
  toast: { loading: boundary.loading, success: boundary.success, error: boundary.error },
}));
vi.mock("@/lib/config", () => ({
  appConfig: {
    get chain() {
      return {
        blockExplorers: boundary.explorer ? { default: { url: boundary.explorer } } : undefined,
      };
    },
  },
}));

const SERIES = "0x1111111111111111111111111111111111111111" as const;
const CST = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const NOW_MS = 1_780_000_000_999;
const DEADLINE = 1_780_000_900n;
const LARGE_AMOUNT = (1n << 128n) + 7n;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
  boundary.write.mockResolvedValue(HASH);
  boundary.receipt.mockResolvedValue({ status: "success" });
  boundary.invalidate.mockResolvedValue(undefined);
  boundary.loading.mockReturnValue("transaction-toast");
  boundary.explorer = "https://arbiscan.io/";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface ActionCase {
  name: string;
  kind: ActionKind;
  functionName: string;
  args: readonly unknown[];
  invoke: (actions: MarketActions) => Promise<boolean>;
  token?: boolean;
}

const cases: ActionCase[] = [
  {
    name: "exact token approval",
    kind: "approve",
    functionName: "approve",
    args: [SERIES, LARGE_AMOUNT],
    invoke: (a) => a.approve(CST, LARGE_AMOUNT),
    token: true,
  },
  {
    name: "YES trade with its minimum output",
    kind: "bet",
    functionName: "betYes",
    args: [7n, LARGE_AMOUNT, 11n, DEADLINE],
    invoke: (a) => a.bet("yes", LARGE_AMOUNT, 11n),
  },
  {
    name: "NO trade with its minimum output",
    kind: "bet",
    functionName: "betNo",
    args: [7n, 13n, 12n, DEADLINE],
    invoke: (a) => a.bet("no", 13n, 12n),
  },
  {
    name: "liquidity with opening odds, fee vote and share floor",
    kind: "addLiquidity",
    functionName: "addLiquidity",
    args: [7n, 21n, 175, 4300n, 17n, DEADLINE],
    invoke: (a) => a.addLiquidity(21n, 175, 4300n, 17n),
  },
  {
    name: "liquidity removal with both reserve floors",
    kind: "removeLiquidity",
    functionName: "removeLiquidity",
    args: [7n, 23n, 9n, 8n, DEADLINE],
    invoke: (a) => a.removeLiquidity(23n, 9n, 8n),
  },
  {
    name: "fee redeclaration",
    kind: "updateFee",
    functionName: "updateFeeDeclaration",
    args: [7n, 225],
    invoke: (a) => a.updateFeeDeclaration(225),
  },
  {
    name: "LP fee retrieval",
    kind: "claimFees",
    functionName: "claimFees",
    args: [7n],
    invoke: (a) => a.claimFees(),
  },
  {
    name: "complete-set creation",
    kind: "mint",
    functionName: "mintSets",
    args: [7n, 31n],
    invoke: (a) => a.mintSets(31n),
  },
  {
    name: "complete-set redemption",
    kind: "redeem",
    functionName: "redeemSets",
    args: [7n, 29n],
    invoke: (a) => a.redeemSets(29n),
  },
  {
    name: "permissionless resolution",
    kind: "resolve",
    functionName: "resolve",
    args: [7n],
    invoke: (a) => a.resolve(),
  },
  {
    name: "settled position retrieval",
    kind: "claim",
    functionName: "claim",
    args: [7n],
    invoke: (a) => a.claim(),
  },
];

describe("legacy market transaction boundaries", () => {
  it.each(cases)(
    "submits $name with the exact financial arguments",
    async ({ invoke, args, functionName, token, kind }) => {
      const wallet = deferred<typeof HASH>();
      boundary.write.mockReturnValueOnce(wallet.promise);
      const { result } = renderHook(() => useMarketActions(SERIES, 7n));
      let operation!: Promise<boolean>;
      act(() => {
        operation = invoke(result.current);
      });
      expect(result.current.pending).toBe(kind);
      await act(async () => {
        wallet.resolve(HASH);
        expect(await operation).toBe(true);
      });
      expect(boundary.write).toHaveBeenCalledExactlyOnceWith({
        address: token ? CST : SERIES,
        abi: token ? erc20Abi : gestureSeriesMarketAbi,
        functionName,
        args,
      });
      expect(boundary.receipt).toHaveBeenCalledExactlyOnceWith(boundary.config, { hash: HASH });
      expect(boundary.invalidate).toHaveBeenCalledTimes(1);
      expect(result.current.pending).toBeNull();
      expect(boundary.success).toHaveBeenCalledTimes(1);
      expect(boundary.error).not.toHaveBeenCalled();
    },
  );

  it("keeps the action pending through both wallet approval and chain confirmation", async () => {
    const wallet = deferred<typeof HASH>();
    const mined = deferred<{ status: string }>();
    boundary.write.mockReturnValue(wallet.promise);
    boundary.receipt.mockReturnValue(mined.promise);
    const { result } = renderHook(() => useMarketActions(SERIES, 7n));
    let operation!: Promise<boolean>;
    act(() => {
      operation = result.current.bet("yes", 10n, 15n);
    });
    expect(result.current.pending).toBe("bet");
    expect(boundary.receipt).not.toHaveBeenCalled();
    await act(async () => {
      wallet.resolve(HASH);
      await Promise.resolve();
    });
    expect(result.current.pending).toBe("bet");
    expect(boundary.loading.mock.calls[1][0]).toMatch(/waiting for confirmation/i);
    expect(boundary.invalidate).not.toHaveBeenCalled();
    await act(async () => {
      mined.resolve({ status: "success" });
      expect(await operation).toBe(true);
    });
    expect(result.current.pending).toBeNull();
    expect(boundary.invalidate).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate writes in the same tick and while a wallet request remains pending", async () => {
    const wallet = deferred<typeof HASH>();
    boundary.write.mockReturnValueOnce(wallet.promise);
    const { result } = renderHook(() => useMarketActions(SERIES, 7n));
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.bet("yes", 10n, 15n);
      second = result.current.claim();
    });
    expect(await second).toBe(false);
    await act(async () => {
      expect(await result.current.resolve()).toBe(false);
    });
    expect(boundary.write).toHaveBeenCalledTimes(1);
    await act(async () => {
      wallet.resolve(HASH);
      expect(await first).toBe(true);
    });
    await act(async () => {
      expect(await result.current.claim()).toBe(true);
    });
    expect(boundary.write).toHaveBeenCalledTimes(2);
  });

  it.each([
    { series: null, round: 7n },
    { series: SERIES, round: null },
    { series: null, round: null },
  ])(
    "refuses unloaded target $series / round $round before opening the wallet",
    async ({ series, round }) => {
      const { result } = renderHook(() => useMarketActions(series, round));
      await act(async () => {
        expect(await result.current.approve(CST, 10n)).toBe(false);
        expect(await result.current.claim()).toBe(false);
      });
      expect(boundary.write).not.toHaveBeenCalled();
      expect(boundary.receipt).not.toHaveBeenCalled();
      expect(boundary.invalidate).not.toHaveBeenCalled();
      expect(result.current.pending).toBeNull();
      expect(boundary.error).toHaveBeenCalledWith(expect.stringMatching(/still loading/i));
    },
  );

  it("refreshes the deadline for later submissions and uses the newly selected round", async () => {
    const { result, rerender } = renderHook(({ round }) => useMarketActions(SERIES, round), {
      initialProps: { round: 7n },
    });
    await act(async () => {
      await result.current.bet("yes", 1n, 1n);
    });
    vi.mocked(Date.now).mockReturnValue(NOW_MS + 61_001);
    rerender({ round: 9n });
    await act(async () => {
      await result.current.bet("no", 2n, 2n);
    });
    expect(boundary.write.mock.calls[0][0].args).toEqual([7n, 1n, 1n, DEADLINE]);
    expect(boundary.write.mock.calls[1][0].args).toEqual([9n, 2n, 2n, DEADLINE + 62n]);
  });

  it("reports wallet rejection, releases the lock and permits a retry", async () => {
    boundary.write.mockRejectedValueOnce(new Error("User rejected request"));
    const { result } = renderHook(() => useMarketActions(SERIES, 7n));
    await act(async () => {
      expect(await result.current.approve(CST, 10n)).toBe(false);
    });
    expect(boundary.error).toHaveBeenCalledWith("Transaction cancelled in your wallet.", {
      id: "transaction-toast",
    });
    expect(boundary.receipt).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
    expect(boundary.invalidate).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await result.current.approve(CST, 10n)).toBe(true);
    });
    expect(boundary.write).toHaveBeenCalledTimes(2);
  });

  it("does not announce success for a reverted receipt", async () => {
    boundary.receipt.mockResolvedValueOnce({ status: "reverted" });
    const { result } = renderHook(() => useMarketActions(SERIES, 7n));
    await act(async () => {
      expect(await result.current.redeemSets(10n)).toBe(false);
    });
    expect(boundary.error).toHaveBeenCalledWith(expect.stringMatching(/failed on-chain/), {
      id: "transaction-toast",
    });
    expect(boundary.success).not.toHaveBeenCalled();
    expect(boundary.invalidate).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull();
  });

  it("refreshes state and clears pending when receipt polling fails", async () => {
    boundary.receipt.mockRejectedValueOnce(new Error("Receipt RPC unavailable"));
    const { result } = renderHook(() => useMarketActions(SERIES, 7n));
    await act(async () => {
      expect(await result.current.claimFees()).toBe(false);
    });
    expect(boundary.error).toHaveBeenCalledWith("Receipt RPC unavailable", {
      id: "transaction-toast",
    });
    expect(boundary.invalidate).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull();
  });

  it("links pending and confirmed transactions to the same actual hash", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => useMarketActions(SERIES, 7n));
    await act(async () => {
      await result.current.resolve();
    });
    boundary.loading.mock.calls[1][1].action.onClick();
    boundary.success.mock.calls[0][1].action.onClick();
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenNthCalledWith(1, `https://arbiscan.io/tx/${HASH}`, "_blank");
    expect(open).toHaveBeenNthCalledWith(2, `https://arbiscan.io/tx/${HASH}`, "_blank");
  });

  it("confirms local transactions without inventing an explorer URL", async () => {
    boundary.explorer = undefined;
    const { result } = renderHook(() => useMarketActions(SERIES, 7n));
    await act(async () => {
      expect(await result.current.claim()).toBe(true);
    });
    expect(boundary.loading.mock.calls[1][1]).not.toHaveProperty("action");
    expect(boundary.success.mock.calls[0][1]).not.toHaveProperty("action");
  });
});
