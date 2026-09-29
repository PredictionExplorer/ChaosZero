import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Abi, Chain, Hash } from "viem";
import { UserRejectedRequestError, encodeFunctionData } from "viem";
import { arbitrum } from "viem/chains";
import { erc20Abi } from "@/lib/abi/erc20";
import { gestureSeriesMarketAbi } from "@/lib/abi/gesture-series-market";
import { CST, SERIES } from "@/test/fixtures";
import { createTestQueryClient, withQueryClient } from "@/test/query";
import { useMarketActions, type MarketActions } from "./use-market-actions";

const mocks = vi.hoisted(() => ({
  writeContractAsync: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
  chain: null as Chain | null,
  wagmiConfig: { id: "wagmi-config" },
}));

vi.mock("wagmi", () => ({
  useConfig: () => mocks.wagmiConfig,
  useWriteContract: () => ({ writeContractAsync: mocks.writeContractAsync }),
}));
vi.mock("wagmi/actions", () => ({ waitForTransactionReceipt: mocks.waitForTransactionReceipt }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    appConfig: {
      ...actual.appConfig,
      get chain() {
        return mocks.chain ?? actual.appConfig.chain;
      },
    },
  };
});

const HASH: Hash = `0x${"ab".repeat(32)}`;
const TOAST_ID = "toast-1";
const NOW = new Date("2026-06-01T12:00:00Z");
/** Every write expires 15 minutes after it is signed. */
const DEADLINE = BigInt(Math.floor(NOW.getTime() / 1000) + 15 * 60);
const ROUND = 5n;

/** A promise the test resolves by hand, to observe the in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The actions for round 5 of the series, plus a spy on cache invalidation. */
function renderActions() {
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const hook = renderHook(() => useMarketActions(SERIES, ROUND), { wrapper: withQueryClient(queryClient) });
  return { ...hook, invalidate };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.chain = null;
  mocks.writeContractAsync.mockReset().mockResolvedValue(HASH);
  mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({ status: "success" });
  mocks.toast.loading.mockReset().mockReturnValue(TOAST_ID);
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

interface WriteCase {
  readonly name: string;
  readonly invoke: (actions: MarketActions) => Promise<boolean>;
  readonly pending: MarketActions["pending"];
  readonly label: string;
  readonly address: `0x${string}`;
  readonly abi: Abi;
  readonly functionName: string;
  readonly args: readonly unknown[];
}

const WRITES: readonly WriteCase[] = [
  {
    name: "approve",
    invoke: (a) => a.approve(CST, 250n),
    pending: "approve",
    label: "Approving CST",
    address: CST,
    abi: erc20Abi,
    functionName: "approve",
    // The series is the spender.
    args: [SERIES, 250n],
  },
  {
    name: "bet YES",
    invoke: (a) => a.bet("yes", 100n, 95n),
    pending: "bet",
    label: "Betting YES",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "betYes",
    args: [ROUND, 100n, 95n, DEADLINE],
  },
  {
    name: "bet NO",
    invoke: (a) => a.bet("no", 100n, 95n),
    pending: "bet",
    label: "Betting NO",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "betNo",
    args: [ROUND, 100n, 95n, DEADLINE],
  },
  {
    name: "addLiquidity",
    invoke: (a) => a.addLiquidity(1_000n, 150, 6_000n, 990n),
    pending: "addLiquidity",
    label: "Adding liquidity",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "addLiquidity",
    args: [ROUND, 1_000n, 150, 6_000n, 990n, DEADLINE],
  },
  {
    name: "removeLiquidity",
    invoke: (a) => a.removeLiquidity(40n, 10n, 12n),
    pending: "removeLiquidity",
    label: "Removing liquidity",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "removeLiquidity",
    args: [ROUND, 40n, 10n, 12n, DEADLINE],
  },
  {
    name: "updateFeeDeclaration",
    invoke: (a) => a.updateFeeDeclaration(275),
    pending: "updateFee",
    label: "Updating fee vote",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "updateFeeDeclaration",
    args: [ROUND, 275],
  },
  {
    name: "claimFees",
    invoke: (a) => a.claimFees(),
    pending: "claimFees",
    label: "Claiming LP fees",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "claimFees",
    args: [ROUND],
  },
  {
    name: "mintSets",
    invoke: (a) => a.mintSets(7n),
    pending: "mint",
    label: "Minting sets",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "mintSets",
    args: [ROUND, 7n],
  },
  {
    name: "redeemSets",
    invoke: (a) => a.redeemSets(7n),
    pending: "redeem",
    label: "Redeeming sets",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "redeemSets",
    args: [ROUND, 7n],
  },
  {
    name: "resolve",
    invoke: (a) => a.resolve(),
    pending: "resolve",
    label: "Resolving round",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "resolve",
    args: [ROUND],
  },
  {
    name: "claim",
    invoke: (a) => a.claim(),
    pending: "claim",
    label: "Claiming winnings",
    address: SERIES,
    abi: gestureSeriesMarketAbi,
    functionName: "claim",
    args: [ROUND],
  },
];

describe("useMarketActions: what each action sends", () => {
  it.each(WRITES)("$name sends $functionName to the right contract with ABI-valid args", async (write) => {
    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await write.invoke(result.current);
    });

    expect(ok).toBe(true);
    expect(mocks.writeContractAsync).toHaveBeenCalledOnce();
    expect(mocks.writeContractAsync).toHaveBeenCalledWith({
      address: write.address,
      abi: write.abi,
      functionName: write.functionName,
      args: write.args,
    });
    // The request must encode against the real ABI — wrong arity or types throw.
    expect(() =>
      encodeFunctionData({ abi: write.abi, functionName: write.functionName, args: write.args } as Parameters<
        typeof encodeFunctionData
      >[0]),
    ).not.toThrow();
    expect(mocks.toast.loading).toHaveBeenCalledWith(`${write.label} — confirm in your wallet…`);
    expect(mocks.toast.success).toHaveBeenCalledWith(`${write.label} confirmed.`, expect.anything());
  });

  it.each(WRITES)("$name reports itself as pending while in flight", async (write) => {
    const signing = deferred<Hash>();
    mocks.writeContractAsync.mockReturnValueOnce(signing.promise);
    const { result } = renderActions();

    expect(result.current.pending).toBeNull();
    let outcome!: Promise<boolean>;
    act(() => {
      outcome = write.invoke(result.current);
    });
    expect(result.current.pending).toBe(write.pending);

    await act(async () => {
      signing.resolve(HASH);
      await outcome;
    });
    expect(result.current.pending).toBeNull();
  });
});

