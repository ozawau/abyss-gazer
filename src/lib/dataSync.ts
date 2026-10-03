import { isSyncCancelled, preemptDataSync, runDataSync } from "./api";
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
let pendingAfterFlight = false;

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

function requestSyncRestartWhileInFlight() {
  pendingAfterFlight = true;
  void preemptDataSync();
}

export async function runSyncCycle(): Promise<void> {
  if (!syncEnabled) return;
  if (inFlight) {
    requestSyncRestartWhileInFlight();
    return;
  }
  inFlight = true;
  try {
    do {
      pendingAfterFlight = false;
      await runDataSync();
      await afterSuccess?.();
    } while (pendingAfterFlight);
    showSyncResultToast(messages.success, true);
  } catch (err) {
    if (isSyncCancelled(err)) {
      return;
    }
    showSyncResultToast(messages.failure(String(err)), false);
  } finally {
    inFlight = false;
    if (pendingAfterFlight) {
      pendingAfterFlight = false;
      void runSyncCycle();
    }
  }
}
