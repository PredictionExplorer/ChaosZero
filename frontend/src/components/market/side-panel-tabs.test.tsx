import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SidePanelTabs, type SidePanelTabsProps } from "./side-panel-tabs";

function renderTabs(overrides: Partial<SidePanelTabsProps> = {}) {
  const props: SidePanelTabsProps = {
    lpIndicator: false,
    bet: <div data-testid="bet-content">bet content</div>,
    liquidity: <div data-testid="liquidity-content">liquidity content</div>,
    ...overrides,
  };
  return render(<SidePanelTabs {...props} />);
}

describe("SidePanelTabs", () => {
  it("always opens on Place bet, keeping liquidity hidden but mounted", () => {
    renderTabs();

    expect(screen.getByTestId("bet-content")).toBeVisible();
    expect(screen.getByTestId("side-tab-bet")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("side-tab-liquidity")).toHaveAttribute("aria-selected", "false");

    // Mounted (state survives tab flips) but not visible or announced.
    expect(screen.getByTestId("liquidity-content")).not.toBeVisible();
    expect(screen.getByTestId("side-panel-liquidity")).toHaveAttribute("hidden");
  });

  it("switches panels on click, both ways", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByTestId("side-tab-liquidity"));
    expect(screen.getByTestId("liquidity-content")).toBeVisible();
    expect(screen.getByTestId("bet-content")).not.toBeVisible();
    expect(screen.getByTestId("side-tab-liquidity")).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByTestId("side-tab-bet"));
    expect(screen.getByTestId("bet-content")).toBeVisible();
    expect(screen.getByTestId("liquidity-content")).not.toBeVisible();
  });

  it("preserves panel state across a tab round-trip (panels stay mounted)", async () => {
    const user = userEvent.setup();
    render(
      <SidePanelTabs
        lpIndicator={false}
        bet={<input data-testid="bet-input" />}
        liquidity={<div />}
      />,
    );

    await user.type(screen.getByTestId("bet-input"), "123");
    await user.click(screen.getByTestId("side-tab-liquidity"));
    await user.click(screen.getByTestId("side-tab-bet"));
    expect(screen.getByTestId("bet-input")).toHaveValue("123");
  });

  it("supports the ARIA tabs keyboard pattern with a roving tabindex", async () => {
    const user = userEvent.setup();
    renderTabs();

    // Only the selected tab is in the tab order.
    expect(screen.getByTestId("side-tab-bet")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("side-tab-liquidity")).toHaveAttribute("tabindex", "-1");

    screen.getByTestId("side-tab-bet").focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("side-tab-liquidity")).toHaveFocus();
    expect(screen.getByTestId("liquidity-content")).toBeVisible();

    // Arrows wrap around both ends.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("side-tab-bet")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("side-tab-liquidity")).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByTestId("side-tab-bet")).toHaveFocus();
    expect(screen.getByTestId("bet-content")).toBeVisible();
    await user.keyboard("{End}");
    expect(screen.getByTestId("side-tab-liquidity")).toHaveFocus();
  });

  it("leaves other keys alone (typing, Tab, Enter keep their normal meaning)", async () => {
    const user = userEvent.setup();
    renderTabs();

    screen.getByTestId("side-tab-bet").focus();
    await user.keyboard("{ArrowDown}x");
    expect(screen.getByTestId("side-tab-bet")).toHaveFocus();
    expect(screen.getByTestId("side-tab-bet")).toHaveAttribute("aria-selected", "true");
  });

  it("wires tabs to panels with matching ARIA ids", () => {
    renderTabs();
    const tab = screen.getByTestId("side-tab-liquidity");
    const panel = screen.getByTestId("side-panel-liquidity");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(screen.getByRole("tablist", { name: /trade actions/i })).toBeInTheDocument();
  });

  it("marks the liquidity tab only when the user has an LP position", () => {
    const { rerender } = renderTabs({ lpIndicator: true });
    expect(screen.getByTestId("lp-tab-indicator")).toBeInTheDocument();
    expect(screen.getByText("(you have a liquidity position)")).toBeInTheDocument();

    rerender(<SidePanelTabs lpIndicator={false} bet={<div />} liquidity={<div />} />);
    expect(screen.queryByTestId("lp-tab-indicator")).not.toBeInTheDocument();
  });
});
