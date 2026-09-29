import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Address, Transport } from "viem";
import { WagmiProvider, createConfig } from "wagmi";
import { connect } from "wagmi/actions";
import { mock } from "wagmi/connectors";
import { appConfig } from "@/lib/config";
import type { wagmiConfig } from "@/lib/wagmi";
import { createTestQueryClient } from "./query";

/**
 * A real wagmi config on the app's chain, wired to `transport` (usually a
 * fake chain) with wagmi's own mock connector for the wallet. Nothing is
 * persisted and no browser wallets are discovered, so tests stay isolated.
 */
export function createTestWagmi({
  transport,
  account,
}: {
  transport: Transport;
  account: Address;
}) {
  const config = createConfig({
    chains: [appConfig.chain],
    connectors: [mock({ accounts: [account] })],
    transports: { [appConfig.chain.id]: transport },
    storage: null,
    multiInjectedProviderDiscovery: false,
  });
  const queryClient = createTestQueryClient();

  // The app registers its own config type with wagmi; this one differs only in
  // its transport's type.
  const registered = config as unknown as typeof wagmiConfig;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <WagmiProvider config={registered} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    );
  }

  return {
    config,
    queryClient,
    wrapper: Wrapper,
    /** Connects the mock wallet, as a user approving the connection would. */
    connectWallet: () => connect(config, { connector: config.connectors[0]! }),
  };
}
