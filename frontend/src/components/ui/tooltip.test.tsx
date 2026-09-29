import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeBubblePosition, InfoTip, Tooltip } from "./tooltip";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tooltip", () => {
  it("stays hidden until triggered", () => {
    render(<Tooltip content="An explanation">trigger</Tooltip>);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on hover and closes on unhover", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="An explanation">trigger</Tooltip>);

    await user.hover(screen.getByText("trigger"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("An explanation");

    await user.unhover(screen.getByText("trigger"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on keyboard focus and closes on blur", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip content="An explanation">trigger</Tooltip>
        <button>elsewhere</button>
      </>,
    );

    await user.tab();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="An explanation">trigger</Tooltip>);

    await user.hover(screen.getByText("trigger"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on tap and closes on an outside tap", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip content="An explanation">trigger</Tooltip>
        <p>outside</p>
      </>,
    );

    await user.click(screen.getByText("trigger"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await user.click(screen.getByText("outside"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("wires aria-describedby from the focusable wrapper to the bubble", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="An explanation">trigger</Tooltip>);

    const wrapper = screen.getByText("trigger");
    expect(wrapper).toHaveAttribute("tabindex", "0");
    expect(wrapper).not.toHaveAttribute("aria-describedby");

    await user.hover(wrapper);
    expect(wrapper).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
  });

  it("moves aria-describedby onto an already-focusable child when tabIndex is -1", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="An explanation" tabIndex={-1}>
        <button>action</button>
      </Tooltip>,
    );

    const button = screen.getByRole("button", { name: "action" });
    // No duplicate tab stop around the button.
    expect(button.parentElement).not.toHaveAttribute("tabindex");

    await user.hover(button);
    expect(button).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);

    await user.unhover(button);
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("opens when a wrapped focusable child receives focus", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="An explanation" tabIndex={-1}>
        <button>action</button>
      </Tooltip>,
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "action" })).toHaveFocus();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});

describe("Tooltip — portal and stacking", () => {
  it("renders the bubble in a portal on document.body, outside the trigger's subtree", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="An explanation">trigger</Tooltip>);

    const wrapper = screen.getByText("trigger");
    await user.hover(wrapper);

    const tip = screen.getByRole("tooltip");
    // Escaping the card's backdrop-filter stacking context is the whole point:
    // the bubble must NOT be a descendant of the trigger.
    expect(tip.parentElement).toBe(document.body);
    expect(wrapper.contains(tip)).toBe(false);
  });

  it("uses fixed positioning above the app's stacking layers", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="An explanation">trigger</Tooltip>);

    await user.hover(screen.getByText("trigger"));
    const tip = screen.getByRole("tooltip");
    expect(tip.className).toContain("fixed");
    expect(tip.className).toContain("z-[60]");
    // Placed (not left invisible) even with jsdom's zero-size rects.
    expect(tip.style.top).not.toBe("");
    expect(tip.style.left).not.toBe("");
    expect(tip.style.visibility).not.toBe("hidden");
  });

  it("removes the bubble from the body when closed", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="An explanation">trigger</Tooltip>);

    await user.hover(screen.getByText("trigger"));
    expect(document.body.querySelector("[role=tooltip]")).not.toBeNull();

    await user.unhover(screen.getByText("trigger"));
    expect(document.body.querySelector("[role=tooltip]")).toBeNull();
  });
});

