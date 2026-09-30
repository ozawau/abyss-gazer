import { isAndroidDevice } from "./viewport";

let onLocalMutation: (() => void) | null = null;

export function registerSyncOnChangeTrigger(trigger: (() => void) | null) {
  onLocalMutation = trigger;
}

export function notifyLocalDataChanged(): void {
  if (isAndroidDevice()) return;
  onLocalMutation?.();
}
