// Runs before every test file of the web project.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount what a test rendered, so tests cannot see one another's markup.
afterEach(() => {
  cleanup();
});

// jsdom does not implement a few browser features that Radix primitives call. These stand-ins
// do nothing, which is enough for tests that check structure and keyboard behaviour. Anything
// that depends on real layout or pointer capture belongs in an end-to-end test.
const elementPrototype = window.Element.prototype;
elementPrototype.hasPointerCapture ??= () => false;
elementPrototype.setPointerCapture ??= () => {};
elementPrototype.releasePointerCapture ??= () => {};
elementPrototype.scrollIntoView ??= () => {};

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
