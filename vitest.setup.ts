import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";

// Mock ResizeObserver, which jsdom does not implement but some UI components use.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
});
