import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LazyMotion, MotionGlobalConfig, domAnimation } from "motion/react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "@/lib/config";
import { USER } from "@/test/fixtures";
import { ConnectButton } from "./connect-button";

const mocks = vi.hoisted(() => ({
  connection: { status: "disconnected", address: undefined } as {
    status: string;
    address?: `0x${string}`;
  },
  chainId: 0,
  switchChain: { mutate: vi.fn(), isPending: false },
  disconnect: { mutate: vi.fn() },
  connectors: [{ uid: "io.metamask", name: "MetaMask" }],
  connect: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("wagmi", () => ({
  useConnection: () => mocks.connection,
  useChainId: () => mocks.chainId,
  useSwitchChain: () => mocks.switchChain,
  useDisconnect: () => mocks.disconnect,
  // Consumed by the lazily loaded wallet picker.
  useConnectors: () => mocks.connectors,
  useConnect: () => mocks.connect,
}));

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

beforeEach(() => {
  mocks.connection = { status: "disconnected", address: undefined };
  mocks.chainId = appConfig.chain.id;
  mocks.switchChain.isPending = false;
  mocks.switchChain.mutate.mockReset();
  mocks.disconnect.mutate.mockReset();
});

function connectAs(chainId = appConfig.chain.id) {
  mocks.connection = { status: "connected", address: USER };
  mocks.chainId = chainId;
}

function renderButton() {
  return render(
    <LazyMotion features={domAnimation} strict>
      <ConnectButton />
    </LazyMotion>,
  );
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
      renderButton();

      expect(screen.getByRole("button", { name: "Connect wallet" })).toBeEnabled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("loads and opens the wallet picker on demand, and closes it again", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(screen.getByRole("button", { name: "Connect wallet" }));

      const dialog = await screen.findByRole("dialog", { name: "Connect a wallet" });
      expect(dialog).toHaveTextContent("MetaMask");

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      // Reopening reuses the already-loaded picker.
      await user.click(screen.getByRole("button", { name: "Connect wallet" }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("shows a busy, disabled button while an earlier session reconnects", () => {
      mocks.connection = { status: "reconnecting" };
      renderButton();

      expect(screen.getByRole("button", { name: "Connect wallet" })).toBeDisabled();
    });
  });

  describe("connected to the wrong network", () => {
    it(`asks to switch to ${appConfig.chain.name}`, async () => {
      const user = userEvent.setup();
      connectAs(1);
      renderButton();

      await user.click(screen.getByRole("button", { name: `Switch to ${appConfig.chain.name}` }));

      expect(mocks.switchChain.mutate).toHaveBeenCalledWith({ chainId: appConfig.chain.id });
      expect(screen.queryByText("0x4444…4444")).not.toBeInTheDocument();
    });

    it("is busy while the switch is pending", () => {
      connectAs(1);
      mocks.switchChain.isPending = true;
      renderButton();

      expect(
        screen.getByRole("button", { name: `Switch to ${appConfig.chain.name}` }),
      ).toBeDisabled();
    });
  });

  describe("connected", () => {
    it("shows the shortened account and a collapsed account menu", () => {
      connectAs();
      renderButton();

      const account = screen.getByRole("button", { name: "0x4444…4444" });
      expect(account).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    });

    it("disconnects from the account menu and closes it", async () => {
      const user = userEvent.setup();
      connectAs();
      renderButton();

      await user.click(screen.getByRole("button", { name: "0x4444…4444" }));
      expect(screen.getByRole("button", { name: "0x4444…4444" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      await user.click(screen.getByRole("button", { name: "Disconnect" }));

      expect(mocks.disconnect.mutate).toHaveBeenCalledWith({});
      expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    });

    it("toggles the menu from its own button", async () => {
      const user = userEvent.setup();
      connectAs();
      renderButton();

      const account = screen.getByRole("button", { name: "0x4444…4444" });
      await user.click(account);
      await user.click(account);
      expect(account).toHaveAttribute("aria-expanded", "false");
    });

    it("closes the menu on a click anywhere outside it", async () => {
      const user = userEvent.setup();
      connectAs();
      renderButton();

      await user.click(screen.getByRole("button", { name: "0x4444…4444" }));
      await user.click(document.body);

      expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
      expect(mocks.disconnect.mutate).not.toHaveBeenCalled();
    });

    it("does not dismiss the menu when a press starts inside it", async () => {
      const user = userEvent.setup();
      connectAs();
      renderButton();

      await user.click(screen.getByRole("button", { name: "0x4444…4444" }));
      // Press (without releasing) on the menu item: the outside-click guard
      // must not unmount it before the click lands.
      await user.pointer({
        keys: "[MouseLeft>]",
        target: screen.getByRole("button", { name: "Disconnect" }),
      });

      expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    });
  });
});
