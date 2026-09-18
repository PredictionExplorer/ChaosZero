import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { roundPhase } from "@/lib/market";
import {
  useCurrentGameRound,
  useMarket,
  useRoundSnapshot,
  useSeriesStatics,
  useUserSnapshot,
  type SeriesStatics,
} from "./use-market";

const boundary = vi.hoisted(() => ({ connection: vi.fn(), read: vi.fn(), reads: vi.fn() }));
vi.mock("wagmi", () => ({
  useConnection: boundary.connection,
  useReadContract: boundary.read,
  useReadContracts: boundary.reads,
}));

const SERIES = "0x1111111111111111111111111111111111111111" as const;
const CST = "0x2222222222222222222222222222222222222222" as const;
const GAME = "0x3333333333333333333333333333333333333333" as const;
const USER = "0x4444444444444444444444444444444444444444" as const;
const STATICS: SeriesStatics = { cstAddress: CST, gameAddress: GAME };
const BIG = (1n << 150n) + 3n;

interface QueryResult {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
}
interface ReadRequest {
  contracts: { address?: Address; functionName: string; args?: readonly unknown[] }[];
  allowFailure: boolean;
  query: { enabled: boolean; refetchInterval?: number; staleTime?: number; gcTime?: number };
}
let queries: Record<"statics" | "current" | "round" | "user" | "idle", QueryResult>;

function query(data: unknown): QueryResult {
  return { data, isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined) };
}

function roundData(gameRound = 7n, thresholdKnown = true) {
  return [
    [true, thresholdKnown, false, false, 800n, 640n, true, false],
    [BIG, BIG + 1n, BIG + 2n, BIG + 3n, BIG + 4n, BIG + 5n, 175n],
    gameRound,
    790n,
  ];
}

beforeEach(() => {
  vi.resetAllMocks();
  queries = {
    statics: query([CST, GAME]),
    current: query(7n),
    round: query(roundData()),
    user: query([[BIG, BIG + 1n], [BIG + 2n, BIG + 3n, 225n], BIG + 4n, BIG + 5n]),
    idle: query(undefined),
  };
  boundary.connection.mockReturnValue({ address: USER });
  boundary.read.mockImplementation(() => queries.current);
  boundary.reads.mockImplementation((request: ReadRequest) => {
    const first = request.contracts[0]?.functionName;
    return first === "cst"
      ? queries.statics
      : first === "roundState"
        ? queries.round
        : first === "balancesOf"
          ? queries.user
          : queries.idle;
  });
});

afterEach(cleanup);

describe("legacy market read boundaries", () => {
  it("loads both immutable references atomically and exposes refetch/errors", () => {
    const { result } = renderHook(() => useSeriesStatics(SERIES));
    expect(result.current.statics).toEqual(STATICS);
    const request = boundary.reads.mock.calls[0][0] as ReadRequest;
    expect(request.allowFailure).toBe(false);
    expect(
      request.contracts.map(({ address, functionName }) => ({ address, functionName })),
    ).toEqual([
      { address: SERIES, functionName: "cst" },
      { address: SERIES, functionName: "game" },
    ]);
    expect(request.query).toMatchObject({ enabled: true, staleTime: Infinity, gcTime: Infinity });
    expect(result.current.refetch).toBe(queries.statics.refetch);
  });

  it("does not start immutable/game reads before their prerequisites exist", () => {
    queries.statics = query(undefined);
    const statics = renderHook(() => useSeriesStatics(null));
    expect(statics.result.current.statics).toBeNull();
    expect(boundary.reads.mock.calls[0][0].query.enabled).toBe(false);
    renderHook(() => useCurrentGameRound(null));
    expect(boundary.read.mock.calls[0][0]).toMatchObject({
      address: undefined,
      functionName: "roundNum",
      query: { enabled: false },
    });
  });

  it("polls the authoritative game counter after the game is known", () => {
    const { result } = renderHook(() => useCurrentGameRound(STATICS));
    expect(result.current.data).toBe(7n);
    expect(boundary.read.mock.calls[0][0]).toMatchObject({
      address: GAME,
      functionName: "roundNum",
      query: { enabled: true, refetchInterval: 8000 },
    });
  });

  it("decodes the actual batched ABI tuple without losing integer precision", () => {
    const { result } = renderHook(() => useRoundSnapshot(SERIES, STATICS, 7n));
    expect(result.current.snapshot).toEqual({
      seriesAddress: SERIES,
      cstAddress: CST,
      gameAddress: GAME,
      roundId: 7n,
      initialized: true,
      thresholdKnown: true,
      resolved: false,
      yesWon: false,
      threshold: 800n,
      currentCount: 640n,
      gameRoundNum: 7n,
      prevRoundCount: 790n,
      pool: {
        reserveYes: BIG,
        reserveNo: BIG + 1n,
        totalShares: BIG + 2n,
        accFeePerShare: BIG + 3n,
        feeReserve: BIG + 4n,
        feeWeight: BIG + 5n,
      },
    });
    const request = boundary.reads.mock.calls[0][0] as ReadRequest;
    expect(request.allowFailure).toBe(false);
    expect(
      request.contracts.map(({ address, functionName, args }) => ({ address, functionName, args })),
    ).toEqual([
      { address: SERIES, functionName: "roundState", args: [7n] },
      { address: SERIES, functionName: "pool", args: [7n] },
      { address: GAME, functionName: "roundNum", args: undefined },
      { address: GAME, functionName: "bidderAddresses", args: [6n] },
    ]);
  });

  it.each([
    { series: null, statics: STATICS, round: 7n },
    { series: SERIES, statics: null, round: 7n },
    { series: SERIES, statics: STATICS, round: null },
  ])(
    "disables an incomplete round request without exposing stale data",
    ({ series, statics, round }) => {
      const { result } = renderHook(() => useRoundSnapshot(series, statics, round));
      expect(result.current.snapshot).toBeNull();
      expect(boundary.reads.mock.calls[0][0].query.enabled).toBe(false);
      if (round === null) expect(boundary.reads.mock.calls[0][0].contracts).toEqual([]);
    },
  );

  it("never underflows the previous-round argument for round zero", () => {
    renderHook(() => useRoundSnapshot(SERIES, STATICS, 0n));
    expect(boundary.reads.mock.calls[0][0].contracts[3].args).toEqual([0n]);
  });

  it("reads the connected user's outcome balances, fee vote, liquidity, cash and allowance", () => {
    const { result } = renderHook(() => useUserSnapshot(SERIES, STATICS, 7n));
    expect(result.current.user).toEqual({
      address: USER,
      yesBalance: BIG,
      noBalance: BIG + 1n,
      lpShares: BIG + 2n,
      lpPendingFees: BIG + 3n,
      lpDeclaredFeeBps: 225,
      cstBalance: BIG + 4n,
      cstAllowance: BIG + 5n,
    });
    const request = boundary.reads.mock.calls[0][0] as ReadRequest;
    expect(request.allowFailure).toBe(false);
    expect(
      request.contracts.map(({ address, functionName, args }) => ({ address, functionName, args })),
    ).toEqual([
      { address: SERIES, functionName: "balancesOf", args: [7n, USER] },
      { address: SERIES, functionName: "lpPositionOf", args: [7n, USER] },
      { address: CST, functionName: "balanceOf", args: [USER] },
      { address: CST, functionName: "allowance", args: [USER, SERIES] },
    ]);
  });

  it("clears positions when disconnected, even if an old wallet read was cached", () => {
    const { result, rerender } = renderHook(() => useUserSnapshot(SERIES, STATICS, 7n));
    expect(result.current.user?.address).toBe(USER);
    boundary.connection.mockReturnValue({ address: undefined });
    rerender();
    expect(result.current.user).toBeNull();
    expect(boundary.reads.mock.lastCall?.[0]).toMatchObject({
      contracts: [],
      query: { enabled: false },
    });
  });

  it.each([
    { series: null, statics: STATICS, round: 7n },
    { series: SERIES, statics: null, round: 7n },
    { series: SERIES, statics: STATICS, round: null },
  ])("does not reuse balances for an unloaded market or round", ({ series, statics, round }) => {
    const { result } = renderHook(() => useUserSnapshot(series, statics, round));
    expect(result.current.user).toBeNull();
    expect(boundary.reads.mock.calls[0][0].query.enabled).toBe(false);
  });
});

