import { useQueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig, m, motion } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chain } from "viem";
import { arbitrum } from "viem/chains";
import { useConfig } from "wagmi";
import { Providers, rpcOrigin } from "./providers";

const mocks = vi.hoisted(() => ({
  rpcUrl: null as string | null,
  chain: null as Chain | null,
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    appConfig: {
      ...actual.appConfig,
      get rpcUrl() {
        return mocks.rpcUrl;
      },
      get chain() {
        return mocks.chain ?? actual.appConfig.chain;
      },
    },
  };
});

beforeEach(() => {
  mocks.rpcUrl = null;
  mocks.chain = null;
});

describe("rpcOrigin", () => {
  it("falls back to the chain's public RPC", () => {
    expect(rpcOrigin()).toBe(new URL(arbitrum.rpcUrls.default.http[0]!).origin);
  });

  it("prefers the configured RPC, reduced to its origin (no path or API key)", () => {
    mocks.rpcUrl = "https://arb-mainnet.example.com/v2/secret-key";
    expect(rpcOrigin()).toBe("https://arb-mainnet.example.com");
  });

  it.each([
    ["a malformed URL", "not a url"],
    ["a websocket endpoint", "wss://rpc.example.com"],
  ])("gives up on %s", (_label, url) => {
    mocks.rpcUrl = url;
    expect(rpcOrigin()).toBeNull();
  });

  it("gives up when the chain has no public RPC", () => {
    mocks.chain = { ...arbitrum, rpcUrls: { default: { http: [] } } } as unknown as Chain;
    expect(rpcOrigin()).toBeNull();
  });
});

function Consumer() {
  // Throws unless every provider the app relies on is present.
  const wagmi = useConfig();
  useQueryClient();
  return (
    <m.p data-testid="consumer" data-chain={wagmi.chains[0].id}>
      ready
    </m.p>
  );
}

describe("Providers", () => {
  it("gives the app wagmi, react-query and strict lazy motion", () => {
    render(
      <Providers>
        <Consumer />
      </Providers>,
    );

    expect(screen.getByTestId("consumer")).toHaveAttribute("data-chain", String(arbitrum.id));
  });

  it("loads the animation engine on demand, then animates", async () => {
    MotionGlobalConfig.skipAnimations = true; // finish each animation in one step
    try {
      render(
        <Providers>
          <m.p data-testid="fade" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            hello
          </m.p>
        </Providers>,
      );
      // First paint: only the lightweight renderer, no animation yet.
      expect(screen.getByTestId("fade")).toHaveStyle({ opacity: "0" });

      await waitFor(() => expect(screen.getByTestId("fade")).toHaveStyle({ opacity: "1" }));
    } finally {
      MotionGlobalConfig.skipAnimations = false;
    }
  });

  it("rejects full `motion` components, keeping the animation engine out of first-load JS", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <Providers>
          <motion.p>eager</motion.p>
        </Providers>,
      ),
    ).toThrow(/LazyMotion/);
  });

  it("warms up the connection to the RPC before the first read", () => {
    mocks.rpcUrl = "https://rpc.example.com/key";
    render(
      <Providers>
        <p>app</p>
      </Providers>,
    );

    expect(
      document.head.querySelector('link[rel="preconnect"][href="https://rpc.example.com"]'),
    ).not.toBeNull();
  });

  it("renders the toast outlet for transaction feedback", () => {
    render(
      <Providers>
        <p>app</p>
      </Providers>,
    );

    expect(screen.getByRole("region", { name: /notifications/i })).toBeInTheDocument();
  });
});
