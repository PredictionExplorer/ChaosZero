import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anvil, arbitrum } from "viem/chains";
import { connect } from "wagmi/actions";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site";

/**
 * The WalletConnect connector opens a relay connection as soon as a config
 * is created, so it is replaced by wagmi's offline mock connector; the test
 * asserts what the app asks WalletConnect for.
 */
const mocks = vi.hoisted(() => ({ walletConnect: vi.fn() }));

vi.mock("wagmi/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi/connectors")>();
  mocks.walletConnect.mockImplementation(() =>
    actual.mock({ accounts: ["0x0000000000000000000000000000000000000001"] }),
  );
  return { ...actual, walletConnect: mocks.walletConnect };
});

/** anvil's first three pre-funded dev accounts (never mainnet keys). */
const ANVIL_ACCOUNTS = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
];

/** Builds the config fresh, so it sees the current environment. */
async function loadConfig() {
  vi.resetModules();
  return (await import("./wagmi")).wagmiConfig;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "");
  vi.stubEnv("NEXT_PUBLIC_RPC_URL", "");
  vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "");
  mocks.walletConnect.mockClear();
  window.localStorage.clear();
});

describe("wagmi config", () => {
  it("targets Arbitrum One over its public RPC by default", async () => {
    const config = await loadConfig();

    expect(config.chains.map((chain) => chain.id)).toEqual([arbitrum.id]);
    expect(config.getClient().transport.url).toBe(arbitrum.rpcUrls.default.http[0]);
  });

  it("uses the configured RPC endpoint", async () => {
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", "https://arb-mainnet.example.com/v2/key");
    const config = await loadConfig();

    expect(config.getClient().transport.url).toBe("https://arb-mainnet.example.com/v2/key");
  });

  it("ships no connectors of its own: browser wallets arrive via EIP-6963", async () => {
    const config = await loadConfig();

    expect(config.connectors).toHaveLength(0);
    expect(mocks.walletConnect).not.toHaveBeenCalled();
  });

  it("adds WalletConnect, described with the site's identity, when a project id is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "wc-project-123");
    const config = await loadConfig();

    expect(config.connectors).toHaveLength(1);
    expect(mocks.walletConnect).toHaveBeenCalledWith({
      projectId: "wc-project-123",
      metadata: {
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        icons: [`${SITE_URL}/icon-512.png`],
      },
      showQrModal: true,
    });
    // The icon wallets display must actually be served.
    expect(existsSync(join(process.cwd(), "public/icon-512.png"))).toBe(true);
  });

  it("adds an auto-signing sandbox wallet with anvil's funded accounts on a local chain", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", String(anvil.id));
    const config = await loadConfig();

    expect(config.chains.map((chain) => chain.id)).toEqual([anvil.id]);
    const [sandbox] = config.connectors;
    expect(sandbox?.type).toBe("mock");
    // Not connected until the user picks it.
    expect(config.state.status).toBe("disconnected");

    const { accounts } = await connect(config, { connector: sandbox! });
    expect(accounts).toEqual(ANVIL_ACCOUNTS);
  });

  it("persists wallet state in localStorage under the chaos-zero prefix", async () => {
    const config = await loadConfig();

    await config.storage?.setItem("recentConnectorId", "io.metamask");

    expect(window.localStorage.getItem("chaos-zero.recentConnectorId")).toBe(
      JSON.stringify("io.metamask"),
    );
  });
});
