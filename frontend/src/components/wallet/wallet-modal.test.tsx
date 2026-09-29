import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LazyMotion, MotionGlobalConfig, domAnimation } from "motion/react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserRejectedRequestError } from "viem";
import { describeTxError } from "@/lib/errors";
import { WalletModal } from "./wallet-modal";

interface FakeConnector {
  readonly uid: string;
  readonly name: string;
  readonly icon?: string;
}

const mocks = vi.hoisted(() => ({
  connectors: [] as FakeConnector[],
  connect: { mutateAsync: vi.fn(), isPending: false },
  toastError: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConnectors: () => mocks.connectors,
  useConnect: () => mocks.connect,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

const METAMASK: FakeConnector = { uid: "io.metamask", name: "MetaMask", icon: "data:image/svg+xml;base64,PHN2Zy8+" };
const WALLETCONNECT: FakeConnector = { uid: "walletConnect", name: "WalletConnect" };

beforeAll(() => {
  // Deterministic: enter/exit animations complete instantly.
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

beforeEach(() => {
  mocks.connectors = [METAMASK, WALLETCONNECT];
  mocks.connect.isPending = false;
  mocks.connect.mutateAsync.mockReset().mockResolvedValue({ accounts: [], chainId: 42161 });
  mocks.toastError.mockReset();
});

/** Renders the modal inside the same strict LazyMotion the app provides. */
function renderModal(open = true) {
  const onClose = vi.fn();
  const ui = (isOpen: boolean) => (
    <LazyMotion features={domAnimation} strict>
      <WalletModal open={isOpen} onClose={onClose} />
    </LazyMotion>
  );
  const utils = render(ui(open));
  return { onClose, ...utils, setOpen: (isOpen: boolean) => utils.rerender(ui(isOpen)) };
}

describe("WalletModal", () => {
  it("renders nothing while closed", () => {
    renderModal(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing on the server (the portal needs a DOM)", () => {
    expect(renderToString(<WalletModal open onClose={() => {}} />)).toBe("");
  });

  it("opens as a labelled modal dialog portaled to <body>", () => {
    const { container } = renderModal();

    const dialog = screen.getByRole("dialog", { name: "Connect a wallet" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Outside every ancestor with backdrop-filter, so it covers the viewport.
    expect(container).not.toContainElement(dialog);
    expect(dialog.parentElement).toBe(document.body);
  });

  it("lists every discovered wallet, with its EIP-6963 icon when it has one", () => {
    renderModal();

    const dialog = screen.getByRole("dialog");
    const metamask = within(dialog).getByRole("button", { name: "MetaMask" });
    expect(within(metamask).getByRole("presentation")).toHaveAttribute("src", METAMASK.icon);
    const walletConnect = within(dialog).getByRole("button", { name: "WalletConnect" });
    expect(within(walletConnect).queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("connects with the chosen wallet, then closes", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole("button", { name: "WalletConnect" }));

    expect(mocks.connect.mutateAsync).toHaveBeenCalledWith({ connector: WALLETCONNECT });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("stays open and explains the failure when connecting fails", async () => {
    const user = userEvent.setup();
    const error = new UserRejectedRequestError(new Error("User rejected the request."));
    mocks.connect.mutateAsync.mockRejectedValueOnce(error);
    const { onClose } = renderModal();

    await user.click(screen.getByRole("button", { name: "MetaMask" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(describeTxError(error)));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables every choice while a connection is pending", () => {
    mocks.connect.isPending = true;
    renderModal();

    expect(screen.getByRole("button", { name: "MetaMask" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "WalletConnect" })).toBeDisabled();
  });

  it("points to wallet installs when the browser has none", () => {
    mocks.connectors = [];
    renderModal();

    expect(screen.getByText("No wallet found")).toBeInTheDocument();
    for (const [name, href] of [
      ["MetaMask", "https://metamask.io"],
      ["Rabby", "https://rabby.io"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  describe("dismissal", () => {
    it("closes on Escape", async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("ignores other keys", async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();

      await user.keyboard("{Enter}a");
      expect(onClose).not.toHaveBeenCalled();
    });

    it("closes from the close button", async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();

      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("closes on a backdrop click but not on clicks inside the panel", async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();

      await user.click(screen.getByRole("heading", { name: "Connect a wallet" }));
      expect(onClose).not.toHaveBeenCalled();

      await user.click(screen.getByRole("dialog"));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("stops listening for Escape once closed", async () => {
      const user = userEvent.setup();
      const { onClose, setOpen } = renderModal();

      setOpen(false);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
