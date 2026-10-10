// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardView } from "./CardView";

type PointerTestEvent = "pointerdown" | "pointermove" | "pointerup" | "pointercancel";

function pointer(target: HTMLElement, name: PointerTestEvent, x: number, y: number, id = 7) {
  const event = new Event(name, { bubbles: true });
  Object.defineProperties(event, {
    pointerId: { value: id },
    pointerType: { value: "mouse" },
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: y },
    shiftKey: { value: false },
  });
  act(() => target.dispatchEvent(event));
}

describe("CardView opt-in drop-only native movement", () => {
  let container: HTMLDivElement;
  let root: Root;
  const pointerCaptureDescriptors = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    for (const key of ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"]) {
      pointerCaptureDescriptors.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    }
    // happy-dom does not expose pointer capture on all element versions.
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true, value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true, value: () => true,
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true, value: vi.fn(),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    for (const key of ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"]) {
      const descriptor = pointerCaptureDescriptors.get(key);
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, key, descriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, key);
      }
    }
    pointerCaptureDescriptors.clear();
  });

  function renderCard(onMove = vi.fn(), onCommitMove?: (id: string, dx: number, dy: number) => void, zoom = 1) {
    act(() => {
      root.render(createElement(CardView, {
        card: { id: "c1", text: "card", x: 10, y: 20 },
        isSelected: false,
        onMove,
        onCommitMove,
        dragPreviewZoom: zoom,
        onSelect: vi.fn(),
      }));
    });
    const card = container.querySelector<HTMLElement>('[data-card-id="c1"]');
    if (!card) throw new Error("missing card");
    return card;
  }

  it("keeps pointermove local and commits final movement once on pointerup", () => {
    const onMove = vi.fn();
    const onCommitMove = vi.fn();
    const card = renderCard(onMove, onCommitMove);

    pointer(card, "pointerdown", 100, 120);
    pointer(card, "pointermove", 110, 124);
    pointer(card, "pointermove", 126, 130);
    expect(onMove).not.toHaveBeenCalled();
    expect(onCommitMove).not.toHaveBeenCalled();
    expect(card.style.transform).toContain("translate(26px, 10px)");

    pointer(card, "pointerup", 130, 132);
    expect(onCommitMove).toHaveBeenCalledTimes(1);
    expect(onCommitMove).toHaveBeenCalledWith("c1", 30, 12, undefined);
    expect(onMove).not.toHaveBeenCalled();
    expect(card.style.transform).toBe("");
  });

  it("compensates for Canvas zoom while preserving final screen delta", () => {
    const onCommitMove = vi.fn();
    const card = renderCard(vi.fn(), onCommitMove, 2);
    pointer(card, "pointerdown", 10, 20);
    pointer(card, "pointermove", 36, 30);
    // Parent Canvas scales children by 2; child translates by half
    // to follow the actual pointer displacement on screen.
    expect(card.style.transform).toContain("translate(13px, 5px)");
    pointer(card, "pointerup", 36, 30);
    expect(onCommitMove).toHaveBeenCalledWith("c1", 26, 10, undefined);
  });

  it("forwards the pointerdown origin rather than a later application snapshot", () => {
    const origin = { documentID: "doc", expectedRevision: "r1" };
    const onCommitMove = vi.fn();
    let rootCard: HTMLElement;
    act(() => {
      root.render(createElement(CardView, {
        card: { id: "c1", text: "card", x: 10, y: 20 },
        isSelected: false,
        onMove: vi.fn(),
        onBeginMove: () => origin,
        onCommitMove,
        onSelect: vi.fn(),
      }));
    });
    const card = container.querySelector<HTMLElement>('[data-card-id="c1"]');
    if (!card) throw new Error("missing card");
    rootCard = card;
    pointer(rootCard, "pointerdown", 10, 10);
    origin.expectedRevision = "r2";
    pointer(rootCard, "pointermove", 30, 10);
    pointer(rootCard, "pointerup", 30, 10);
    expect(onCommitMove).toHaveBeenCalledOnce();
    expect(onCommitMove.mock.calls[0][3]).toBe(origin);
  });

  it("pointercancel reverts preview without sending a commit", () => {
    const onCommitMove = vi.fn();
    const onMove = vi.fn();
    const card = renderCard(onMove, onCommitMove);
    pointer(card, "pointerdown", 10, 10);
    pointer(card, "pointermove", 40, 50);
    expect(card.style.transform).toContain("translate(30px, 40px)");
    pointer(card, "pointercancel", 40, 50);
    expect(card.style.transform).toBe("");
    expect(onMove).not.toHaveBeenCalled();
    expect(onCommitMove).not.toHaveBeenCalled();
  });

  it("ignores pointer events belonging to another pointer", () => {
    const onMove = vi.fn();
    const onCommitMove = vi.fn();
    const card = renderCard(onMove, onCommitMove);
    pointer(card, "pointerdown", 10, 10, 7);
    pointer(card, "pointermove", 40, 50, 8);
    pointer(card, "pointerup", 40, 50, 8);
    expect(onMove).not.toHaveBeenCalled();
    expect(onCommitMove).not.toHaveBeenCalled();
    pointer(card, "pointercancel", 10, 10, 7);
  });

  it("preserves existing pointermove behavior without an opt-in callback", () => {
    const onMove = vi.fn();
    const card = renderCard(onMove);
    pointer(card, "pointerdown", 10, 10);
    pointer(card, "pointermove", 15, 18);
    expect(onMove).toHaveBeenCalledWith("c1", 5, 8);
    pointer(card, "pointerup", 15, 18);
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});
