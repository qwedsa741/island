import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  File,
  FileImage,
  FileText,
  FolderOpen,
  HardDrive,
  Heart,
  Inbox,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  backupDatabase,
  captureFiles,
  captureText,
  captureUrl,
  deleteItemsPermanently,
  exportLibrary,
  getSettings,
  libraryStats,
  listItems,
  openItem,
  previewUrl,
  restoreItems,
  revealItem,
  runningInTauri,
  showMainWindow,
  trashItems,
  updateItem,
  updateSettings,
} from "./lib/api";
import { formatBytes, formatRelativeDate, typeLabels } from "./lib/format";
import { useDesktopDrop } from "./hooks/useDesktopDrop";
import type { Item, ItemType, SearchQuery, Settings } from "./types";

type Section = "inbox" | "recent" | "all" | "favorites" | "trash" | "settings";
type CaptureMode = "url" | "text";

const itemTypeIcons: Record<ItemType, typeof File> = {
  file: File,
  pdf: FileText,
  image: FileImage,
  text: FileText,
  markdown: FileText,
  url: Link2,
};

function App() {
  const isIsland = runningInTauri() && getCurrentWindow().label === "island";
  return isIsland ? <IslandWindow /> : <LibraryWindow />;
}

function LibraryWindow() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<Section>("inbox");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailDismissed, setDetailDismissed] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const captureButton = useRef<HTMLButtonElement>(null);

  const notify = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);

  const refreshLibrary = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["items"] });
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
  }, [queryClient]);

  useEffect(() => {
    if (!runningInTauri()) return;
    let cleanup: (() => void) | undefined;
    listen("library-changed", refreshLibrary).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, [refreshLibrary]);

  const searchQuery = useMemo<SearchQuery>(
    () => ({
      query: search || undefined,
      types: typeFilter === "all" ? [] : [typeFilter],
      favorite: section === "favorites" ? true : undefined,
      trashed: section === "trash",
      page: 1,
      pageSize: 200,
    }),
    [search, section, typeFilter],
  );

  const itemsQuery = useQuery({
    queryKey: ["items", searchQuery],
    queryFn: () => listItems(searchQuery),
    enabled: section !== "settings",
  });
  const statsQuery = useQuery({ queryKey: ["stats"], queryFn: libraryStats });
  const items = useMemo(() => itemsQuery.data?.items ?? [], [itemsQuery.data]);

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null);
      return;
    }
    if (
      !detailDismissed &&
      (!selectedId || !items.some((item) => item.id === selectedId))
    ) {
      setSelectedId(items[0].id);
    }
  }, [detailDismissed, items, selectedId]);

  useEffect(() => {
    setSelectedId(null);
    setDetailDismissed(false);
  }, [section]);

  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  const fileMutation = useMutation({
    mutationFn: captureFiles,
    onSuccess: (results) => {
      refreshLibrary();
      const duplicateCount = results.filter((result) => result.duplicate).length;
      const savedCount = results.length - duplicateCount;
      notify(
        duplicateCount
          ? `已保存 ${savedCount} 项，${duplicateCount} 项已在资料库中`
          : `已安全保存 ${savedCount} 项`,
      );
      const last = results.at(-1)?.item;
      if (last) {
        setDetailDismissed(false);
        setSelectedId(last.id);
      }
    },
    onError: (error) => notify(error instanceof Error ? error.message : String(error)),
  });

  const onDrop = useCallback(
    (paths: string[]) => {
      if (paths.length) fileMutation.mutate(paths);
    },
    [fileMutation],
  );
  const dragging = useDesktopDrop(onDrop);

  async function chooseFiles() {
    if (!runningInTauri()) {
      notify("浏览器预览不提供本地路径，请运行桌面版测试文件选择");
      return;
    }
    const selection = await openDialog({ multiple: true, directory: false });
    const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
    if (paths.length) fileMutation.mutate(paths);
  }

  const heading =
    section === "settings"
      ? "设置"
      : {
          inbox: "收件箱",
          recent: "最近收藏",
          all: "全部内容",
          favorites: "收藏",
          trash: "回收站",
        }[section];

  return (
    <div className="app-shell">
      <Sidebar
        active={section}
        onChange={setSection}
        stats={statsQuery.data}
      />

      <main className="workspace">
        <header className={`command-bar ${section === "settings" ? "settings-command" : ""}`}>
          <div className="command-heading">
            <h1>{heading}</h1>
            {section !== "settings" && (
              <p>{itemsQuery.isLoading ? "正在读取…" : `${itemsQuery.data?.total ?? 0} 项内容`}</p>
            )}
          </div>

          {section !== "settings" && (
            <div className="command-tools">
              <label className="search-field">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">搜索资料</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索标题、文件名、链接和备注"
                />
                {search && (
                  <button
                    className="icon-button compact"
                    onClick={() => setSearch("")}
                    aria-label="清除搜索"
                  >
                    <X size={14} />
                  </button>
                )}
              </label>
              <label className="select-field">
                <span className="sr-only">按类型筛选</span>
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value as ItemType | "all")}
                >
                  <option value="all">所有类型</option>
                  {Object.entries(typeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>
            </div>
          )}

          <div className="capture-menu-wrap">
            <button
              ref={captureButton}
              className="button primary"
              aria-haspopup="menu"
              aria-expanded={captureMenuOpen}
              onClick={() => setCaptureMenuOpen((open) => !open)}
            >
              <Plus size={16} />
              新建收藏
              <ChevronDown size={14} />
            </button>
            {captureMenuOpen && (
              <CaptureMenu
                anchor={captureButton}
                onChooseFiles={() => {
                  setCaptureMenuOpen(false);
                  void chooseFiles();
                }}
                onMode={(mode) => {
                  setCaptureMenuOpen(false);
                  setCaptureMode(mode);
                }}
                onClose={() => setCaptureMenuOpen(false)}
              />
            )}
          </div>
        </header>

        {captureMode && (
          <QuickCapture
            mode={captureMode}
            onModeChange={setCaptureMode}
            onClose={() => setCaptureMode(null)}
            onSaved={(item, duplicate) => {
              refreshLibrary();
              setDetailDismissed(false);
              setSelectedId(item.id);
              setCaptureMode(null);
              notify(duplicate ? "这条内容已在资料库中" : "已安全保存");
            }}
            onError={notify}
          />
        )}

        {section === "settings" ? (
          <SettingsView notify={notify} />
        ) : (
          <div
            className={`library-layout ${selectedItem ? "detail-open" : "without-detail"}`}
          >
              <section className="item-list" aria-label="资料列表">
                {itemsQuery.isLoading ? (
                  <ListSkeleton />
                ) : items.length ? (
                  items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      selected={item.id === selectedId}
                      onSelect={() => {
                        setDetailDismissed(false);
                        setSelectedId(item.id);
                      }}
                    />
                  ))
                ) : (
                  <EmptyState
                    search={Boolean(search || typeFilter !== "all")}
                    trashed={section === "trash"}
                    onChooseFiles={chooseFiles}
                  />
                )}
              </section>

              {selectedItem && (
                <DetailPanel
                  item={selectedItem}
                  trashed={section === "trash"}
                  onChanged={refreshLibrary}
                  onNotice={notify}
                  onClose={() => {
                    setDetailDismissed(true);
                    setSelectedId(null);
                  }}
                />
              )}
          </div>
        )}
      </main>

      {dragging && (
        <div className="drop-overlay" role="status" aria-live="polite">
          <div className="drop-target">
            <Archive size={28} />
            <strong>放到 Island</strong>
            <span>文件会复制到本地资料库</span>
          </div>
        </div>
      )}

      {fileMutation.isPending && (
        <div className="capture-progress" role="status">
          <LoaderCircle size={16} className="spin" />
          正在校验并保存文件…
        </div>
      )}

      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </div>
  );
}

