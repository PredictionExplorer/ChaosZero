import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharedDashboard } from "./shared-app";
import type { SharedSnapshot } from "./use-shared-market";

const mocks = vi.hoisted(() => ({
  useSharedMarket: vi.fn(),
  useSharedActions: vi.fn(() => ({ pending: null, message: null })),
  usePositionRecovery: vi.fn(),
  connection: { status: "connected", address: "0x1111111111111111111111111111111111111111" },
}));
vi.mock("./use-shared-market", () => mocks);
vi.mock("./use-position-recovery", () => ({ usePositionRecovery: mocks.usePositionRecovery }));
vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    appConfig: { ...original.appConfig, chain: { ...original.appConfig.chain, id: 31337 } },
  };
});
vi.mock("wagmi", () => ({ useChainId: () => 31337, useConnection: () => mocks.connection }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/shared",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/wallet/connect-button", () => ({
  ConnectButton: () => <button>Connect wallet</button>,
}));

const address = "0x1111111111111111111111111111111111111111" as const;
const cachedSnapshot: SharedSnapshot = {
  roundId: 1n,
  currentRound: 1n,
  timestamp: 100n,
  token: address,
  source: address,
  game: address,
  funded: true,
  open: true,
  finalized: false,
  pool: {
    collateral: 1000n * 10n ** 18n,
    yes: Array<bigint>(8).fill(0n),
    no: Array<bigint>(8).fill(0n),
    knownMask: 0,
    values: 0,
  },
  user: {
    yes: Array<bigint>(8).fill(0n),
    no: Array<bigint>(8).fill(0n),
    balance: 100n * 10n ** 18n,
    allowance: 100n * 10n ** 18n,
  },
  local: null,
};

beforeEach(() => {
  mocks.connection.address = "0x1111111111111111111111111111111111111111";
  mocks.usePositionRecovery.mockReturnValue({
    data: undefined,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  });
});

describe("shared dashboard refresh failures", () => {
  it.each(["The outcome source returned an inconsistent state.", "RPC connection unavailable"])(
    "fails closed with cached data after %s",
    async (message) => {
      const refetch = vi.fn().mockResolvedValue(undefined);
      mocks.useSharedMarket.mockReturnValue({
        data: cachedSnapshot,
        error: new Error(message),
        refetch,
        isFetching: false,
      });
      render(<SharedDashboard market={address} roundOverride={null} />);
      expect(
        screen.getByRole("heading", { name: "Could not load the shared market" }),
      ).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(mocks.useSharedActions).toHaveBeenLastCalledWith(address, undefined, undefined);
      expect(screen.queryByTestId("shared-trade-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("shared-funding-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("shared-portfolio")).not.toBeInTheDocument();
      expect(screen.queryByTestId("local-controls")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Roll remaining funds/ }),
      ).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalledOnce();
    },
  );
  it("resets recovery drafts when switching to an already cached wallet in the same cycle", async () => {
    const other = "0x3333333333333333333333333333333333333333";
    const balances = {
      ...cachedSnapshot.user!,
      yes: [2n * 10n ** 18n, ...Array<bigint>(7).fill(0n)],
      no: [2n * 10n ** 18n, ...Array<bigint>(7).fill(0n)],
    };
    const recovered = {
      owner: address,
      roundId: 1n,
      token: address,
      timestamp: 100n,
      collateral: 10n ** 18n,
      user: balances,
    };
    mocks.useSharedMarket.mockReturnValue({
      data: cachedSnapshot,
      error: new Error("source offline"),
      refetch: vi.fn(),
      isFetching: false,
    });
    mocks.usePositionRecovery.mockReturnValue({
      data: recovered,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });
    const { rerender } = render(<SharedDashboard market={address} roundOverride={1n} />);
    await userEvent.type(screen.getByLabelText("Pairs to merge"), "1.25");
    await userEvent.click(screen.getByRole("button", { name: "Transfer YES: More gestures?" }));
    await userEvent.type(screen.getByLabelText("Recipient address"), other);
    mocks.connection.address = other;
    mocks.usePositionRecovery.mockReturnValue({
      data: { ...recovered, owner: other },
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });
    rerender(<SharedDashboard market={address} roundOverride={1n} />);
    expect(screen.getByLabelText("Pairs to merge")).toHaveValue("");
    expect(screen.queryByTestId("transfer-position-panel")).not.toBeInTheDocument();
    expect(mocks.useSharedActions).toHaveBeenLastCalledWith(
      address,
      undefined,
      expect.objectContaining({ owner: other }),
    );
  });
});
