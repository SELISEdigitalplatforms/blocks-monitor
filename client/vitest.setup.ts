import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Ensure the DOM is reset between tests.
afterEach(() => {
  cleanup();
});

// Node's experimental global `localStorage` (which needs --localstorage-file)
// can shadow jsdom's usable implementation. Install a deterministic in-memory
// Storage on both window and globalThis so app code and tests agree.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

const memoryStorage = new MemoryStorage();
const defineStorage = (target: object) => {
  Object.defineProperty(target, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
};
if (typeof window !== "undefined") defineStorage(window);
defineStorage(globalThis);

// Radix UI primitives rely on a handful of browser APIs jsdom omits.
if (typeof window !== "undefined") {
  if (!("ResizeObserver" in window)) {
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserver;
  }
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
    window.HTMLElement.prototype.setPointerCapture = () => {};
    window.HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
}

// jsdom does not implement matchMedia; several hooks/components depend on it.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