describe("useMarketActions: submit → confirm → refresh", () => {
  it("walks the toast from wallet prompt to confirmation, linking the explorer", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderActions();

    await act(() => result.current.claim());

    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mocks.wagmiConfig, { hash: HASH });
    const txUrl = `https://arbiscan.io/tx/${HASH}`;
    const waiting = mocks.toast.loading.mock.calls[1]!;
    expect(waiting[0]).toBe("Claiming winnings — waiting for confirmation…");
    expect(waiting[1]).toMatchObject({ id: TOAST_ID, action: { label: "View" } });
    const [message, options] = mocks.toast.success.mock.calls[0]!;
    expect(message).toBe("Claiming winnings confirmed.");
    expect(options).toMatchObject({ id: TOAST_ID, action: { label: "View" } });

    waiting[1].action.onClick();
    options.action.onClick();
    expect(open).toHaveBeenNthCalledWith(1, txUrl, "_blank");
    expect(open).toHaveBeenNthCalledWith(2, txUrl, "_blank");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("refreshes every cached read once the transaction settles", async () => {
    const { result, invalidate } = renderActions();

    await act(() => result.current.resolve());

    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith();
  });

  it("builds explorer links without a double slash", async () => {
    mocks.chain = { ...arbitrum, blockExplorers: { default: { name: "Scan", url: "https://scan.example/" } } };
    const { result } = renderActions();

    await act(() => result.current.claim());

    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mocks.toast.success.mock.calls[0]![1].action.onClick();
    expect(open).toHaveBeenCalledWith(`https://scan.example/tx/${HASH}`, "_blank");
  });

  it("omits the View action on chains without an explorer", async () => {
    mocks.chain = { ...arbitrum, blockExplorers: undefined };
    const { result } = renderActions();

    await act(() => result.current.claim());

    expect(mocks.toast.loading.mock.calls[1]![1]).toEqual({ id: TOAST_ID });
    expect(mocks.toast.success).toHaveBeenCalledWith("Claiming winnings confirmed.", { id: TOAST_ID });
  });
});

describe("useMarketActions: failures", () => {
  it("treats a wallet rejection as a cancel, not a failure to wait on", async () => {
    mocks.writeContractAsync.mockRejectedValueOnce(new UserRejectedRequestError(new Error("User rejected")));
    const { result, invalidate } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.bet("yes", 1n, 1n);
    });

    expect(ok).toBe(false);
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith("Transaction cancelled in your wallet.", { id: TOAST_ID });
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("reports a transaction that reverted on-chain", async () => {
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });
    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.bet("no", 1n, 1n);
    });

    expect(ok).toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledWith("Betting NO failed on-chain.", { id: TOAST_ID });
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it("explains errors raised while waiting for the receipt", async () => {
    mocks.waitForTransactionReceipt.mockRejectedValueOnce(new Error("Timed out while waiting for transaction"));
    const { result } = renderActions();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.mintSets(1n);
    });

    expect(ok).toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledWith("Timed out while waiting for transaction", { id: TOAST_ID });
  });

  it("refuses a second transaction while one is in flight", async () => {
    const signing = deferred<Hash>();
    mocks.writeContractAsync.mockReturnValueOnce(signing.promise);
    const { result } = renderActions();

    let first!: Promise<boolean>;
    act(() => {
      first = result.current.bet("yes", 1n, 1n);
    });
    let second: boolean | undefined;
    await act(async () => {
      second = await result.current.claim();
    });

    expect(second).toBe(false);
    expect(mocks.writeContractAsync).toHaveBeenCalledOnce();
    expect(result.current.pending).toBe("bet");

    await act(async () => {
      signing.resolve(HASH);
      expect(await first).toBe(true);
    });
    expect(result.current.pending).toBeNull();
  });

  it("accepts a new transaction once the previous one failed", async () => {
    mocks.writeContractAsync.mockRejectedValueOnce(new Error("nope"));
    const { result } = renderActions();

    await act(() => result.current.claim());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.claim();
    });

    expect(ok).toBe(true);
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(2);
  });
});
