import { readSoundFile } from "./api";
import { readStoredLanguage, resolveLocale, translate } from "./i18n";

export const SILENT_SOUND = "none";

const BEEP_HZ = 1174;
const BEEP_MS = 70;
const GAP_MS = 80;
const GAIN = 0.18;

let audioCtx: AudioContext | null = null;
const soundCache = new Map<string, AudioBuffer>();

export function isSilentSound(path: string | null | undefined): boolean {
  return path === SILENT_SOUND;
}

export function isCustomSound(path: string | null | undefined): boolean {
  return !!path && path !== SILENT_SOUND;
}

function context(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new Ctor();
  }
  return audioCtx;
}

function scheduleBeep(ctx: AudioContext, startAt: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(BEEP_HZ, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(GAIN, startAt + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + BEEP_MS / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + BEEP_MS / 1000 + 0.01);
}

async function playDefaultBeeps(count: number): Promise<void> {
  const ctx = context();
  if (!ctx) return;
  await ctx.resume();
  const now = ctx.currentTime + 0.01;
  for (let i = 0; i < count; i += 1) {
    scheduleBeep(ctx, now + (i * (BEEP_MS + GAP_MS)) / 1000);
  }
}

async function decodeSound(path: string): Promise<AudioBuffer> {
  const cached = soundCache.get(path);
  if (cached) return cached;
  const ctx = context();
  if (!ctx) {
    throw new Error(translate(resolveLocale(readStoredLanguage()), "audioUnsupported"));
  }
  const bytes = await readSoundFile(path);
  const copy = Uint8Array.from(bytes).buffer;
  const buffer = await ctx.decodeAudioData(copy);
  soundCache.set(path, buffer);
  return buffer;
}

async function playCustomSound(path: string): Promise<void> {
  const ctx = context();
  if (!ctx) return;
  await ctx.resume();
  const buffer = await decodeSound(path);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}

export function forgetCachedSound(path: string | null | undefined) {
  if (path) soundCache.delete(path);
}

/** Built-in beeps, a custom mp3/wav, or silence when set to none. */
export async function playPomodoroEndChime(
  endedPhase: "focus" | "break",
  customPath?: string | null,
  options?: { fallbackToDefault?: boolean },
): Promise<void> {
  if (isSilentSound(customPath)) return;
  if (customPath && isCustomSound(customPath)) {
    try {
      await playCustomSound(customPath);
      return;
    } catch (err) {
      if (options?.fallbackToDefault === false) throw err;
    }
  }
  await playDefaultBeeps(endedPhase === "break" ? 2 : 1);
}
