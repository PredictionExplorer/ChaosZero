import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Log } from "viem";
import { gestureSeriesMarketAbi } from "@/lib/abi/gesture-series-market";
import type { PoolEvent } from "@/lib/history";
import { ONE } from "@/lib/math";
import { SERIES, USER } from "@/test/fixtures";
import { encodeLog } from "@/test/logs";
import { createTestQueryClient, withQueryClient } from "@/test/query";
import { totalVolume, useMarketEvents } from "./use-market-events";

/**
 * The hook's boundary is the viem public client (eth_getLogs / eth_getBlock)
 * and wagmi's event watcher; both are faked here, while react-query runs for
 * real so caching, loading and invalidation behave as in the app.
 */
const mocks = vi.hoisted(() => ({
  client: undefined as
    { getLogs: ReturnType<typeof vi.fn>; getBlock: ReturnType<typeof vi.fn> } | undefined,
  watch: vi.fn(),
  deployBlock: null as bigint | null,
}));

vi.mock("wagmi", () => ({
  usePublicClient: () => mocks.client,
  useWatchContractEvent: mocks.watch,
}));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    appConfig: {
      ...actual.appConfig,
      get deployBlock() {
        return mocks.deployBlock;
      },
    },
  };
});

const ROUND = 5n;
/** Block N was mined at this unix time + N. */
const GENESIS_TIME = 1_700_000_000;

function bet(blockNumber: bigint, logIndex: number, cstIn: bigint, roundId = ROUND): Log {
  return encodeLog(
    "Bet",
    { roundId, user: USER, yes: true, cstIn, netIn: (cstIn * 98n) / 100n, tokensOut: cstIn * 2n },
    blockNumber,
    logIndex,
  );
}

let chainLogs: Log[];

beforeEach(() => {
  mocks.deployBlock = null;
  chainLogs = [];
  mocks.client = {
    getLogs: vi.fn(async () => chainLogs),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      timestamp: BigInt(GENESIS_TIME) + blockNumber,
    })),
  };
  mocks.watch.mockReset();
});

function renderEvents(series: `0x${string}` | null = SERIES, roundId: bigint | null = ROUND) {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    ...renderHook(({ s, r }) => useMarketEvents(s, r), {
      wrapper: withQueryClient(queryClient),
      initialProps: { s: series, r: roundId },
    }),
  };
}

/** The `onLogs` callback the hook handed to the live event watcher. */
function emitNewLogs() {
  const options = mocks.watch.mock.lastCall?.[0] as { onLogs: (logs: Log[]) => void };
  act(() => options.onLogs([]));
}

describe("useMarketEvents: the history scan", () => {
  it("scans the series from genesis when no deploy block is configured", async () => {
    const { result } = renderEvents();

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.client!.getLogs).toHaveBeenCalledWith({
      address: SERIES,
      fromBlock: "earliest",
      toBlock: "latest",
    });
  });

  it("starts the scan at the market's deploy block when configured", async () => {
    mocks.deployBlock = 12_345n;
    const { result } = renderEvents();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.client!.getLogs).toHaveBeenCalledWith({
      address: SERIES,
      fromBlock: 12_345n,
      toBlock: "latest",
    });
  });

  it("lists this round's activity newest-first and keeps pool events in chain order", async () => {
    chainLogs = [
      bet(10n, 0, 1n * ONE),
      bet(11n, 2, 2n * ONE),
      bet(11n, 7, 3n * ONE),
      bet(11n, 9, 99n * ONE, ROUND + 1n), // another round: never shown
      bet(12n, 1, 4n * ONE),
    ];
    const { result } = renderEvents();

    await waitFor(() => expect(result.current.activity).toHaveLength(4));
    expect(result.current.activity.map((e) => [e.blockNumber, e.logIndex])).toEqual([
      [12n, 1],
      [11n, 7],
      [11n, 2],
      [10n, 0],
    ]);
    expect(result.current.poolEvents.map((e) => (e.kind === "bet" ? e.cstIn : null))).toEqual([
      1n * ONE,
      2n * ONE,
      3n * ONE,
      4n * ONE,
    ]);
    expect(result.current.error).toBeNull();
  });

  it("stamps activity and pool events with their block's time", async () => {
    chainLogs = [bet(10n, 0, ONE), bet(20n, 0, ONE)];
    const { result } = renderEvents();

    await waitFor(() => expect(result.current.activity).toHaveLength(2));
    expect(result.current.activity.map((e) => e.timestamp)).toEqual([
      GENESIS_TIME + 20,
      GENESIS_TIME + 10,
    ]);
    expect(result.current.poolEvents.map((e) => e.timestamp)).toEqual([
      GENESIS_TIME + 10,
      GENESIS_TIME + 20,
    ]);
  });

  it("fetches each block's time once, and only for the 30 newest blocks", async () => {
    // 35 blocks, two events in the newest one.
    chainLogs = Array.from({ length: 35 }, (_, i) => bet(BigInt(i + 1), 0, ONE));
    chainLogs.push(bet(35n, 1, ONE));
    const { result } = renderEvents();

    await waitFor(() => expect(result.current.activity).toHaveLength(36));
    const fetched = mocks.client!.getBlock.mock.calls.map(
      ([args]) => (args as { blockNumber: bigint }).blockNumber,
    );
    expect(fetched).toHaveLength(30);
    expect(new Set(fetched)).toEqual(new Set(Array.from({ length: 30 }, (_, i) => BigInt(35 - i))));

    const stampOf = (block: bigint) =>
      result.current.activity.find((e) => e.blockNumber === block)?.timestamp;
    expect(stampOf(35n)).toBe(GENESIS_TIME + 35);
    expect(stampOf(6n)).toBe(GENESIS_TIME + 6);
    expect(stampOf(5n)).toBeNull();
    expect(stampOf(1n)).toBeNull();
  });

  it("shows the feed even when a block's timestamp cannot be fetched", async () => {
    chainLogs = [bet(10n, 0, ONE), bet(11n, 0, ONE)];
    mocks.client!.getBlock.mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => {
      if (blockNumber === 11n) throw new Error("block not found");
      return { timestamp: BigInt(GENESIS_TIME) + blockNumber };
    });
    const { result } = renderEvents();

    await waitFor(() => expect(result.current.activity).toHaveLength(2));
    expect(result.current.activity.map((e) => e.timestamp)).toEqual([null, GENESIS_TIME + 10]);
    expect(result.current.error).toBeNull();
  });

  it("reports a failed scan as an error with an empty feed", async () => {
    mocks.client!.getLogs.mockRejectedValue(new Error("query returned more than 10000 results"));
    const { result } = renderEvents();

    await waitFor(() =>
      expect(result.current.error?.message).toBe("query returned more than 10000 results"),
    );
    expect(result.current).toMatchObject({ activity: [], poolEvents: [], isLoading: false });
  });

  it.each([
    ["no series", null, ROUND],
    ["no round", SERIES, null],
  ] as const)("stays idle with %s", async (_label, series, roundId) => {
    const { result } = renderEvents(series, roundId);

    await act(async () => {});
    expect(result.current).toMatchObject({
      activity: [],
      poolEvents: [],
      isLoading: false,
      error: null,
    });
    expect(mocks.client!.getLogs).not.toHaveBeenCalled();
  });

  it("stays idle until wagmi provides a public client", async () => {
    mocks.client = undefined;
    const { result } = renderEvents();

    await act(async () => {});
    expect(result.current).toMatchObject({ activity: [], isLoading: false, error: null });
  });

  it("caches the scan so remounts within 30s cost no RPC calls", async () => {
    const { queryClient, result, unmount } = renderEvents();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    unmount();

    renderHook(() => useMarketEvents(SERIES, ROUND), { wrapper: withQueryClient(queryClient) });
    await act(async () => {});
    expect(mocks.client!.getLogs).toHaveBeenCalledOnce();
  });

  it("rescans when the followed round changes", async () => {
    chainLogs = [bet(10n, 0, ONE, 5n), bet(11n, 0, 2n * ONE, 6n)];
    const { result, rerender } = renderEvents();
    await waitFor(() => expect(result.current.activity).toHaveLength(1));
    expect(result.current.activity[0]!.amount).toBe(ONE);

    rerender({ s: SERIES, r: 6n });

    await waitFor(() => expect(result.current.activity[0]?.amount).toBe(2n * ONE));
    expect(mocks.client!.getLogs).toHaveBeenCalledTimes(2);
  });
});

