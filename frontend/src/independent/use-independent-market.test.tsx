import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  useIndependentFundingPreview,
  useIndependentMarket,
  useIndependentRecovery,
} from "./use-independent-market";
import { ACCOUNT, GAME, MARKET, SOURCE, TOKEN, VAULT, snapshot, zero } from "./test-fixtures";
import { ONE } from "@/shared/math";

const mocks = vi.hoisted(() => ({
  available: true,
  account: "0x1111111111111111111111111111111111111111" as `0x${string}` | undefined,
  config: { chain: { id: 31337 } },
  getBlock: vi.fn(),
  getChainId: vi.fn(),
  read: vi.fn(),
}));
vi.mock("wagmi", () => ({
  usePublicClient: () =>
    mocks.available
      ? { getBlock: mocks.getBlock, getChainId: mocks.getChainId, readContract: mocks.read }
      : undefined,
  useConnection: () => ({ address: mocks.account }),
}));
vi.mock("@/lib/config", () => ({ appConfig: mocks.config }));
const clients: QueryClient[] = [];
function wrapper() {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(query);
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={query}>{children}</QueryClientProvider>;
  };
}
let data: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.available = true;
  mocks.account = ACCOUNT;
  mocks.config.chain.id = 31337;
  mocks.getBlock.mockResolvedValue({ number: 123n, timestamp: 500n });
  mocks.getChainId.mockResolvedValue(31337);
  const state = snapshot();
  data = {
    cst: TOKEN,
    source: SOURCE,
    settlementVault: VAULT,
    totalActiveCollateral: state.poolCustody,
    pendingCarry: 77n,
    game: GAME,
    decimals: 18,
    totalEscrowed: 55n,
    roundNum: 2n,
    roundState: {
      initialized: true,
      funded: true,
      settled: false,
      closed: false,
      finalized: false,
      knownMask: 1,
      values: 1,
      startedAt: 0n,
      finalizedAt: 0n,
      activeCollateral: state.poolCustody,
    },
    questionStates: state.questions.map((q) => ({
      activeCollateral: q.pool.collateral,
      yesSupply: q.pool.yes,
      noSupply: q.pool.no,
      escrowRemaining: 0n,
      initialYesBps: 5000,
      currentYesBps: 5000,
      checkpointCount: 1n,
      seedUsedHistory: false,
    })),
    outcomeState: [true, false, 9, 9],
    seedPreview: [
      [4200, 5100, 5200, 5300, 5400, 5500, 5600, 5700],
      [true, true, true, true, true, true, true, true],
    ],
    fundingPreview: { ...state.funding!, availableCarry: 88n, unallocated: 5n * ONE },
    balancesOf: [state.user!.yes, zero()],
    balanceOf: 1000n,
    marketBalance: state.poolCustody + 77n + 5n * ONE,
    allowance: 99n,
    getNextEthPrice: 100n,
    getNextCstPrice: 200n,
    mainPrizeTime: 999n,
    roundStats: state.local!.current,
  };
  mocks.read.mockImplementation(
    async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "balanceOf" && args?.[0] === MARKET) return data.marketBalance;
      if (!(functionName in data)) throw new Error(`Unexpected ${functionName}`);
      return data[functionName];
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  for (const q of clients.splice(0)) q.clear();
});

