import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chain } from "viem";
import { anvil, arbitrum } from "viem/chains";
import { AddressLink } from "./address-link";

const mocks = vi.hoisted(() => ({ chain: null as Chain | null }));

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

const ADDRESS = "0x1111111111111111111111111111111111111111";
const TX = `0x${"ab".repeat(32)}`;

beforeEach(() => {
  mocks.chain = arbitrum;
});

describe("AddressLink", () => {
  it("links an address to the chain explorer in a new, isolated tab", () => {
    render(<AddressLink address={ADDRESS} />);

    const link = screen.getByRole("link", { name: "0x1111…1111" });
    expect(link).toHaveAttribute("href", `https://arbiscan.io/address/${ADDRESS}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("title", `Address ${ADDRESS} — view on explorer`);
  });

  it("links transactions to the explorer's tx page, with a custom label", () => {
    render(<AddressLink address={TX} kind="tx" label="3m ago" />);

    const link = screen.getByRole("link", { name: "3m ago" });
    expect(link).toHaveAttribute("href", `https://arbiscan.io/tx/${TX}`);
    expect(link).toHaveAttribute("title", `Transaction ${TX} — view on explorer`);
  });

  it("tolerates an explorer URL with a trailing slash", () => {
    mocks.chain = { ...arbitrum, blockExplorers: { default: { name: "Scan", url: "https://scan.example/" } } };
    render(<AddressLink address={ADDRESS} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", `https://scan.example/address/${ADDRESS}`);
  });

  it("shows plain text with the full hash on hover when the chain has no explorer", () => {
    mocks.chain = { ...anvil, blockExplorers: undefined };
    render(<AddressLink address={ADDRESS} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("0x1111…1111")).toHaveAttribute("title", `Address ${ADDRESS}`);
  });
});
