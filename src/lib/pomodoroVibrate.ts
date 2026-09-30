import { invoke } from "@tauri-apps/api/core";
import { isAndroidDevice } from "./viewport";

/** Short double pulse when a pomodoro segment ends. */
const END_PATTERN = [0, 140, 90, 140];

export function vibratePomodoroEnd(): void {
  if (isAndroidDevice()) {
    void invoke("pomodoro_vibrate_end").catch(() => {});
    return;
  }
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(END_PATTERN);
  } catch {
    // ignore unsupported or denied vibration
  }
}
