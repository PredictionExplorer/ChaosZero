import { render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useMounted } from "./use-mounted";

function Probe() {
  return <span data-testid="probe">{useMounted() ? "client" : "server"}</span>;
}

describe("useMounted", () => {
  it("is false while rendering on the server", () => {
    expect(renderToString(<Probe />)).toContain("server");
  });

  it("is true once rendered in the browser", () => {
    const { result } = renderHook(() => useMounted());
    expect(result.current).toBe(true);
  });

  it("switches to the client value when server HTML hydrates, without a mismatch", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    document.body.appendChild(container);
    expect(screen.getByTestId("probe")).toHaveTextContent("server");
    const consoleError = vi.spyOn(console, "error");
    const onRecoverableError = vi.fn();

    render(<Probe />, { container, hydrate: true, onRecoverableError });

    expect(await screen.findByText("client")).toBeInTheDocument();
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
