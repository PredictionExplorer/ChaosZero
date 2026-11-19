import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "@/lib/config";
import { ACCOUNT } from "@/independent/test-fixtures";
import { ConnectButton } from "./connect-button";

const mocks = vi.hoisted(() => ({
  connection: { status: "disconnected", address: undefined } as {
    status: string;
    address?: `0x${string}`;
    chainId?: number;
  },
  switchChain: { mutate: vi.fn(), isPending: false },
  disconnect: { mutate: vi.fn() },
}));

vi.mock("wagmi", () => ({
  useConnection: () => mocks.connection,
  useSwitchChain: () => mocks.switchChain,
  useDisconnect: () => mocks.disconnect,
}));

beforeEach(() => {
  mocks.connection = { status: "disconnected", address: undefined };
  mocks.switchChain.isPending = false;
  mocks.switchChain.mutate.mockReset();
  mocks.disconnect.mutate.mockReset();
});

function connectAs(chainId = appConfig.chain.id) {
  mocks.connection = { status: "connected", address: ACCOUNT, chainId };
}

describe("ConnectButton", () => {
  it("server-renders a stable, disabled placeholder (no hydration mismatch)", () => {
    const html = renderToString(<ConnectButton />);
    expect(html).toContain("Connect");
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain("Connect wallet");
  });

  describe("disconnected", () => {
    it("offers to connect, without loading the wallet picker up front", () => {
      render(<ConnectButton />);

      expect(screen.getByRole("button", { name: "Connect wallet" })).toBeEnabled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows a busy, disabled button while an earlier session reconnects", () => {
      mocks.connection = { status: "reconnecting" };
      render(<ConnectButton />);

      expect(screen.getByRole("button", { name: "Connect wallet" })).toBeDisabled();
    });
  });

  describe("connected to the wrong network", () => {
    it(`asks to switch to ${appConfig.chain.name}`, async () => {
      const user = userEvent.setup();
      connectAs(1);
      render(<ConnectButton />);

      await user.click(screen.getByRole("button", { name: `Switch to ${appConfig.chain.name}` }));

      expect(mocks.switchChain.mutate).toHaveBeenCalledWith({ chainId: appConfig.chain.id });
      expect(screen.queryByText("0x1111…1111")).not.toBeInTheDocument();
    });

    it("is busy while the switch is pending", () => {
      connectAs(1);
      mocks.switchChain.isPending = true;
      render(<ConnectButton />);

      expect(
        screen.getByRole("button", { name: `Switch to ${appConfig.chain.name}` }),
      ).toBeDisabled();
    });
  });

  describe("connected", () => {
    it("closes the menu on a click anywhere outside it", async () => {
      const user = userEvent.setup();
      connectAs();
      render(<ConnectButton />);

      await user.click(screen.getByRole("button", { name: "0x1111…1111" }));
      await user.click(document.body);

      expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
      expect(mocks.disconnect.mutate).not.toHaveBeenCalled();
    });

    it("closes the disclosure when focus leaves it", async () => {
      const user = userEvent.setup();
      connectAs();
      render(
        <>
          <ConnectButton />
          <button>Next action</button>
        </>,
      );
      const account = screen.getByRole("button", { name: "0x1111…1111" });
      await user.click(account);
      await user.tab();
      expect(screen.getByRole("button", { name: "Disconnect" })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("button", { name: "Next action" })).toHaveFocus();
      expect(account).toHaveAttribute("aria-expanded", "false");
    });
  });
});
