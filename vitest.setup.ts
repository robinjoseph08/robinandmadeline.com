import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";

// Mock ResizeObserver, which jsdom does not implement but some UI components use.
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom omits these Element methods that Radix UI (Select, Dialog) calls during
// pointer interactions and focus management. Stub them so those components are
// testable; they are no-ops that only need to exist.
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

afterEach(() => {
  cleanup();
});
