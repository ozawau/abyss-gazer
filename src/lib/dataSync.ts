import { isSyncCancelled, preemptDataSync, runDataSync } from "./api";
import { showSyncResultToast } from "./syncToast";
import { registerSyncOnChangeTrigger } from "./syncOnChange";

type SyncMessages = {
  success: string;
  failure: (detail: string) => string;
  stopped: string;
  disabled: string;
};

let syncEnabled = false;
let messages: SyncMessages = {
  success: "Sync OK",
  failure: (d) => d,
  stopped: "Sync stopped",
  disabled: "Turn on sync in Settings first",
};
let afterSuccess: (() => Promise<void>) | null = null;
let debounceId = 0;
let inFlight = false;
let pendingAfterFlight = false;
let userCancel = false;
const syncListeners = new Set<(syncing: boolean) => void>();

function publishSyncing() {
  for (const listener of syncListeners) listener(inFlight);
}

export function subscribeSyncActivity(
  listener: (syncing: boolean) => void,
): () => void {
  syncListeners.add(listener);
  listener(inFlight);
  return () => {
    syncListeners.delete(listener);
  };
}

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

/** Start a sync immediately, including one the user requested from the sidebar. */
export function requestManualSync() {
  window.clearTimeout(debounceId);
  if (!syncEnabled) {
    showSyncResultToast(messages.disabled, false);
    return;
  }
  void runSyncCycle();
}

/** Stop the in-flight sync and do not queue another run. */
export function cancelActiveSync() {
  if (!inFlight) return;
  userCancel = true;
  pendingAfterFlight = false;
  window.clearTimeout(debounceId);
  void preemptDataSync();
}

export async function runSyncCycle(): Promise<void> {
  if (!syncEnabled) return;
  if (inFlight) {
    requestSyncRestartWhileInFlight();
    return;
  }
  inFlight = true;
  publishSyncing();
  try {
    do {
      pendingAfterFlight = false;
      await runDataSync();
      await afterSuccess?.();
    } while (pendingAfterFlight && !userCancel);
    if (userCancel) {
      showSyncResultToast(messages.stopped, false);
      return;
    }
    showSyncResultToast(messages.success, true);
  } catch (err) {
    if (isSyncCancelled(err)) {
      if (userCancel) showSyncResultToast(messages.stopped, false);
      return;
    }
    showSyncResultToast(messages.failure(String(err)), false);
  } finally {
    inFlight = false;
    const restart = pendingAfterFlight && !userCancel;
    userCancel = false;
    pendingAfterFlight = false;
    publishSyncing();
    if (restart) void runSyncCycle();
  }
}
