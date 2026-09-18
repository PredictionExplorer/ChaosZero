import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SharedDashboard } from "./shared-app";
import type { SharedSnapshot } from "./use-shared-market";

const mocks = vi.hoisted(() => ({
  useSharedMarket: vi.fn(),
  useSharedActions: vi.fn(() => ({ pending: null, message: null })),
}));
vi.mock("./use-shared-market", () => mocks);
vi.mock("wagmi", () => ({
  useChainId: () => 31337,
  useConnection: () => ({
    status: "connected",
    address: "0x1111111111111111111111111111111111111111",
  }),
}));
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
});