describe("independent block-pinned reads", () => {
  it("assembles eight pools, tracked custody, escrow and observed facts at one block", async () => {
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      roundId: 2n,
      currentRound: 2n,
      market: MARKET,
      token: TOKEN,
      source: SOURCE,
      vault: VAULT,
      game: GAME,
      poolCustody: snapshot().poolCustody,
      claimEscrow: 55n,
      pendingCarry: 77n,
      availableCarry: 88n,
      open: true,
      finalized: false,
      settled: false,
      observedMask: 9,
      observedValues: 9,
    });
    expect(result.current.data!.questions).toHaveLength(8);
    expect(result.current.data!.user).toMatchObject({
      owner: ACCOUNT,
      balance: 1000n,
      allowance: 99n,
    });
    for (const [request] of mocks.read.mock.calls) expect(request.blockNumber).toBe(123n);
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ address: VAULT, functionName: "totalEscrowed" }),
    );
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "totalActiveCollateral" }),
    );
  });
  it("uses equal opening odds without a prior-cycle read for uninitialized questions", async () => {
    data.roundState = {
      ...(data.roundState as object),
      initialized: false,
      funded: false,
      knownMask: 0,
      values: 0,
    };
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, 1n) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.questions[0].pool.initialYesBps).toBe(5000);
    expect(mocks.read).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "seedPreview" }),
    );
  });
  it("uses cached settled results without an outcome/funding/seed source read", async () => {
    data.roundState = {
      ...(data.roundState as object),
      settled: true,
      closed: true,
      finalized: true,
      knownMask: 255,
      values: 129,
    };
    data.questionStates = (data.questionStates as { activeCollateral: bigint }[]).map((q) => ({
      ...q,
      activeCollateral: 0n,
    }));
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, 1n) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      finalized: true,
      settled: true,
      open: false,
      values: 129,
    });
    expect(result.current.data!.questions.every((q) => q.pool.collateral === 0n)).toBe(true);
    expect(
      mocks.read.mock.calls.some(([r]) =>
        ["outcomeState", "fundingPreview", "seedPreview"].includes(r.functionName),
      ),
    ).toBe(false);
  });
  it("shows verified full closure as claimable while physical settlement is still pending", async () => {
    data.outcomeState = [false, true, 255, 3];
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, 1n) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ finalized: true, settled: false, values: 3 });
    expect(result.current.data!.funding).toBeNull();
  });
  it("does not invent wallet balances or a negative prior cycle", async () => {
    mocks.account = undefined;
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, 0n) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.user).toBeNull();
    expect(result.current.data!.local!.previous).toBeNull();
    expect(
      mocks.read.mock.calls.some(
        ([r]) =>
          ["balanceOf", "balancesOf", "allowance"].includes(r.functionName) &&
          r.args?.[0] !== MARKET,
      ),
    ).toBe(false);
  });
  it("derives held contributions from the market's CST balance at the same block", async () => {
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.heldContributions).toBe(5n * ONE);
    expect(result.current.data!.funding!.unallocated).toBe(5n * ONE);
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TOKEN,
        functionName: "balanceOf",
        args: [MARKET],
        blockNumber: 123n,
      }),
    );
  });
  it("keeps held contributions visible while no cycle trades and saturates a deficit", async () => {
    data.outcomeState = [false, true, 255, 3];
    data.marketBalance = 1n;
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.funding).toBeNull();
    expect(result.current.data!.heldContributions).toBe(0n);
  });
  it("rejects a preview whose held CST disagrees with the same-block balance", async () => {
    data.marketBalance = (data.marketBalance as bigint) + 1n;
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/custody is inconsistent/);
  });
  it.each([
    [true, false, 0, 1],
    [true, false, 0, 0],
    [true, false, 1, 0],
    [true, true, 255, 1],
    [false, true, 1, 1],
  ])("rejects inconsistent outcome state %j", async (open, final, known, values) => {
    data.outcomeState = [open, final, known, values];
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/inconsistent/);
  });
  it("rejects token units, question seeds or settlement accounting inconsistent with the ABI", async () => {
    data.decimals = 6;
    const first = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(first.result.current.isError).toBe(true));
    expect(first.result.current.error?.message).toMatch(/18-decimal/);
    first.unmount();
    data.decimals = 18;
    data.questionStates = (data.questionStates as object[]).map((q) => ({
      ...q,
      initialYesBps: 0,
    }));
    const second = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(second.result.current.isError).toBe(true));
    expect(second.result.current.error?.message).toMatch(/question accounting/);
  });
  it("exposes refresh failures with cached data so the UI can fail closed", async () => {
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    mocks.getBlock.mockRejectedValueOnce(new Error("RPC unavailable"));
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeDefined();
  });
  it("fails an explicit refetch when the local network client is unavailable", async () => {
    mocks.available = false;
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/connection is not ready/);
  });
  it.each([
    "reopened",
    "finality reversed",
    "settled unclosed",
    "uncleared collateral",
    "seed overflow",
  ])("rejects incompatible cached state: %s", async (reason) => {
    if (reason === "reopened") data.roundState = { ...(data.roundState as object), closed: true };
    if (reason === "finality reversed")
      data.roundState = { ...(data.roundState as object), finalized: true };
    if (reason === "settled unclosed")
      data.roundState = {
        ...(data.roundState as object),
        settled: true,
        finalized: true,
        knownMask: 255,
      };
    if (reason === "uncleared collateral")
      data.roundState = {
        ...(data.roundState as object),
        settled: true,
        finalized: true,
        closed: true,
        knownMask: 255,
      };
    if (reason === "seed overflow")
      data.questionStates = (data.questionStates as object[]).map((q) => ({
        ...q,
        initialYesBps: 10000,
      }));
    const { result } = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/inconsistent/);
  });
  it("does not automatically read on unsupported networks or without a client", () => {
    mocks.config.chain.id = 1;
    const first = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    expect(first.result.current.fetchStatus).toBe("idle");
    first.unmount();
    mocks.config.chain.id = 31337;
    mocks.available = false;
    const second = renderHook(() => ({ ...useIndependentMarket(MARKET, null) }), {
      wrapper: wrapper(),
    });
    expect(second.result.current.fetchStatus).toBe("idle");
    expect(mocks.read).not.toHaveBeenCalled();
  });
});

