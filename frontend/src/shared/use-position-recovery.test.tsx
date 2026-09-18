import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePositionRecovery } from "./use-position-recovery";

const mocks = vi.hoisted(() => ({
  clientAvailable: true,
  address: "0x1111111111111111111111111111111111111111" as `0x${string}` | undefined,
  config: { chain: { id: 31337 } },
  getBlock: vi.fn(),
  readContract: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ appConfig: mocks.config }));
vi.mock("wagmi", () => ({
  usePublicClient: () =>
    mocks.clientAvailable
      ? { getBlock: mocks.getBlock, readContract: mocks.readContract }
      : undefined,
  useConnection: () => ({ address: mocks.address }),
}));
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const zero = () => Array<bigint>(8).fill(0n);
const clients: QueryClient[] = [];
function setup(roundId: bigint | null = 3n, enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => ({ ...usePositionRecovery(MARKET, roundId, enabled) }), { wrapper });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.clientAvailable = true;
  mocks.address = "0x1111111111111111111111111111111111111111";
  mocks.config.chain.id = 31337;
  mocks.getBlock.mockResolvedValue({ number: 123n, timestamp: 456n });
  mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case "cst":
        return TOKEN;
      case "decimals":
        return 18;
      case "balancesOf":
        return [
          [5n, ...zero().slice(1)],
          [3n, ...zero().slice(1)],
        ];
      case "balanceOf":
        return 100n;
      case "allowance":
        return 20n;
      case "roundAccounting":
        return [1000n, false, 0, 0];
      default:
        throw new Error(`Forbidden source read: ${functionName}`);
    }
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe("fresh source-independent position recovery", () => {
  it("reads only the market and token, pinning all balances to one block", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      roundId: 3n,
      token: TOKEN,
      timestamp: 456n,
      collateral: 1000n,
      user: {
        balance: 100n,
        allowance: 20n,
        yes: [5n, ...zero().slice(1)],
        no: [3n, ...zero().slice(1)],
      },
    });
    for (const [request] of mocks.readContract.mock.calls) {
      expect(request.blockNumber).toBe(123n);
      expect([MARKET, TOKEN]).toContain(request.address);
    }
    expect(mocks.readContract.mock.calls.map(([request]) => request.functionName)).toEqual([
      "cst",
      "decimals",
      "balancesOf",
      "balanceOf",
      "allowance",
      "roundAccounting",
    ]);
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "balancesOf", args: [3n, mocks.address] }),
    );
  });
  it.each(["disabled", "unknown cycle", "disconnected", "no client", "public chain"])(
    "does not infer a cycle or query positions when %s",
    async (reason) => {
      if (reason === "disconnected") mocks.address = undefined;
      if (reason === "no client") mocks.clientAvailable = false;
      if (reason === "public chain") mocks.config.chain.id = 42161;
      const { result } = setup(reason === "unknown cycle" ? null : 3n, reason !== "disabled");
      expect(result.current.fetchStatus).toBe("idle");
      expect(mocks.getBlock).not.toHaveBeenCalled();
    },
  );
  it("rejects an explicit refetch without its required owner/cycle context", async () => {
    const { result } = setup(null);
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/Choose a cycle/);
    expect(mocks.readContract).not.toHaveBeenCalled();
  });
  it("rejects unexpected token decimals", async () => {
    const original = mocks.readContract.getMockImplementation()!;
    mocks.readContract.mockImplementation((request) =>
      request.functionName === "decimals" ? Promise.resolve(6) : original(request),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/18-decimal/);
    expect(result.current.data).toBeUndefined();
  });
  it("marks cached balances as failed when the next pinned snapshot cannot be read", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    mocks.getBlock.mockRejectedValueOnce(new Error("RPC offline"));
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeDefined();
    expect(result.current.error?.message).toBe("RPC offline");
  });
});
