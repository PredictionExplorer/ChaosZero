import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrelaunchMarkets } from "./prelaunch";
import { cosmicGameV3Abi } from "./abi";
const mocks = vi.hoisted(() => ({ read: vi.fn(), block: vi.fn(), chain: vi.fn() }));
vi.mock("wagmi", () => ({
  usePublicClient: () => ({
    readContract: mocks.read,
    getBlock: mocks.block,
    getChainId: mocks.chain,
  }),
}));
vi.mock("@/lib/config", () => ({ appConfig: { chain: { id: 42161 } } }));
const queries: QueryClient[] = [];
function setup() {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  queries.push(query);
  return render(
    <QueryClientProvider client={query}>
      <PrelaunchMarkets />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.chain.mockResolvedValue(42161);
  mocks.block.mockResolvedValue({ number: 987n });
  mocks.read.mockImplementation(async ({ functionName }) => {
    if (functionName === "roundNum") return 3n;
    if (functionName === "roundStats") return { numBids: 71n };
    throw new Error(`Unsupported V3 getter: ${functionName}`);
  });
});
afterEach(() => {
  cleanup();
  for (const query of queries.splice(0)) query.clear();
});
describe("honest prelaunch board", () => {
  it("shows actual V3 round/count and eight opening prices without trade controls", async () => {
    setup();
    await screen.findByText("#3");
    expect(screen.getByText("71 gestures recorded")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(8);
    expect(screen.getByText(/not live quotes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /buy|approve|deposit/i })).not.toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "roundStats", args: [3n], blockNumber: 987n }),
    );
    expect(mocks.read).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "bidderAddresses" }),
    );
    expect(screen.getByRole("link", { name: /Read block/ })).toHaveAttribute(
      "href",
      "https://arbiscan.io/block/987",
    );
  });
  it("lets visitors inspect every settlement rule before launch", async () => {
    setup();
    const detail = screen.getAllByText("Explore question")[5];
    await userEvent.click(detail);
    expect(detail.closest("details")).toHaveAttribute("open");
    expect(screen.getByText(/Each new gesture flips the answer/)).toBeInTheDocument();
  });
  it("does not turn an unavailable RPC into a zero count", async () => {
    mocks.chain.mockResolvedValue(1);
    setup();
    await waitFor(() => expect(screen.getByText("Unavailable")).toBeInTheDocument(), {
      timeout: 2500,
    });
    expect(screen.queryByText(/0 gestures/)).not.toBeInTheDocument();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("pins the V3 record shape, including unused fields that affect decoding", () => {
    const stats = cosmicGameV3Abi.find((entry) => entry.name === "roundStats");
    expect(stats?.outputs[0]).toMatchObject({
      type: "tuple",
      components: [
        { name: "numBids", type: "uint256" },
        { name: "numCstBids", type: "uint256" },
        { name: "totalSpentEthAmount", type: "uint256" },
        { name: "totalSpentCstAmount", type: "uint256" },
        { name: "maxEthBidPrice", type: "uint256" },
        { name: "maxCstBidPrice", type: "uint256" },
        { name: "enduranceChampionDuration", type: "uint256" },
        { name: "chronoWarriorDuration", type: "uint256" },
        { name: "flags", type: "uint256" },
      ],
    });
  });
});
