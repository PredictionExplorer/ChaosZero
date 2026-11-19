import type { Page } from "@playwright/test";

// Exercise wagmi's injected connector and chainChanged subscription. A mocked
// useChainId cannot model a wallet moving outside the configured read chain.
export async function installWallet(page: Page) {
  await page.addInitScript(() => {
    let chainId = "0x1";
    let authorized = false;
    const accounts = ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"];
    const listeners = new Map<string, Set<(value: string) => void>>();
    const provider = {
      async request({ method, params }: { method: string; params?: { chainId: string }[] }) {
        switch (method) {
          case "eth_chainId":
            return chainId;
          case "eth_accounts":
            return authorized ? accounts : [];
          case "eth_requestAccounts":
            authorized = true;
            return accounts;
          case "wallet_revokePermissions":
            authorized = false;
            return null;
          case "wallet_switchEthereumChain":
            if (params?.[0].chainId !== "0x7a69") throw Error("Expected local Anvil chain");
            chainId = params[0].chainId;
            for (const notify of listeners.get("chainChanged") ?? []) notify(chainId);
            return null;
          default:
            throw Object.assign(new Error("Unsupported method: " + method), { code: 4200 });
        }
      },
      on(event: string, listener: (value: string) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      removeListener(event: string, listener: (value: string) => void) {
        listeners.get(event)?.delete(listener);
      },
    };
    const info = {
      uuid: "4a45bb70-7766-4229-a5c7-e961bf75720f",
      name: "Test wallet",
      rdns: "test.chaoszero.wallet",
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    };
    window.addEventListener("eip6963:requestProvider", () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail: { info, provider } }),
      ),
    );
  });
}
