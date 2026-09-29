import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { getAddress } from "viem";
import { SERIES } from "@/test/fixtures";
import { MarketGate } from "./market-gate";

const mocks = vi.hoisted(() => ({
  search: "",
  configuredMarket: null as Address | null,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    appConfig: {
      ...actual.appConfig,
      get marketAddress() {
        return mocks.configuredMarket;
      },
    },
  };
});
// The trading screen has its own suite; here it only reports what it was given.
vi.mock("./market-app", () => ({
  MarketApp: ({
    seriesAddress,
    roundOverride,
  }: {
    seriesAddress: Address;
    roundOverride: bigint | null;
  }) => (
    <div
      data-testid="market-app"
      data-series={seriesAddress}
      data-round={roundOverride?.toString() ?? "live"}
    />
  ),
}));

/** A second deployment, in canonical EIP-55 checksum form. */
const OTHER: Address = getAddress("0xabcdef0123456789abcdef0123456789abcdef01");

beforeEach(() => {
  mocks.search = "";
  mocks.configuredMarket = null;
});

describe("MarketGate", () => {
  it("explains how to configure a market when none is set", () => {
    render(<MarketGate />);

    expect(screen.getByTestId("no-market")).toHaveTextContent("NEXT_PUBLIC_MARKET_ADDRESS");
    expect(screen.queryByTestId("market-app")).not.toBeInTheDocument();
  });

  it("opens the configured market, following the live round", () => {
    mocks.configuredMarket = SERIES;
    render(<MarketGate />);

    const app = screen.getByTestId("market-app");
    expect(app).toHaveAttribute("data-series", SERIES);
    expect(app).toHaveAttribute("data-round", "live");
  });

  it("lets ?market= point at another deployment, checksummed", () => {
    mocks.configuredMarket = SERIES;
    mocks.search = `market=${OTHER.toLowerCase()}`;
    render(<MarketGate />);

    expect(screen.getByTestId("market-app")).toHaveAttribute("data-series", OTHER);
  });

  it("works from ?market= alone when nothing is configured", () => {
    mocks.search = `market=${OTHER}`;
    render(<MarketGate />);

    expect(screen.getByTestId("market-app")).toHaveAttribute("data-series", OTHER);
  });

  it("ignores a malformed ?market= instead of breaking the page", () => {
    mocks.search = "market=0xnope";
    render(<MarketGate />);

    expect(screen.getByTestId("no-market")).toBeInTheDocument();
  });

  it("pins the round from ?round=", () => {
    mocks.configuredMarket = SERIES;
    mocks.search = "round=12";
    render(<MarketGate />);

    expect(screen.getByTestId("market-app")).toHaveAttribute("data-round", "12");
  });

  it("follows the live round when ?round= is not a round number", () => {
    mocks.configuredMarket = SERIES;
    mocks.search = "round=-1";
    render(<MarketGate />);

    expect(screen.getByTestId("market-app")).toHaveAttribute("data-round", "live");
  });
});
