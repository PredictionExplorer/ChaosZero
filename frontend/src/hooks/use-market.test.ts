import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { isAddressEqual } from "viem";
import { cosmicGameAbi } from "@/lib/abi/cosmic-game";
import { erc20Abi } from "@/lib/abi/erc20";
import { gestureSeriesMarketAbi } from "@/lib/abi/gesture-series-market";
import { appConfig } from "@/lib/config";
import type { PoolTuple, RoundStateTuple } from "@/lib/market";
import { ONE } from "@/lib/math";
import { createFakeChain, type FakeChain } from "@/test/fake-chain";
import { CST, GAME, SERIES, USER } from "@/test/fixtures";
import { createTestWagmi } from "@/test/wagmi";
import { useCurrentGameRound, useMarket, useRoundSnapshot, useSeriesStatics, useUserSnapshot } from "./use-market";

/** What the fake chain holds; tests mutate it to simulate new blocks. */
interface World {
  gameRound: bigint;
  /** Gestures per game round (`bidderAddresses(round)`). */
  counts: Map<bigint, bigint>;
  roundStates: Map<bigint, RoundStateTuple>;
  pools: Map<bigint, PoolTuple>;
  balances: Map<bigint, readonly [bigint, bigint]>;
  lpPositions: Map<bigint, readonly [bigint, bigint, number]>;
  cstBalance: bigint;
  allowance: bigint;
  /** Makes the next N series reads revert (a flaky node). */
  failSeriesReads: number;
}

const L = 1_000n * ONE;

function liveState(threshold: bigint, count: bigint): RoundStateTuple {
  return [true, true, false, false, threshold, count, true, false];
}

function newWorld(): World {
  return {
    gameRound: 5n,
    counts: new Map([
      [0n, 120n],
      [2n, 610n],
      [3n, 640n],
      [4n, 800n],
      [5n, 500n],
    ]),
    roundStates: new Map([
      [0n, [true, false, false, false, 0n, 120n, true, false] as RoundStateTuple],
      [3n, [true, true, true, true, 600n, 640n, false, true] as RoundStateTuple],
      [5n, liveState(800n, 500n)],
    ]),
    pools: new Map([
      [0n, [L, L, L, 0n, 0n, L * 100n, 100n] as PoolTuple],
      [3n, [2n * L, L / 2n, L, 7n, 3n, L * 50n, 50n] as PoolTuple],
      [5n, [L, 3n * L, 2n * L, 11n, 13n, L * 200n, 200n] as PoolTuple],
    ]),
    balances: new Map([[5n, [100n * ONE, 40n * ONE] as const]]),
    lpPositions: new Map([[5n, [25n * ONE, 2n * ONE, 150] as const]]),
    cstBalance: 1_234n * ONE,
    allowance: 77n * ONE,
    failSeriesReads: 0,
  };
}

const EMPTY_POOL: PoolTuple = [0n, 0n, 0n, 0n, 0n, 0n, 0n];
const UNINITIALIZED: RoundStateTuple = [false, false, false, false, 0n, 0n, false, false];

function deployWorld(chain: FakeChain, world: World) {
  chain.deploy(SERIES, gestureSeriesMarketAbi, (fn, args) => {
    if (world.failSeriesReads > 0) {
      world.failSeriesReads--;
      throw new Error("execution reverted: node hiccup");
    }
    const round = args[0] as bigint;
    switch (fn) {
      case "cst":
        return CST;
      case "game":
        return GAME;
      case "roundState":
        return world.roundStates.get(round) ?? UNINITIALIZED;
      case "pool":
        return world.pools.get(round) ?? EMPTY_POOL;
      case "balancesOf":
        return isAddressEqual(args[1] as Address, USER) ? (world.balances.get(round) ?? [0n, 0n]) : [0n, 0n];
      case "lpPositionOf":
        return isAddressEqual(args[1] as Address, USER) ? (world.lpPositions.get(round) ?? [0n, 0n, 0]) : [0n, 0n, 0];
      default:
        throw new Error(`unexpected series read ${fn}`);
    }
  });
  chain.deploy(GAME, cosmicGameAbi, (fn, args) => {
    if (fn === "roundNum") return world.gameRound;
    if (fn === "bidderAddresses") return world.counts.get(args[0] as bigint) ?? 0n;
    throw new Error(`unexpected game read ${fn}`);
  });
  chain.deploy(CST, erc20Abi, (fn, args) => {
    if (fn === "balanceOf") return isAddressEqual(args[0] as Address, USER) ? world.cstBalance : 0n;
    if (fn === "allowance") {
      const [owner, spender] = args as [Address, Address];
      return isAddressEqual(owner, USER) && isAddressEqual(spender, SERIES) ? world.allowance : 0n;
    }
    throw new Error(`unexpected CST read ${fn}`);
  });
}

