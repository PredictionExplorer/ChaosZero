"use client";

import { CircleQuestionMark } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom";
type Align = "center" | "start" | "end";

/** Gap between the trigger and the bubble, px. */
const GAP = 6;
/** Minimum distance the bubble keeps from the viewport edges, px. */
const PAD = 8;

/** `useLayoutEffect` warns during SSR; the measurement only matters on the client. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface BubblePosition {
  readonly top: number;
  readonly left: number;
}

/**
 * Pure placement math: where the bubble's top-left corner goes, in viewport
 * coordinates. Clamps horizontally so the bubble never bleeds off-screen and
 * flips to the other side when the preferred side has no room. Exported for
 * direct geometry testing.
 */
export function computeBubblePosition(args: {
  trigger: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width">;
  bubbleWidth: number;
  bubbleHeight: number;
  side: Side;
  align: Align;
  viewportWidth: number;
  viewportHeight: number;
}): BubblePosition {
  const { trigger, bubbleWidth, bubbleHeight, side, align, viewportWidth, viewportHeight } = args;

  const anchorX =
    align === "center"
      ? trigger.left + trigger.width / 2
      : align === "start"
        ? trigger.left
        : trigger.right;
  const desiredLeft =
    align === "center"
      ? anchorX - bubbleWidth / 2
      : align === "start"
        ? anchorX
        : anchorX - bubbleWidth;
  const maxLeft = Math.max(PAD, viewportWidth - PAD - bubbleWidth);
  const left = Math.min(Math.max(desiredLeft, PAD), maxLeft);

  // A side "fits" when the bubble would be fully visible there. Triggers can
  // themselves sit partially outside the viewport (mid-scroll), so both edges
  // of the candidate position matter, not just the far one.
  const aboveTop = trigger.top - GAP - bubbleHeight;
  const belowTop = trigger.bottom + GAP;
  const visibleAt = (top: number) => top >= 0 && top + bubbleHeight <= viewportHeight;
  const fitsAbove = visibleAt(aboveTop);
  const fitsBelow = visibleAt(belowTop);
  // Honor the requested side; flip only when it doesn't fit and the other does.
  const placeAbove = side === "top" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;

  return { top: placeAbove ? aboveTop : belowTop, left };
}

export type TooltipProps = Omit<HTMLAttributes<HTMLSpanElement>, "content"> & {
  /** The explanation shown in the bubble. */
  content: ReactNode;
  /** Which side of the trigger the bubble opens on (flips when out of room). */
  side?: Side;
  /** How the bubble aligns to the trigger along the horizontal axis. */
  align?: Align;
  /**
   * Keep the default (0) when wrapping plain text or icons so keyboard users
   * can reach the tooltip. Pass -1 when the child is already focusable
   * (button, link): its focus bubbles up and still opens the tooltip, and the
   * `aria-describedby` moves onto the child instead of the wrapper.
   */
  tabIndex?: number;
};

/**
 * A dependency-free tooltip in the app's cosmic style. Opens on hover and
 * keyboard focus, on tap on touch devices; closes on Escape, blur, unhover,
 * or an outside tap.
 *
 * The bubble renders in a portal on `document.body` with `position: fixed`.
 * It must escape the trigger's DOM subtree: the app's cards use
 * `backdrop-blur`, which makes each card a stacking context, so an in-card
 * bubble paints BELOW any later-DOM card and the sticky header no matter its
 * z-index. At body level the bubble competes in the root stacking context and
 * `z-[60]` puts it above everything (header z-20, menus z-40, modal z-50).
 */
export function Tooltip({
  content,
  side = "top",
  align = "center",
  tabIndex = 0,
  className = "",
  children,
  ...rest
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  /** Null until the bubble has been measured; it stays invisible that frame. */
  const [pos, setPos] = useState<BubblePosition | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = rootRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const next = computeBubblePosition({
      trigger: trigger.getBoundingClientRect(),
      bubbleWidth: bubble.offsetWidth,
      bubbleHeight: bubble.offsetHeight,
      side,
      align,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [side, align]);

  // Measure and place before paint, so the bubble never flashes unpositioned.
  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  // Stay glued to the trigger while anything scrolls or the window resizes.
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener("scroll", handler, { capture: true, passive: true });
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, { capture: true });
      window.removeEventListener("resize", handler);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const describedBy = open ? id : undefined;
  // When the child is the focusable trigger, the description belongs on it.
  const child =
    tabIndex < 0 && isValidElement(children)
      ? cloneElement(children as ReactElement<HTMLAttributes<HTMLElement>>, {
          "aria-describedby": describedBy,
        })
      : children;

  const bubbleStyle: CSSProperties = pos
    ? { top: pos.top, left: pos.left }
    : { visibility: "hidden" };

  return (
    <span
      ref={rootRef}
      {...rest}
      tabIndex={tabIndex < 0 ? undefined : tabIndex}
      aria-describedby={tabIndex < 0 ? undefined : describedBy}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onClick={() => setOpen(true)}
    >
      {child}
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            role="tooltip"
            id={id}
            style={bubbleStyle}
            className={[
              "pointer-events-none fixed z-[60] w-max max-w-64",
              "rounded-xl border border-line-strong bg-surface-2 px-3 py-2",
              "text-left font-sans text-[11px] font-normal normal-case leading-relaxed tracking-normal whitespace-normal text-ink-dim",
              "shadow-[0_12px_32px_rgba(2,0,16,0.7)]",
            ].join(" ")}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}

export interface InfoTipProps {
  /** Accessible name for the trigger, e.g. `About "Returned to you"`. */
  label: string;
  content: ReactNode;
  side?: Side;
  align?: Align;
  className?: string;
  iconClassName?: string;
}

/**
 * A small "?" button that reveals an explanation — the standard way to
 * annotate a label. Renders a real button so it is tabbable, tappable, and
 * announced with `label`.
 */
export function InfoTip({
  label,
  content,
  side,
  align,
  className = "",
  iconClassName = "size-3.5",
}: InfoTipProps) {
  return (
    <Tooltip content={content} side={side} align={align} tabIndex={-1} className={className}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex cursor-help items-center justify-center rounded-full text-ink-faint transition-colors hover:text-signal-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <CircleQuestionMark className={iconClassName} aria-hidden />
      </button>
    </Tooltip>
  );
}
