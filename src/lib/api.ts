import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  CaptureResult,
  Item,
  ItemPage,
  LibraryStats,
  SearchQuery,
  Settings,
  ReaderResource,
} from "../types";

const now = new Date().toISOString();
let mockItems: Item[] = [
  {
    id: "welcome-pdf",
    itemType: "pdf",
    title: "Island 产品计划",
    originalName: "island-plan.pdf",
    localPath: null,
    originalPath: "D:\\资料\\island-plan.pdf",
    mimeType: "application/pdf",
    fileSize: 2_480_000,
    contentHash: "preview",
    notes: "用于确认第一阶段范围与验收门槛。",
    plainText: null,
    status: "ready",
    isFavorite: true,
    storageMode: "managed",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  },
  {
    id: "welcome-text",
    itemType: "text",
    title: "随手放进去，以后找得到",
    sourceApp: "Island",
    notes: "",
    plainText:
      "Island 是一个安静、可靠的本地收藏入口。拖入文件，粘贴链接，或保存一段灵感；其余整理可以稍后再做。",
    status: "ready",
    isFavorite: false,
    storageMode: "managed",
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: now,
    deletedAt: null,
  },
  {
    id: "welcome-url",
    itemType: "url",
    title: "Tauri Documentation",
    sourceUrl: "https://v2.tauri.app/",
    mimeType: "text/html",
    notes: "桌面能力参考。",
    status: "ready",
    isFavorite: false,
    storageMode: "managed",
    createdAt: new Date(Date.now() - 172_800_000).toISOString(),
    updatedAt: now,
    deletedAt: null,
  },
];

export function runningInTauri() {
  return Boolean(
    (window as typeof window & {
      __TAURI_INTERNALS__?: { metadata?: unknown };
    }).__TAURI_INTERNALS__?.metadata,
  );
}

export async function listItems(search: SearchQuery): Promise<ItemPage> {
  if (runningInTauri()) return invoke("list_items", { search });
  const query = search.query?.trim().toLocaleLowerCase();
  const items = mockItems
    .filter((item) => Boolean(item.deletedAt) === Boolean(search.trashed))
    .filter((item) => !search.favorite || item.isFavorite)
    .filter((item) => !search.types?.length || search.types.includes(item.itemType))
    .filter(
      (item) =>
        !query ||
        [item.title, item.originalName, item.sourceUrl, item.notes, item.plainText]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(query),
    );
  return { items, total: items.length };
}

export async function captureFiles(paths: string[]): Promise<CaptureResult[]> {
  if (runningInTauri()) return invoke("capture_files", { paths });
  throw new Error("浏览器预览无法读取本地文件路径，请在 Tauri 桌面应用中测试拖放。");
}

