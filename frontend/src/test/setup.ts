import "@testing-library/jest-dom/vitest";
import { format } from "node:util";
import { afterEach } from "vitest";

// A clean console is part of the contract: React logs act() warnings,
// hydration mismatches, duplicate keys and invalid DOM props through
// console.error/warn, and each of those is a bug. Any unexpected output fails
// the test that produced it. A test that provokes an error on purpose silences
// it explicitly with `vi.spyOn(console, "error").mockImplementation(() => {})`.
const unexpectedConsole: string[] = [];
for (const level of ["error", "warn"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    unexpectedConsole.push(`console.${level}: ${format(...args)}`);
    original(...args);
  };
}
afterEach(() => {
  const logged = unexpectedConsole.splice(0);
  if (logged.length > 0) {
    throw new Error(`Unexpected console output (fix the cause, or silence it deliberately):\n${logged.join("\n")}`);
  }
});

// jsdom lacks these browser APIs used by animation / observer code paths.
if (typeof window !== "undefined") {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  window.IntersectionObserver ??= class {
    root = null;
    rootMargin = "";
    thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;

  Element.prototype.scrollIntoView ??= () => {};
}
