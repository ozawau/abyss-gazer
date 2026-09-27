export const ANDROID_BACK_EVENT = "abyss-android-back";

export type AndroidBackResult = "handled" | "exit";

declare global {
  interface Window {
    __abyssHandleBack?: () => AndroidBackResult;
  }
}
