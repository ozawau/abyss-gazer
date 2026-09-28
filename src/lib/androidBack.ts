import { useEffect, useRef, type RefObject } from "react";
import { isAndroidDevice } from "./viewport";

export const ANDROID_BACK_EVENT = "abyss-android-back";

export type AndroidBackResult = "handled" | "exit";

declare global {
  interface Window {
    __abyssHandleBack?: () => AndroidBackResult;
  }
}

interface BackLayer {
  close: () => void;
  node: () => HTMLElement | null;
}

const layers: BackLayer[] = [];

function isShown(el: HTMLElement): boolean {
  if (el.closest(".view-slot.is-hidden")) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

/** Close the topmost visible popup. Nested layers close before the one behind them. */
export function dismissTopAndroidPopup(): boolean {
  const shown = layers.filter((layer) => {
    const el = layer.node();
    return el != null && el.isConnected && isShown(el);
  });
  const leaves = shown.filter((layer) => {
    const el = layer.node();
    if (!el) return false;
    return !shown.some((other) => {
      const otherEl = other.node();
      return otherEl != null && otherEl !== el && el.contains(otherEl);
    });
  });
  if (leaves.length === 0) return false;
  leaves.sort((a, b) => {
    const aEl = a.node();
    const bEl = b.node();
    if (!aEl || !bEl) return 0;
    const pos = aEl.compareDocumentPosition(bEl);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  leaves[leaves.length - 1]!.close();
  return true;
}

/** Register a visible popup so the Android back button dismisses it. */
export function useDismissOnAndroidBack(
  active: boolean,
  dismiss: () => void,
  nodeRef: RefObject<HTMLElement | null>,
) {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    if (!active || !isAndroidDevice()) return;
    const layer: BackLayer = {
      close: () => dismissRef.current(),
      node: () => nodeRef.current,
    };
    layers.push(layer);
    return () => {
      const index = layers.lastIndexOf(layer);
      if (index >= 0) layers.splice(index, 1);
    };
  }, [active, nodeRef]);
}