export async function captureUrl(url: string): Promise<CaptureResult> {
  if (runningInTauri()) return invoke("capture_url", { url });
  const normalized = new URL(url).toString();
  const existing = mockItems.find((item) => item.sourceUrl === normalized);
  if (existing) return { item: existing, duplicate: true };
  const item: Item = {
    id: crypto.randomUUID(),
    itemType: "url",
    title: new URL(normalized).hostname,
    sourceUrl: normalized,
    notes: "",
    status: "ready",
    isFavorite: false,
    storageMode: "managed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
  mockItems = [item, ...mockItems];
  return { item, duplicate: false };
}

export async function captureText(text: string): Promise<CaptureResult> {
  if (runningInTauri()) return invoke("capture_text", { text, sourceApp: "Island" });
  const item: Item = {
    id: crypto.randomUUID(),
    itemType: "text",
    title: text.trim().split(/\r?\n/, 1)[0].slice(0, 60),
    notes: "",
    plainText: text.trim(),
    status: "ready",
    isFavorite: false,
    storageMode: "managed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
  mockItems = [item, ...mockItems];
  return { item, duplicate: false };
}

export async function updateItem(
  id: string,
  input: { title?: string; notes?: string; isFavorite?: boolean },
): Promise<Item> {
  if (runningInTauri()) return invoke("update_item", { input: { id, ...input } });
  const index = mockItems.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("内容不存在");
  mockItems[index] = { ...mockItems[index], ...input, updatedAt: new Date().toISOString() };
  return mockItems[index];
}

export async function trashItems(ids: string[]) {
  if (runningInTauri()) return invoke<void>("trash_items", { ids });
  mockItems = mockItems.map((item) =>
    ids.includes(item.id)
      ? { ...item, status: "trashed", deletedAt: new Date().toISOString() }
      : item,
  );
}

export async function restoreItems(ids: string[]) {
  if (runningInTauri()) return invoke<void>("restore_items", { ids });
  mockItems = mockItems.map((item) =>
    ids.includes(item.id) ? { ...item, status: "ready", deletedAt: null } : item,
  );
}

export async function deleteItemsPermanently(ids: string[]) {
  if (runningInTauri()) return invoke<void>("delete_items_permanently", { ids });
  mockItems = mockItems.filter((item) => !ids.includes(item.id));
}

export async function openItem(id: string) {
  if (runningInTauri()) return invoke<void>("open_item", { id });
  const item = mockItems.find((entry) => entry.id === id);
  if (item?.sourceUrl) window.open(item.sourceUrl, "_blank", "noopener,noreferrer");
}

export async function openReader(id: string) {
  if (runningInTauri()) return invoke<void>("open_reader", { id });
  window.open(`/?window=reader&id=${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
}

export async function getReaderResource(id: string): Promise<ReaderResource> {
  if (runningInTauri()) return invoke("get_reader_resource", { id });
  const item = mockItems.find((entry) => entry.id === id);
  if (!item) throw new Error("内容不存在");
  const mode =
    item.itemType === "url"
      ? "web-snapshot"
      : item.itemType === "text" || item.itemType === "markdown"
        ? "text"
        : item.itemType === "pdf"
          ? "pdf"
          : item.itemType === "image"
            ? "image"
            : "file";
  return { item, snapshot: null, mode };
}

export async function openLiveReader(url: string) {
  if (runningInTauri()) return invoke<void>("open_live_reader", { url });
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function revealItem(id: string) {
  if (runningInTauri()) return invoke<void>("reveal_item", { id });
}

export async function backupDatabase(): Promise<string> {
  if (runningInTauri()) return invoke("backup_database");
  return "浏览器预览：未创建实际备份";
}

export async function exportLibrary(): Promise<string> {
  if (runningInTauri()) return invoke("export_library");
  return "浏览器预览：未创建实际导出";
}

export async function getSettings(): Promise<Settings> {
  if (runningInTauri()) return invoke("get_settings");
  return {
    dataDir: "C:\\Users\\You\\AppData\\Roaming\\Island\\IslandData",
    networkFetchEnabled: false,
    aiEnabled: false,
    startOnLogin: false,
    reduceMotion: false,
  };
}

export async function updateSettings(input: Partial<Omit<Settings, "dataDir">>) {
  if (runningInTauri()) return invoke<Settings>("update_settings", { input });
  return { ...(await getSettings()), ...input };
}

export async function libraryStats(): Promise<LibraryStats> {
  if (runningInTauri()) return invoke("library_stats");
  const active = mockItems.filter((item) => !item.deletedAt);
  return {
    active: active.length,
    trashed: mockItems.length - active.length,
    favorites: active.filter((item) => item.isFavorite).length,
    bytesStored: active.reduce((total, item) => total + (item.fileSize ?? 0), 0),
  };
}

export async function showMainWindow() {
  if (runningInTauri()) return invoke<void>("show_main_window");
}

export function previewUrl(item: Item): string | null {
  if (!item.localPath) return null;
  return runningInTauri() ? convertFileSrc(item.localPath) : null;
}

export function localAssetUrl(path?: string | null): string | null {
  if (!path) return null;
  return runningInTauri() ? convertFileSrc(path) : null;
}
