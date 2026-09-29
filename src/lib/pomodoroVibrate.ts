/** Short double pulse when a pomodoro segment ends (Android WebView Vibration API). */
const END_PATTERN = [0, 140, 90, 140];

export function vibratePomodoroEnd(): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(END_PATTERN);
  } catch {
    // ignore unsupported or denied vibration
  }
}