function CaptureMenu({
  anchor,
  onChooseFiles,
  onMode,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement>;
  onChooseFiles: () => void;
  onMode: (mode: CaptureMode) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !anchor.current?.contains(target)) {
        onClose();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      anchor.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [anchor, onClose]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (!items.length) return;
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <div ref={menu} className="capture-menu" role="menu" onKeyDown={handleKeyDown}>
      <button role="menuitem" onClick={onChooseFiles}>
        <FolderOpen size={17} />
        <span>
          <strong>选择文件</strong>
          <small>复制到本地资料库</small>
        </span>
      </button>
      <button role="menuitem" onClick={() => onMode("url")}>
        <Link2 size={17} />
        <span>
          <strong>保存链接</strong>
          <small>收藏网页地址</small>
        </span>
      </button>
      <button role="menuitem" onClick={() => onMode("text")}>
        <FileText size={17} />
        <span>
          <strong>保存文字</strong>
          <small>记录一段文本</small>
        </span>
      </button>
    </div>
  );
}

function Sidebar({
  active,
  onChange,
  stats,
}: {
  active: Section;
  onChange: (section: Section) => void;
  stats?: { active: number; trashed: number; favorites: number };
}) {
  const primary: Array<{ id: Section; label: string; icon: typeof Inbox; count?: number }> = [
    { id: "inbox", label: "收件箱", icon: Inbox, count: stats?.active },
    { id: "recent", label: "最近收藏", icon: Clock3 },
    { id: "all", label: "全部内容", icon: Archive },
    { id: "favorites", label: "收藏", icon: Star, count: stats?.favorites },
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <strong>Island</strong>
          <small>本地收藏岛</small>
        </div>
      </div>
      <nav aria-label="资料库">
        {primary.map((entry) => (
          <NavButton
            key={entry.id}
            entry={entry}
            active={active === entry.id}
            onClick={() => onChange(entry.id)}
          />
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <nav aria-label="管理">
        <NavButton
          entry={{ id: "trash", label: "回收站", icon: Trash2, count: stats?.trashed }}
          active={active === "trash"}
          onClick={() => onChange("trash")}
        />
        <NavButton
          entry={{ id: "settings", label: "设置", icon: SettingsIcon }}
          active={active === "settings"}
          onClick={() => onChange("settings")}
        />
      </nav>
      <div className="local-note">
        <HardDrive size={15} />
        <span>数据保存在本机</span>
      </div>
    </aside>
  );
}

function NavButton({
  entry,
  active,
  onClick,
}: {
  entry: { id: Section; label: string; icon: typeof Inbox; count?: number };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = entry.icon;
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      <Icon size={17} />
      <span>{entry.label}</span>
      {typeof entry.count === "number" && entry.count > 0 && <small>{entry.count}</small>}
    </button>
  );
}

function QuickCapture({
  mode,
  onModeChange,
  onClose,
  onSaved,
  onError,
}: {
  mode: CaptureMode;
  onModeChange: (mode: CaptureMode) => void;
  onClose: () => void;
  onSaved: (item: Item, duplicate: boolean) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const mutation = useMutation({
    mutationFn: () => (mode === "url" ? captureUrl(value) : captureText(value)),
    onSuccess: (result) => onSaved(result.item, result.duplicate),
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  });

  useEffect(() => input.current?.focus(), [mode]);

  return (
    <section className="quick-capture" aria-label="快速收藏">
      <div className="capture-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mode === "url"}
          onClick={() => {
            setValue("");
            onModeChange("url");
          }}
        >
          <Link2 size={15} /> 链接
        </button>
        <button
          role="tab"
          aria-selected={mode === "text"}
          onClick={() => {
            setValue("");
            onModeChange("text");
          }}
        >
          <FileText size={15} /> 文字
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) mutation.mutate();
        }}
      >
        {mode === "url" ? (
          <input
            ref={input}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="粘贴 https:// 开头的链接"
            aria-label="网页链接"
          />
        ) : (
          <textarea
            ref={input}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="粘贴一段稍后要找回的文字"
            aria-label="收藏文字"
            rows={3}
          />
        )}
        <button className="button primary" disabled={!value.trim() || mutation.isPending}>
          {mutation.isPending ? <LoaderCircle size={16} className="spin" /> : <Archive size={16} />}
          保存到收件箱
        </button>
      </form>
      <button className="icon-button capture-close" onClick={onClose} aria-label="关闭快速收藏">
        <X size={16} />
      </button>
    </section>
  );
}

function ItemRow({
  item,
  selected,
  onSelect,
}: {
  item: Item;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = itemTypeIcons[item.itemType];
  return (
    <button
      className={`item-row ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className={`type-icon type-${item.itemType}`}>
        <Icon size={18} />
      </span>
      <span className="item-copy">
        <strong>{item.title}</strong>
        <span>
          {typeLabels[item.itemType]}
          {item.originalName && ` · ${item.originalName}`}
        </span>
      </span>
      <span className="item-row-meta">
        {item.isFavorite && <Star size={13} fill="currentColor" />}
        <time>{formatRelativeDate(item.createdAt)}</time>
      </span>
    </button>
  );
}

function DetailPanel({
  item,
  trashed,
  onChanged,
  onNotice,
  onClose,
}: {
  item: Item;
  trashed: boolean;
  onChanged: () => void;
  onNotice: (message: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const imageUrl = previewUrl(item);

  useEffect(() => {
    setTitle(item.title);
    setNotes(item.notes);
  }, [item]);

  const saveMutation = useMutation({
    mutationFn: () => updateItem(item.id, { title, notes }),
    onSuccess: () => {
      onChanged();
      onNotice("修改已保存");
    },
    onError: (error) => onNotice(error instanceof Error ? error.message : String(error)),
  });
  const favoriteMutation = useMutation({
    mutationFn: () => updateItem(item.id, { isFavorite: !item.isFavorite }),
    onSuccess: onChanged,
  });

  async function handleTrash() {
    try {
      await trashItems([item.id]);
      onChanged();
      onNotice("已移到回收站");
    } catch (error) {
      onNotice(String(error));
    }
  }

  async function handleRestore() {
    await restoreItems([item.id]);
    onChanged();
    onNotice("已恢复到资料库");
  }

  async function handlePermanentDelete() {
    if (!window.confirm(`永久删除“${item.title}”？此操作无法撤销。`)) return;
    await deleteItemsPermanently([item.id]);
    onChanged();
    onNotice("内容已永久删除");
  }

  return (
    <aside className="detail-panel" aria-label="内容详情">
      <div className="detail-header">
        <div className="detail-heading">
          <button className="icon-button detail-back" onClick={onClose} aria-label="返回资料列表">
            <ArrowLeft size={17} />
          </button>
          <div>
            <span className="detail-kind">{typeLabels[item.itemType]}</span>
            <h2 title={item.title}>{item.title}</h2>
            <p>{formatRelativeDate(item.createdAt)}收藏</p>
          </div>
        </div>
        <div className="detail-header-actions">
          {!trashed && (
            <button
              className={`icon-button ${item.isFavorite ? "favorite" : ""}`}
              onClick={() => favoriteMutation.mutate()}
              aria-label={item.isFavorite ? "取消收藏" : "收藏"}
            >
              <Heart size={17} fill={item.isFavorite ? "currentColor" : "none"} />
            </button>
          )}
          <button className="icon-button detail-close" onClick={onClose} aria-label="关闭详情">
            <PanelRightClose size={17} />
          </button>
        </div>
      </div>

      <div className={`preview preview-${item.itemType}`}>
        {imageUrl ? (
          <img src={imageUrl} alt="" />
        ) : item.itemType === "text" || item.itemType === "markdown" ? (
          <p>{item.plainText}</p>
        ) : (
          <div className="preview-placeholder">
            {(() => {
              const Icon = itemTypeIcons[item.itemType];
              return <Icon size={28} />;
            })()}
            <span>{item.originalName || item.sourceUrl || typeLabels[item.itemType]}</span>
          </div>
        )}
      </div>

      <div className="detail-content">
        <label className="field">
          <span>标题</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={trashed} />
        </label>
        <label className="field">
          <span>备注</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="添加便于以后搜索的说明"
            rows={4}
            disabled={trashed}
          />
        </label>

        {!trashed && (title !== item.title || notes !== item.notes) && (
          <button className="button primary full" onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
            保存修改
          </button>
        )}

        <dl className="metadata-list">
          <div>
            <dt>收藏时间</dt>
            <dd>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</dd>
          </div>
          <div>
            <dt>大小</dt>
            <dd>{formatBytes(item.fileSize)}</dd>
          </div>
          <div>
            <dt>存储</dt>
            <dd>本地托管</dd>
          </div>
          {item.sourceUrl && (
            <div>
              <dt>来源</dt>
              <dd className="truncate">{item.sourceUrl}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="detail-actions">
        {trashed ? (
          <>
            <button className="button secondary" onClick={handleRestore}>
              <ArchiveRestore size={16} /> 恢复
            </button>
            <button className="button danger-ghost" onClick={handlePermanentDelete}>
              <Trash2 size={16} /> 永久删除
            </button>
          </>
        ) : (
          <>
            <button className="button secondary" onClick={() => openItem(item.id)}>
              <ExternalLink size={16} /> 打开
            </button>
            {item.localPath && (
              <button className="button ghost" onClick={() => revealItem(item.id)}>
                <FolderOpen size={16} /> 定位
              </button>
            )}
            <button className="icon-button danger" onClick={handleTrash} aria-label="移到回收站">
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function EmptyState({
  search,
  trashed,
  onChooseFiles,
}: {
  search: boolean;
  trashed: boolean;
  onChooseFiles: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-mark">
        {search ? <Search size={24} /> : trashed ? <Trash2 size={24} /> : <Archive size={24} />}
      </div>
      <h2>{search ? "没有匹配的内容" : trashed ? "回收站是空的" : "把第一份资料放到岛上"}</h2>
      <p>
        {search
          ? "换一个关键词或清除类型筛选。"
          : trashed
            ? "删除的内容会保留在这里，直到你永久清理。"
            : "拖入文件，或使用快速收藏保存链接和文字。"}
      </p>
      {!search && !trashed && (
        <button className="button primary" onClick={onChooseFiles}>
          <FolderOpen size={16} /> 选择文件
        </button>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="skeleton-list" aria-label="正在加载">
      {Array.from({ length: 7 }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span />
          <div>
            <i />
            <i />
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsView({ notify }: { notify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const settings = settingsQuery.data;
  const updateMutation = useMutation({
    mutationFn: (input: Partial<Omit<Settings, "dataDir">>) => updateSettings(input),
    onSuccess: (next) => queryClient.setQueryData(["settings"], next),
    onError: (error) => notify(String(error)),
  });

  async function runMaintenance(action: "backup" | "export") {
    try {
      const path = action === "backup" ? await backupDatabase() : await exportLibrary();
      notify(`${action === "backup" ? "备份" : "导出"}已完成：${path}`);
    } catch (error) {
      notify(String(error));
    }
  }

  if (!settings) return <ListSkeleton />;

  return (
    <div className="settings-view">
      <section className="settings-section">
        <div className="settings-heading">
          <div className="settings-icon"><Database size={18} /></div>
          <div>
            <h2>本地数据</h2>
            <p>文件、索引和配置只保存在这台电脑。</p>
          </div>
        </div>
        <div className="data-location">
          <code>{settings.dataDir}</code>
          <button className="icon-button" aria-label="复制数据目录" onClick={() => {
            void navigator.clipboard.writeText(settings.dataDir);
            notify("数据目录已复制");
          }}>
            <Copy size={15} />
          </button>
        </div>
        <div className="settings-actions">
          <button className="button secondary" onClick={() => runMaintenance("backup")}>
            <Database size={16} /> 创建数据库备份
          </button>
          <button className="button secondary" onClick={() => runMaintenance("export")}>
            <ArrowUpRight size={16} /> 导出完整资料库
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <div className="settings-icon"><Sparkles size={18} /></div>
          <div>
            <h2>网络与智能功能</h2>
            <p>这些能力默认关闭，收藏和搜索不依赖它们。</p>
          </div>
        </div>
        <SettingToggle
          label="允许抓取网页信息"
          description="保存 URL 后获取网页标题与描述。当前版本只记录原始链接。"
          checked={settings.networkFetchEnabled}
          onChange={(value) => updateMutation.mutate({ networkFetchEnabled: value })}
        />
        <SettingToggle
          label="启用 AI"
          description="AI Provider 将在 0.4 阶段提供；当前开关不会发送任何内容。"
          checked={settings.aiEnabled}
          disabled
          onChange={() => undefined}
        />
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <div className="settings-icon"><SettingsIcon size={18} /></div>
          <div>
            <h2>使用偏好</h2>
            <p>调整 Island 在当前设备上的行为。</p>
          </div>
        </div>
        <SettingToggle
          label="减少动态效果"
          description="关闭界面位移与缩放，仅保留必要状态切换。"
          checked={settings.reduceMotion}
          onChange={(value) => updateMutation.mutate({ reduceMotion: value })}
        />
        <SettingToggle
          label="开机启动"
          description="启动项接入安排在发布准备阶段。"
          checked={settings.startOnLogin}
          disabled
          onChange={() => undefined}
        />
      </section>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`setting-row ${disabled ? "disabled" : ""}`}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        className="switch-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function IslandWindow() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [statusText, setStatusText] = useState("拖入文件，随手收藏");
  const itemsQuery = useQuery({
    queryKey: ["items", "island"],
    queryFn: () => listItems({ page: 1, pageSize: 4, trashed: false }),
  });

  const resize = useCallback(async (nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    if (runningInTauri()) {
      await getCurrentWindow().setSize(
        nextExpanded ? new LogicalSize(372, 410) : new LogicalSize(292, 92),
      );
    }
  }, []);

  const onDrop = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      setStatus("saving");
      setStatusText(`正在保存 ${paths.length} 个文件…`);
      try {
        const results = await captureFiles(paths);
        setStatus("saved");
        setStatusText(
          results.every((result) => result.duplicate)
            ? "这些内容已经收藏过"
            : `已安全保存 ${results.length} 项`,
        );
        await queryClient.invalidateQueries({ queryKey: ["items"] });
        window.setTimeout(() => {
          setStatus("idle");
          setStatusText("拖入文件，随手收藏");
        }, 2200);
      } catch (error) {
        setStatus("error");
        setStatusText(error instanceof Error ? error.message : String(error));
      }
    },
    [queryClient],
  );
  const dragging = useDesktopDrop(onDrop);

  return (
    <div className={`island-window ${expanded ? "expanded" : ""} ${dragging ? "dragging" : ""}`}>
      <header className="island-header" data-tauri-drag-region>
        <button
          className={`island-status status-${status}`}
          onClick={() => resize(!expanded)}
          aria-expanded={expanded}
        >
          <span className="island-logo" aria-hidden="true">
            {status === "saving" ? (
              <LoaderCircle size={18} className="spin" />
            ) : status === "saved" ? (
              <Check size={18} />
            ) : status === "error" ? (
              <X size={18} />
            ) : (
              <Archive size={18} />
            )}
          </span>
          <span>
            <strong>{dragging ? "放到 Island" : statusText}</strong>
            <small>{dragging ? "松开即可复制到本地资料库" : "Ctrl + Shift + I 显示或隐藏"}</small>
          </span>
          <MoreHorizontal size={17} />
        </button>
      </header>

      {expanded && (
        <section className="island-panel">
          <div className="island-panel-heading">
            <h2>最近收藏</h2>
            <button className="icon-button" onClick={() => resize(false)} aria-label="收起">
              <X size={15} />
            </button>
          </div>
          <div className="island-recent">
            {itemsQuery.data?.items.length ? (
              itemsQuery.data.items.map((item) => {
                const Icon = itemTypeIcons[item.itemType];
                return (
                  <button key={item.id} onClick={() => openItem(item.id)}>
                    <span className={`type-icon type-${item.itemType}`}><Icon size={16} /></span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{formatRelativeDate(item.createdAt)}</small>
                    </span>
                    <ExternalLink size={14} />
                  </button>
                );
              })
            ) : (
              <div className="island-empty">拖入文件开始收藏</div>
            )}
          </div>
          <button className="button primary full" onClick={showMainWindow}>
            <Archive size={16} /> 打开资料库
          </button>
          <p className="island-privacy"><HardDrive size={13} /> 内容只保存在本机</p>
        </section>
      )}
    </div>
  );
}

export default App;