describe("Tooltip — live geometry", () => {
  function stubTriggerRect(
    el: Element,
    rect: { top: number; bottom: number; left: number; right: number },
  ) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    } as DOMRect);
  }

  function stubBubbleSize(width: number, height: number) {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(height);
  }

  it("flips below a trigger that has no room above, and follows it on scroll", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="An explanation">trigger</Tooltip>);
    const wrapper = screen.getByText("trigger");

    stubBubbleSize(200, 20);
    // Near the viewport top: 10 - 6 - 20 < 8, so the bubble must flip below.
    stubTriggerRect(wrapper, { top: 10, bottom: 26, left: 100, right: 160 });
    await user.hover(wrapper);

    const tip = screen.getByRole("tooltip");
    expect(tip.style.top).toBe("32px"); // bottom(26) + gap(6)
    expect(tip.style.left).toBe("30px"); // center(130) - width/2(100)

    // The trigger scrolls down; the bubble returns to its preferred side.
    stubTriggerRect(wrapper, { top: 300, bottom: 316, left: 100, right: 160 });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(tip.style.top).toBe("274px"); // top(300) - gap(6) - height(20)
  });

  it("re-clamps to the viewport edge when the window shrinks", async () => {
    const user = userEvent.setup();
    const originalWidth = window.innerWidth;
    render(<Tooltip content="An explanation">trigger</Tooltip>);
    const wrapper = screen.getByText("trigger");

    stubBubbleSize(200, 20);
    stubTriggerRect(wrapper, { top: 300, bottom: 316, left: 200, right: 260 });
    await user.hover(wrapper);

    const tip = screen.getByRole("tooltip");
    expect(tip.style.left).toBe("130px"); // center(230) - width/2(100), plenty of room

    Object.defineProperty(window, "innerWidth", { value: 300, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(tip.style.left).toBe("92px"); // clamped: 300 - pad(8) - width(200)

    Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true });
  });

  it("stops listening once closed", async () => {
    const user = userEvent.setup();
    render(<Tooltip content="An explanation">trigger</Tooltip>);
    const wrapper = screen.getByText("trigger");

    await user.hover(wrapper);
    await user.unhover(wrapper);

    // A later scroll must not crash or resurrect the bubble.
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("computeBubblePosition", () => {
  const VIEWPORT = { viewportWidth: 1000, viewportHeight: 800 } as const;
  const BUBBLE = { bubbleWidth: 200, bubbleHeight: 40 } as const;

  function trigger(rect: { top: number; bottom: number; left: number; right: number }) {
    return { ...rect, width: rect.right - rect.left };
  }

  it("centers above the trigger when there is room", () => {
    const pos = computeBubblePosition({
      trigger: trigger({ top: 400, bottom: 420, left: 450, right: 550 }),
      side: "top",
      align: "center",
      ...BUBBLE,
      ...VIEWPORT,
    });
    expect(pos).toEqual({ top: 400 - 6 - 40, left: 500 - 100 });
  });

  it("aligns to the trigger's start and end edges", () => {
    const t = trigger({ top: 400, bottom: 420, left: 450, right: 550 });
    const start = computeBubblePosition({
      trigger: t,
      side: "top",
      align: "start",
      ...BUBBLE,
      ...VIEWPORT,
    });
    const end = computeBubblePosition({
      trigger: t,
      side: "top",
      align: "end",
      ...BUBBLE,
      ...VIEWPORT,
    });
    expect(start.left).toBe(450);
    expect(end.left).toBe(550 - 200);
  });

  it("clamps at the left and right viewport edges", () => {
    const nearLeft = computeBubblePosition({
      trigger: trigger({ top: 400, bottom: 420, left: 0, right: 40 }),
      side: "top",
      align: "center",
      ...BUBBLE,
      ...VIEWPORT,
    });
    expect(nearLeft.left).toBe(8);

    const nearRight = computeBubblePosition({
      trigger: trigger({ top: 400, bottom: 420, left: 960, right: 1000 }),
      side: "top",
      align: "center",
      ...BUBBLE,
      ...VIEWPORT,
    });
    expect(nearRight.left).toBe(1000 - 8 - 200);
  });

  it("flips to the other side when the preferred side has no room", () => {
    const flippedDown = computeBubblePosition({
      trigger: trigger({ top: 10, bottom: 30, left: 450, right: 550 }),
      side: "top",
      align: "center",
      ...BUBBLE,
      ...VIEWPORT,
    });
    expect(flippedDown.top).toBe(30 + 6);

    const flippedUp = computeBubblePosition({
      trigger: trigger({ top: 770, bottom: 790, left: 450, right: 550 }),
      side: "bottom",
      align: "center",
      ...BUBBLE,
      ...VIEWPORT,
    });
    expect(flippedUp.top).toBe(770 - 6 - 40);
  });

  it("keeps the preferred side when both sides fit", () => {
    const t = trigger({ top: 400, bottom: 420, left: 450, right: 550 });
    const top = computeBubblePosition({
      trigger: t,
      side: "top",
      align: "center",
      ...BUBBLE,
      ...VIEWPORT,
    });
    const bottom = computeBubblePosition({
      trigger: t,
      side: "bottom",
      align: "center",
      ...BUBBLE,
      ...VIEWPORT,
    });
    expect(top.top).toBe(400 - 6 - 40);
    expect(bottom.top).toBe(420 + 6);
  });

  it("falls back to the preferred side when neither side fits", () => {
    const tiny = { viewportWidth: 1000, viewportHeight: 50 } as const;
    const t = trigger({ top: 20, bottom: 30, left: 450, right: 550 });
    const top = computeBubblePosition({
      trigger: t,
      side: "top",
      align: "center",
      ...BUBBLE,
      ...tiny,
    });
    const bottom = computeBubblePosition({
      trigger: t,
      side: "bottom",
      align: "center",
      ...BUBBLE,
      ...tiny,
    });
    expect(top.top).toBe(20 - 6 - 40);
    expect(bottom.top).toBe(30 + 6);
  });

  it("property: never overlaps the trigger, stays clamped horizontally, and stays fully visible whenever any side fits", () => {
    const PAD = 8;
    const GAP = 6;
    fc.assert(
      fc.property(
        fc.record({
          top: fc.integer({ min: -200, max: 1000 }),
          height: fc.integer({ min: 0, max: 100 }),
          left: fc.integer({ min: -200, max: 1200 }),
          width: fc.integer({ min: 0, max: 300 }),
        }),
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 200 }),
        fc.constantFrom("top" as const, "bottom" as const),
        fc.constantFrom("center" as const, "start" as const, "end" as const),
        (t, bubbleWidth, bubbleHeight, side, align) => {
          const viewportWidth = 1024;
          const viewportHeight = 768;
          const rect = {
            top: t.top,
            bottom: t.top + t.height,
            left: t.left,
            right: t.left + t.width,
            width: t.width,
          };
          const pos = computeBubblePosition({
            trigger: rect,
            bubbleWidth,
            bubbleHeight,
            side,
            align,
            viewportWidth,
            viewportHeight,
          });

          // Horizontal containment (the bubble is never wider than the viewport minus padding here).
          expect(pos.left).toBeGreaterThanOrEqual(PAD);
          expect(pos.left + bubbleWidth).toBeLessThanOrEqual(viewportWidth - PAD);

          // The bubble sits fully on one side of the trigger, gap included.
          const above = pos.top + bubbleHeight <= rect.top - GAP;
          const below = pos.top >= rect.bottom + GAP;
          expect(above || below).toBe(true);

          // Fully visible whenever at least one side allows it; otherwise no
          // placement could have worked and escaping the viewport is expected.
          const visibleAt = (top: number) => top >= 0 && top + bubbleHeight <= viewportHeight;
          const placedVisible = visibleAt(pos.top);
          if (!placedVisible) {
            expect(visibleAt(rect.top - GAP - bubbleHeight)).toBe(false);
            expect(visibleAt(rect.bottom + GAP)).toBe(false);
          }
        },
      ),
    );
  });
});