describe("useMarketEvents: live updates", () => {
  it("watches the series contract by polling every 8 seconds", () => {
    renderEvents();

    expect(mocks.watch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: SERIES,
        abi: gestureSeriesMarketAbi,
        enabled: true,
        poll: true,
        pollingInterval: 8_000,
      }),
    );
  });

  it("does not watch anything without a series", () => {
    renderEvents(null, null);

    expect(mocks.watch).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: undefined, enabled: false }),
    );
  });

  it("rescans when a new series event lands, so the feed updates", async () => {
    chainLogs = [bet(10n, 0, ONE)];
    const { result } = renderEvents();
    await waitFor(() => expect(result.current.activity).toHaveLength(1));

    chainLogs = [...chainLogs, bet(11n, 0, 5n * ONE)];
    emitNewLogs();

    await waitFor(() => expect(result.current.activity).toHaveLength(2));
    expect(result.current.activity[0]).toMatchObject({ blockNumber: 11n, amount: 5n * ONE });
  });

  it("refreshes every consumer of the series together", async () => {
    const queryClient = createTestQueryClient();
    const wrapper = withQueryClient(queryClient);
    const round5 = renderHook(() => useMarketEvents(SERIES, 5n), { wrapper });
    const round6 = renderHook(() => useMarketEvents(SERIES, 6n), { wrapper });
    await waitFor(() =>
      expect(round5.result.current.isLoading || round6.result.current.isLoading).toBe(false),
    );
    expect(mocks.client!.getLogs).toHaveBeenCalledTimes(2);

    emitNewLogs();

    await waitFor(() => expect(mocks.client!.getLogs).toHaveBeenCalledTimes(4));
  });
});

describe("totalVolume", () => {
  const base = { blockNumber: 1n, logIndex: 0, transactionHash: "0x" as const, timestamp: null };

  it("sums the CST wagered through bets and ignores liquidity moves", () => {
    const events: PoolEvent[] = [
      { ...base, kind: "bet", user: USER, side: "yes", cstIn: 3n * ONE, netIn: 0n, tokensOut: 0n },
      {
        ...base,
        kind: "add",
        provider: USER,
        cstIn: 500n * ONE,
        declaredFeeBps: 100,
        sharesOut: 0n,
        yesToPool: 0n,
        noToPool: 0n,
      },
      { ...base, kind: "bet", user: USER, side: "no", cstIn: 4n * ONE, netIn: 0n, tokensOut: 0n },
      {
        ...base,
        kind: "remove",
        provider: USER,
        sharesIn: 1n,
        yesOut: 9n * ONE,
        noOut: 9n * ONE,
        feesOut: 0n,
      },
    ];
    expect(totalVolume(events)).toBe(7n * ONE);
  });

  it("is zero for a round without bets", () => {
    expect(totalVolume([])).toBe(0n);
  });
});
