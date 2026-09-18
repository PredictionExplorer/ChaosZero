import type { CreateConnectorFn } from "wagmi";
import { createConfig, createStorage, http } from "wagmi";
import { mock, walletConnect } from "wagmi/connectors";
import { anvil } from "viem/chains";
import { appConfig } from "./config";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site";

function buildConnectors(): CreateConnectorFn[] {
  const connectors: CreateConnectorFn[] = [];
  if (appConfig.walletConnectProjectId) {
    connectors.push(
      walletConnect({
        projectId: appConfig.walletConnectProjectId,
        metadata: {
          name: SITE_NAME,
          description: SITE_DESCRIPTION,
          url: SITE_URL,
          icons: [`${SITE_URL}/icon-512.png`],
        },
        showQrModal: true,
      }),
    );
  }
  // Local sandbox only: anvil auto-signs for its unlocked default accounts,
  // so this "wallet" sends real transactions without a browser extension.
  if (appConfig.chain.id === anvil.id) {
    const localAccounts = [
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    ] as const;
    for (const [index, account] of localAccounts.entries()) {
      const connector = mock({ accounts: [account], features: { defaultConnected: false } });
      connectors.push((config) => ({
        ...connector(config),
        id: `mock-wallet-${index + 1}`,
        name: `Mock Connector ${index + 1}`,
      }));
    }
  }
  return connectors;
}

/**
 * wagmi config for the single chain this deployment targets.
 *
 * Browser wallets are discovered automatically via EIP-6963 (wagmi's
 * multi-injected provider discovery), so MetaMask, Rabby, Coinbase extension
 * etc. each show up as their own connector without extra SDKs. WalletConnect
 * is added when a project id is configured, covering mobile wallets.
 */
// The mock connector obtains its RPC from the chain object, independently of
// wagmi's transport. Keep both pointed at the same isolated Anvil instance.
const walletChain =
  appConfig.chain.id === anvil.id && appConfig.rpcUrl
    ? {
        ...appConfig.chain,
        rpcUrls: { ...appConfig.chain.rpcUrls, default: { http: [appConfig.rpcUrl] } },
      }
    : appConfig.chain;

export const wagmiConfig = createConfig({
  chains: [walletChain],
  connectors: buildConnectors(),
  storage:
    typeof window !== "undefined"
      ? createStorage({ storage: window.localStorage, key: "chaos-zero" })
      : undefined,
  transports: {
    [appConfig.chain.id]: http(appConfig.rpcUrl ?? undefined),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