describe("InfoTip", () => {
  it("renders a help button with an accessible name", () => {
    render(<InfoTip label='About "Returned to you"' content="Excess tokens come back to you." />);
    expect(screen.getByRole("button", { name: 'About "Returned to you"' })).toBeInTheDocument();
  });

  it("reveals its content on hover", async () => {
    const user = userEvent.setup();
    render(<InfoTip label="About fees" content="Fees go to LPs." />);

    await user.hover(screen.getByRole("button", { name: "About fees" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Fees go to LPs.");
  });

  it("is reachable and readable by keyboard alone", async () => {
    const user = userEvent.setup();
    render(<InfoTip label="About fees" content="Fees go to LPs." />);

    await user.tab();
    const button = screen.getByRole("button", { name: "About fees" });
    expect(button).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Fees go to LPs.");
    expect(button).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not submit surrounding forms when tapped", async () => {
    const user = userEvent.setup();
    let submitted = false;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted = true;
        }}
      >
        <InfoTip label="About fees" content="Fees go to LPs." />
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "About fees" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(submitted).toBe(false);
  });

  it("portals its bubble to the body as well", async () => {
    const user = userEvent.setup();
    render(<InfoTip label="About fees" content="Fees go to LPs." />);

    await user.hover(screen.getByRole("button", { name: "About fees" }));
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
  });
});
