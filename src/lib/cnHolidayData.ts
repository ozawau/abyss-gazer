import bundledCnDays from "chinese-days/dist/chinese-days.json";
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

/** chinese-days 官方 JSON（与 npm 包同源，jsDelivr 分发） */
const CDN_CHINESE_DAYS_JSON =
  "https://cdn.jsdelivr.net/npm/chinese-days/dist/chinese-days.json";

export interface CnDaysTables {
  holidays: Record<string, string>;
  workdays: Record<string, string>;
  inLieuDays: Record<string, string>;
}

interface CacheFileV1 {
  version: 1;
  updatedAt: string;
  chineseDays: CnDaysTables;
}

type StringMap = Record<string, string>;

let active: CnDaysTables = bundledTables();
let initStarted = false;
let revision = 0;
const listeners = new Set<() => void>();

function emptyTables(): CnDaysTables {
  return { holidays: {}, workdays: {}, inLieuDays: {} };
}

function bumpRevision(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

function mergeMaps(...maps: StringMap[]): StringMap {
  return Object.assign({}, ...maps);
}

function normalizeTables(raw: Partial<CnDaysTables> | null | undefined): CnDaysTables {
  if (!raw) return emptyTables();
  return {
    holidays: { ...raw.holidays },
    workdays: { ...raw.workdays },
    inLieuDays: { ...raw.inLieuDays },
  };
}

function mergeTables(...layers: CnDaysTables[]): CnDaysTables {
  return {
    holidays: mergeMaps(...layers.map((l) => l.holidays)),
    workdays: mergeMaps(...layers.map((l) => l.workdays)),
    inLieuDays: mergeMaps(...layers.map((l) => l.inLieuDays)),
  };
}

function hasYearInTables(tables: CnDaysTables, year: number): boolean {
  const prefix = `${year}-`;
  const inMap = (map: StringMap) =>
    Object.keys(map).some((key) => key.startsWith(prefix));
  return (
    inMap(tables.holidays) || inMap(tables.workdays) || inMap(tables.inLieuDays)
  );
}

function bundledTables(): CnDaysTables {
  return normalizeTables(bundledCnDays as Partial<CnDaysTables>);
}

function applyTables(next: CnDaysTables): void {
  active = next;
  bumpRevision();
}

async function readCacheTables(): Promise<CnDaysTables | null> {
  try {
    const raw = await invoke<string | null>("read_cn_holidays_cache");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheFileV1;
    if (parsed.version !== 1 || !parsed.chineseDays) return null;
    return normalizeTables(parsed.chineseDays);
  } catch {
    return null;
  }
}

async function writeCacheTables(tables: CnDaysTables): Promise<void> {
  const payload: CacheFileV1 = {
    version: 1,
    updatedAt: new Date().toISOString(),
    chineseDays: tables,
  };
  try {
    await invoke("write_cn_holidays_cache", { json: JSON.stringify(payload) });
  } catch {
    /* 缓存失败不影响使用 */
  }
}

async function fetchRemoteTables(): Promise<CnDaysTables | null> {
  try {
    const response = await fetch(CDN_CHINESE_DAYS_JSON, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const json = (await response.json()) as Partial<CnDaysTables>;
    return normalizeTables(json);
  } catch {
    return null;
  }
}

/** 启动时：内置包 → 本地缓存 →（后台）CDN；CDN 缺少年份时仍保留缓存中的该年。 */
export function initCnHolidayData(): void {
  if (initStarted) return;
  initStarted = true;

  void (async () => {
    const bundled = bundledTables();
    const cache = await readCacheTables();
    applyTables(mergeTables(bundled, cache ?? emptyTables()));

    const remote = await fetchRemoteTables();
    if (!remote) return;

    const year = new Date().getFullYear();
    const remoteHasCurrentYear = hasYearInTables(remote, year);

    if (remoteHasCurrentYear) {
      const merged = mergeTables(bundled, cache ?? emptyTables(), remote);
      applyTables(merged);
      await writeCacheTables(merged);
      return;
    }

    // CDN 尚未包含当前年：继续用缓存（及内置）中的当前年数据
    const merged = mergeTables(bundled, cache ?? emptyTables(), remote);
    applyTables(merged);
    if (hasYearInTables(merged, year)) {
      await writeCacheTables(merged);
    }
  })();
}

export function getCnHolidayTables(): CnDaysTables {
  return active;
}

export function useCnHolidayRevision(): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => revision,
    () => revision,
  );
}