let world: World;
let chain: FakeChain;
let harness: ReturnType<typeof createTestWagmi>;

beforeEach(() => {
  world = newWorld();
  chain = createFakeChain(appConfig.chain);
  deployWorld(chain, world);
  harness = createTestWagmi({ transport: chain.transport, account: USER });
});

afterEach(() => {
  harness.queryClient.clear();
});

const STATICS = { cstAddress: CST, gameAddress: GAME } as const;

describe("useSeriesStatics", () => {
  it("reads the series' CST token and game from the contract", async () => {
    const { result } = renderHook(() => useSeriesStatics(SERIES), { wrapper: harness.wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.statics).toEqual(STATICS));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("stays idle, making no RPC calls, until a series is known", async () => {
    const { result } = renderHook(() => useSeriesStatics(null), { wrapper: harness.wrapper });

    await act(async () => {});
    expect(result.current).toMatchObject({ statics: null, isLoading: false, error: null });
    expect(chain.reads).toHaveLength(0);
  });

  it("rides out a flaky node: the immutable config is retried before giving up", async () => {
    world.failSeriesReads = 2;
    const { result } = renderHook(() => useSeriesStatics(SERIES), { wrapper: harness.wrapper });

    await waitFor(() => expect(result.current.statics).toEqual(STATICS));
    expect(result.current.error).toBeNull();
  });

  it("reports an error when the address is not a series contract", async () => {
    const stranger: Address = "0x9999999999999999999999999999999999999999";
    const { result } = renderHook(() => useSeriesStatics(stranger), { wrapper: harness.wrapper });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.statics).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("caches the statics: a second consumer does not re-read them", async () => {
    const first = renderHook(() => useSeriesStatics(SERIES), { wrapper: harness.wrapper });
    await waitFor(() => expect(first.result.current.statics).not.toBeNull());
    const readsAfterFirst = chain.readCount("cst");

    const second = renderHook(() => useSeriesStatics(SERIES), { wrapper: harness.wrapper });
    expect(second.result.current.statics).toEqual(STATICS);
    await act(async () => {});
    expect(chain.readCount("cst")).toBe(readsAfterFirst);
  });
});

describe("useCurrentGameRound", () => {
  it("reads the live round counter from the game the series points at", async () => {
    const { result } = renderHook(() => useCurrentGameRound(STATICS), { wrapper: harness.wrapper });

    await waitFor(() => expect(result.current.data).toBe(5n));
    expect(chain.reads.find((read) => read.functionName === "roundNum")?.address).toBe(GAME);
  });

  it("waits for the statics before asking the game anything", async () => {
    const { result } = renderHook(() => useCurrentGameRound(null), { wrapper: harness.wrapper });

    await act(async () => {});
    expect(result.current.data).toBeUndefined();
    expect(chain.reads).toHaveLength(0);
  });
});

describe("useRoundSnapshot", () => {
  it("assembles one round's lifecycle, pool, game round and forming threshold", async () => {
    const { result } = renderHook(() => useRoundSnapshot(SERIES, STATICS, 5n), { wrapper: harness.wrapper });

    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.snapshot).toEqual({
      seriesAddress: SERIES,
      roundId: 5n,
      initialized: true,
      thresholdKnown: true,
      resolved: false,
      yesWon: false,
      threshold: 800n,
      currentCount: 500n,
      gameRoundNum: 5n,
      // The previous round's live count (round 4 → 800 gestures).
      prevRoundCount: 800n,
      pool: {
        reserveYes: L,
        reserveNo: 3n * L,
        totalShares: 2n * L,
        accFeePerShare: 11n,
        feeReserve: 13n,
        feeWeight: L * 200n,
      },
      cstAddress: CST,
      gameAddress: GAME,
    });
    expect(result.current.error).toBeNull();
  });

  it("reads round 0's own count as its forming threshold (there is no round -1)", async () => {
    const { result } = renderHook(() => useRoundSnapshot(SERIES, STATICS, 0n), { wrapper: harness.wrapper });

    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.snapshot?.prevRoundCount).toBe(120n);
    const countReads = chain.reads.filter((read) => read.functionName === "bidderAddresses");
    expect(countReads.map((read) => read.args)).toEqual([[0n]]);
  });

  it.each([
    ["no series", null, STATICS, 5n],
    ["no statics", SERIES, null, 5n],
    ["no round", SERIES, STATICS, null],
  ] as const)("stays idle with %s", async (_label, series, statics, roundId) => {
    const { result } = renderHook(() => useRoundSnapshot(series, statics, roundId), { wrapper: harness.wrapper });

    await act(async () => {});
    expect(result.current.snapshot).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(chain.reads).toHaveLength(0);
  });
});

describe("useUserSnapshot", () => {
  it("has no user and reads nothing while no wallet is connected", async () => {
    const { result } = renderHook(() => useUserSnapshot(SERIES, STATICS, 5n), { wrapper: harness.wrapper });

    await act(async () => {});
    expect(result.current.user).toBeNull();
    expect(chain.reads).toHaveLength(0);
  });

  it("reads the connected wallet's tokens, LP position, CST balance and allowance", async () => {
    const { result } = renderHook(() => useUserSnapshot(SERIES, STATICS, 5n), { wrapper: harness.wrapper });

    await act(() => harness.connectWallet());
    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.user).toEqual({
      address: USER,
      yesBalance: 100n * ONE,
      noBalance: 40n * ONE,
      cstBalance: 1_234n * ONE,
      cstAllowance: 77n * ONE,
      lpShares: 25n * ONE,
      lpPendingFees: 2n * ONE,
      lpDeclaredFeeBps: 150,
    });
    // The allowance that matters is the one granted to the series itself.
    const allowanceRead = chain.reads.find((read) => read.functionName === "allowance");
    expect(allowanceRead).toMatchObject({ address: CST, args: [USER, SERIES] });
  });
});

