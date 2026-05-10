import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver, which react-chessboard uses to size the board. A no-op
// stub is enough for tests (we don't care about pixel sizes — only that squares render in the DOM).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom always returns a zero-sized layout; react-chessboard reads square widths via
// getBoundingClientRect() and throws if it gets 0. Give every element a fixed non-zero box.
const FAKE_BOX = { x: 0, y: 0, top: 0, left: 0, right: 480, bottom: 480, width: 480, height: 480 };
Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  return { ...FAKE_BOX, toJSON: () => FAKE_BOX } as DOMRect;
};
