import { runDataSync } from "./api";
import { showSyncResultToast } from "./syncToast";
import { registerSyncOnChangeTrigger } from "./syncOnChange";

type SyncMessages = {
  success: string;
  failure: (detail: string) => string;
};

let syncEnabled = false;
let messages: SyncMessages = { success: "Sync OK", failure: (d) => d };
let afterSuccess: (() => Promise<void>) | null = null;
let debounceId = 0;
let inFlight = false;

export function configureDataSync(options: {
  syncEnabled: boolean;
  syncOnDataChange: boolean;
  messages: SyncMessages;
  afterSuccess: () => Promise<void>;
}) {
  syncEnabled = options.syncEnabled;
  messages = options.messages;
  afterSuccess = options.afterSuccess;
  if (options.syncEnabled && options.syncOnDataChange) {
    registerSyncOnChangeTrigger(() => {
      window.clearTimeout(debounceId);
      debounceId = window.setTimeout(() => {
        void runSyncCycle();
      }, 800);
    });
  } else {
    registerSyncOnChangeTrigger(null);
  }
}

export async function runSyncCycle(): Promise<void> {
  if (!syncEnabled || inFlight) return;
  inFlight = true;
  try {
    await runDataSync();
    await afterSuccess?.();
    showSyncResultToast(messages.success, true);
  } catch (err) {
    showSyncResultToast(messages.failure(String(err)), false);
  } finally {
    inFlight = false;
  }
}