describe("useMarket", () => {
  it("follows the game's live round by default", async () => {
    const { result } = renderHook(() => useMarket(SERIES, null), { wrapper: harness.wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({
      statics: STATICS,
      roundId: 5n,
      currentRound: 5n,
      user: null,
      error: null,
    });
    expect(result.current.snapshot).toMatchObject({ roundId: 5n, currentCount: 500n, threshold: 800n });
  });

  it("pins a past round when overridden, while still tracking the live one", async () => {
    const { result } = renderHook(() => useMarket(SERIES, 3n), { wrapper: harness.wrapper });

    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    expect(result.current.roundId).toBe(3n);
    expect(result.current.snapshot).toMatchObject({ roundId: 3n, resolved: true, yesWon: true, prevRoundCount: 610n });
    await waitFor(() => expect(result.current.currentRound).toBe(5n));
  });

  it("includes the connected user's stake in the followed round", async () => {
    const { result } = renderHook(() => useMarket(SERIES, null), { wrapper: harness.wrapper });
    await act(() => harness.connectWallet());

    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.user).toMatchObject({ address: USER, yesBalance: 100n * ONE, lpShares: 25n * ONE });
  });

  it("surfaces the first failure as the market error", async () => {
    const stranger: Address = "0x9999999999999999999999999999999999999999";
    const { result } = renderHook(() => useMarket(stranger, null), { wrapper: harness.wrapper });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current).toMatchObject({ statics: null, snapshot: null, roundId: null, isLoading: false });
  });

  it("refetchAll re-reads the chain: statics, round, snapshot and user", async () => {
    const { result } = renderHook(() => useMarket(SERIES, null), { wrapper: harness.wrapper });
    await act(() => harness.connectWallet());
    await waitFor(() => expect(result.current.user).not.toBeNull());

    // A new block: more gestures, the user bought CST.
    world.roundStates.set(5n, liveState(800n, 650n));
    world.cstBalance = 2_000n * ONE;
    const staticReads = chain.readCount("cst");

    act(() => result.current.refetchAll());

    await waitFor(() => expect(result.current.snapshot?.currentCount).toBe(650n));
    await waitFor(() => expect(result.current.user?.cstBalance).toBe(2_000n * ONE));
    expect(chain.readCount("cst")).toBeGreaterThan(staticReads);
  });
});

describe("live polling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the round every 8 seconds without any user action", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useMarket(SERIES, null), { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.snapshot?.currentCount).toBe(500n));

    world.roundStates.set(5n, liveState(800n, 720n));
    // Well inside the 8s interval (the clock also ticks in real time, so the
    // margin absorbs a slow machine): no refresh yet.
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.snapshot?.currentCount).toBe(500n);

    await act(() => vi.advanceTimersByTimeAsync(3_500));
    await waitFor(() => expect(result.current.snapshot?.currentCount).toBe(720n));
  });

  it("moves to the next round when the game advances", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    world.roundStates.set(6n, liveState(500n, 10n));
    world.counts.set(6n, 10n);
    const { result } = renderHook(() => useMarket(SERIES, null), { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.roundId).toBe(5n));

    world.gameRound = 6n;
    await act(() => vi.advanceTimersByTimeAsync(8_500));

    await waitFor(() => expect(result.current.roundId).toBe(6n));
    await waitFor(() => expect(result.current.snapshot).toMatchObject({ roundId: 6n, currentCount: 10n }));
  });
});
