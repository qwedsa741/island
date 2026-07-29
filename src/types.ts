export type ItemType = "file" | "pdf" | "image" | "text" | "markdown" | "url";
export type ItemStatus = "importing" | "ready" | "processing" | "failed" | "trashed";

export interface Item {
  id: string;
  itemType: ItemType;
  title: string;
  originalName?: string | null;
  sourceUrl?: string | null;
  sourceApp?: string | null;
  localPath?: string | null;
  originalPath?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  contentHash?: string | null;
  notes: string;
  plainText?: string | null;
  status: ItemStatus;
  isFavorite: boolean;
  storageMode: "managed" | "referenced";
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null;
  deletedAt?: string | null;
}

export interface SearchQuery {
  query?: string;
  types?: ItemType[];
  favorite?: boolean;
  processingStatus?: ItemStatus;
  page?: number;
  pageSize?: number;
  trashed?: boolean;
}

export interface ItemPage {
  items: Item[];
  total: number;
}

export interface CaptureResult {
  item: Item;
  duplicate: boolean;
}

export interface Settings {
  dataDir: string;
  networkFetchEnabled: boolean;
  aiEnabled: boolean;
  startOnLogin: boolean;
  reduceMotion: boolean;
}

export interface LibraryStats {
  active: number;
  trashed: number;
  favorites: number;
  bytesStored: number;
}

export interface WebSnapshot {
  id: string;
  itemId: string;
  version: number;
  sourceUrl: string;
  finalUrl?: string | null;
  rawPath?: string | null;
  sanitizedPath?: string | null;
  title?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  capturedAt: string;
  status: "processing" | "ready" | "partial" | "failed";
  errorCode?: string | null;
}

export interface ReaderResource {
  item: Item;
  snapshot?: WebSnapshot | null;
  mode: "pdf" | "image" | "text" | "web-snapshot" | "file";
}