describe("assembled legacy market state", () => {
  it.each([
    { override: null, expected: 7n, phase: "live" },
    { override: 8n, expected: 8n, phase: "future" },
    { override: 2n, expected: 2n, phase: "ended" },
  ])("selects $phase cycles without mixing their reads", ({ override, expected, phase }) => {
    queries.round.data = roundData(7n, phase !== "future");
    const { result } = renderHook(() => useMarket(SERIES, override));
    expect(result.current.roundId).toBe(expected);
    expect(result.current.currentRound).toBe(7n);
    expect(roundPhase(result.current.snapshot!)).toBe(phase);
    const requests = boundary.reads.mock.calls.map(([request]) => request as ReadRequest);
    for (const request of requests.filter((r) =>
      ["roundState", "balancesOf"].includes(r.contracts[0]?.functionName),
    )) {
      expect(request.contracts[0].args?.[0]).toBe(expected);
    }
  });

  it("follows cycle advancement while preserving an explicit historical selection", () => {
    const { result, rerender } = renderHook(({ override }) => useMarket(SERIES, override), {
      initialProps: { override: null as bigint | null },
    });
    expect(result.current.roundId).toBe(7n);
    queries.current.data = 8n;
    queries.round.data = roundData(8n);
    rerender({ override: null });
    expect(result.current.roundId).toBe(8n);
    rerender({ override: 2n });
    queries.current.data = 9n;
    queries.round.data = roundData(9n);
    rerender({ override: 2n });
    expect(result.current.roundId).toBe(2n);
    expect(result.current.currentRound).toBe(9n);
  });

  it("waits for the game counter when no round override exists", () => {
    queries.current = query(undefined);
    queries.current.isLoading = true;
    const { result } = renderHook(() => useMarket(SERIES, null));
    expect(result.current.roundId).toBeNull();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(boundary.reads.mock.calls.slice(1).every(([request]) => !request.query.enabled)).toBe(
      true,
    );
  });

  it.each(["statics", "current", "round", "user"] as const)(
    "surfaces %s RPC failure even when data remains cached",
    (source) => {
      const error = new Error(`${source} RPC unavailable`);
      queries[source].error = error;
      const { result } = renderHook(() => useMarket(SERIES, null));
      expect(result.current.error).toBe(error);
    },
  );

  it.each(["statics", "current", "round", "user"] as const)(
    "includes %s loading in the assembled state",
    (source) => {
      queries[source].isLoading = true;
      const { result } = renderHook(() => useMarket(SERIES, null));
      expect(result.current.isLoading).toBe(true);
    },
  );

  it("refreshes all four reads together after a transaction or retry", () => {
    const { result } = renderHook(() => useMarket(SERIES, 3n));
    act(() => {
      result.current.refetchAll();
    });
    for (const name of ["statics", "current", "round", "user"] as const) {
      expect(queries[name].refetch).toHaveBeenCalledTimes(1);
    }
  });
});
