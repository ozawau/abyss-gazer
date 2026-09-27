import { useEffect, useState } from "react";

const DESKTOP_NARROW_QUERY = "(max-width: 720px)";

// Foldable cover screens stay under this (Find N6 outer is about 351 CSS px
// on the short side). The inner screen is about 692 CSS px, which is under
// the desktop 720px breakpoint, so Android uses the short side instead.
const ANDROID_NARROW_MAX_SMALLEST_PX = 480;

export function isAndroidDevice(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function isNarrowViewport(): boolean {
  if (typeof window === "undefined") return false;
  if (isAndroidDevice()) {
    return Math.min(window.innerWidth, window.innerHeight) <= ANDROID_NARROW_MAX_SMALLEST_PX;
  }
  return window.matchMedia(DESKTOP_NARROW_QUERY).matches;
}

export function syncNarrowViewportClass(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("is-narrow", isNarrowViewport());
}

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(isNarrowViewport);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_NARROW_QUERY);
    const onChange = () => {
      syncNarrowViewportClass();
      setNarrow(isNarrowViewport());
    };
    onChange();
    media.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      media.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);

  return narrow;
}