describe("independent preview and source-free recovery", () => {
  it("reads an exact funding preview for zero or positive input at one block", async () => {
    const { result } = renderHook(
      () => ({ ...useIndependentFundingPreview(MARKET, 2n, 9n, true) }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "fundingPreview",
        args: [2n, 9n],
        blockNumber: 123n,
      }),
    );
  });
  it("does not query invalid or disabled funding input", () => {
    const { result } = renderHook(
      () => ({ ...useIndependentFundingPreview(MARKET, 2n, null, true) }),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects manual previews without valid input instead of calling the contract", async () => {
    const { result } = renderHook(
      () => ({ ...useIndependentFundingPreview(MARKET, 1n, null, false) }),
      { wrapper: wrapper() },
    );
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/preview unavailable/);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects manual recovery without a known cycle", async () => {
    const { result } = renderHook(() => ({ ...useIndependentRecovery(MARKET, null, false) }), {
      wrapper: wrapper(),
    });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/Choose a cycle/);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("recovers only from fresh market/token/vault data and honors recorded settlement", async () => {
    data.roundState = {
      ...(data.roundState as object),
      settled: true,
      finalized: true,
      knownMask: 255,
      values: 9,
    };
    const { result } = renderHook(() => ({ ...useIndependentRecovery(MARKET, 1n, true) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      market: MARKET,
      token: TOKEN,
      vault: VAULT,
      roundId: 1n,
      settled: true,
      values: 9,
      user: { owner: ACCOUNT },
    });
    for (const [request] of mocks.read.mock.calls) {
      expect(request.blockNumber).toBe(123n);
      expect(request.address).not.toBe(SOURCE);
      expect(request.address).not.toBe(GAME);
    }
    expect(
      mocks.read.mock.calls.some(([r]) =>
        ["outcomeState", "seedPreview", "previewClaim", "game"].includes(r.functionName),
      ),
    ).toBe(false);
  });
  it("requires a cycle and connected owner instead of guessing recovery context", () => {
    const { result } = renderHook(() => ({ ...useIndependentRecovery(MARKET, null, true) }), {
      wrapper: wrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects malformed cached settlement and failed recovery refreshes", async () => {
    data.roundState = { ...(data.roundState as object), settled: true, finalized: false };
    const { result } = renderHook(() => ({ ...useIndependentRecovery(MARKET, 1n, true) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/inconsistent/);
  });
});

describe("production V3 reads", () => {
  const realToken = "0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0";
  const realGame = "0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2";
  function production() {
    mocks.config.chain.id = 42161;
    mocks.getChainId.mockResolvedValue(42161);
    vi.stubEnv("NEXT_PUBLIC_INDEPENDENT_SOURCE_ADDRESS", SOURCE);
    data.cst = realToken;
    data.game = realGame;
    data.metrics = {
      gestureCount: 42n,
      ethSpent: ONE,
      cstBurned: 2n * ONE,
      highestCstPaid: ONE,
      enduranceDuration: 40n,
      chronoDuration: 50n,
      sameGesture: false,
      finalized: false,
      supported: true,
    };
  }
  it("uses pinned V3 adapter metrics and never calls simulator methods", async () => {
    production();
    const { result } = renderHook(() => useIndependentMarket(MARKET, null), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.local).toBeNull();
    expect(result.current.data!.metrics?.current?.gestureCount).toBe(42n);
    expect(result.current.data!.metrics?.previous?.gestureCount).toBe(42n);
    expect(
      mocks.read.mock.calls.some(([r]) =>
        ["roundStats", "getNextEthPrice", "getNextCstPrice", "seedPreview", "cycleTimes"].includes(
          r.functionName,
        ),
      ),
    ).toBe(false);
    for (const [request] of mocks.read.mock.calls) expect(request.blockNumber).toBe(123n);
  });
  it("represents unsupported metric records as unavailable, never a zero baseline", async () => {
    production();
    data.metrics = { ...(data.metrics as object), supported: false, gestureCount: 0n };
    const { result } = renderHook(() => useIndependentMarket(MARKET, 0n), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.metrics).toEqual({ current: null, previous: null });
  });
  it("handles an explicitly unsupported preceding round without inventing comparisons", async () => {
    production();
    data.metrics = { ...(data.metrics as object), supported: false };
    const { result } = renderHook(() => useIndependentMarket(MARKET, 3n), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.metrics?.previous).toBeNull();
  });
  it.each(["RPC", "token", "source", "game"])(
    "rejects a mismatched %s before exposing a trading snapshot",
    async (kind) => {
      production();
      if (kind === "RPC") mocks.getChainId.mockResolvedValue(1);
      if (kind === "token") data.cst = TOKEN;
      if (kind === "source") data.source = TOKEN;
      if (kind === "game") data.game = GAME;
      const { result } = renderHook(() => useIndependentMarket(MARKET, null), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
    },
  );
  it("supports production funding previews and source-independent balance recovery", async () => {
    production();
    const preview = renderHook(() => useIndependentFundingPreview(MARKET, 1n, ONE, true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(preview.result.current.isSuccess).toBe(true));
    mocks.read.mockClear();
    const recovery = renderHook(() => useIndependentRecovery(MARKET, 1n, true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(recovery.result.current.isSuccess).toBe(true));
    expect(
      mocks.read.mock.calls.some(([r]) =>
        ["game", "outcomeState", "metrics"].includes(r.functionName),
      ),
    ).toBe(false);
  });
  it("rejects a wrong-chain RPC for preview and recovery too", async () => {
    production();
    mocks.getChainId.mockResolvedValue(1);
    const preview = renderHook(() => useIndependentFundingPreview(MARKET, 1n, ONE, true), {
      wrapper: wrapper(),
    });
    const recovery = renderHook(() => useIndependentRecovery(MARKET, 1n, true), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(preview.result.current.isError).toBe(true));
    await waitFor(() => expect(recovery.result.current.isError).toBe(true));
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
