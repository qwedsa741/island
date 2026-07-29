import {
  Archive,
  ArchiveRestore,
  CircleAlert,
  Bot,
  BookOpen,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Command,
  Database,
  ExternalLink,
  File,
  FileImage,
  FileText,
  FileOutput,
  FolderOpen,
  HardDrive,
  Heart,
  Inbox,
  Link2,
  LoaderCircle,
  Layers3,
  MoreHorizontal,
  Monitor,
  RotateCw,
  PanelRightClose,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Sun,
  Moon,
  Tag as TagIcon,
  Workflow,
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
  createSmartView,
  createSpace,
  deleteItemsPermanently,
  exportLibrary,
  getSettings,
  libraryStats,
  listItems,
  listJobs,
  listItemSpaces,
  listItemTags,
  listSmartViews,
  listSpaces,
  openItem,
  openReader,
  previewUrl,
  restoreItems,
  retryJob,
  revealItem,
  runningInTauri,
  showMainWindow,
  setItemTags,
  trashItems,
  updateItem,
  updateSpaceMembership,
  updateSettings,
} from "./lib/api";
import { formatBytes, formatRelativeDate, typeLabels } from "./lib/format";
import { useDesktopDrop } from "./hooks/useDesktopDrop";
import type { Item, ItemType, JobRecord, SearchQuery, Settings, Space } from "./types";
import { ReaderWindow } from "./ReaderWindow";
import { Button as UiButton, Checkbox, Dialog } from "./ui/primitives";
import { useAppearance, type ThemeMode } from "./ui/preferences";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";

type Section =
  | "inbox"
  | "recent"
  | "all"
  | "favorites"
  | "spaces"
  | "agent"
  | "artifacts"
  | "processing"
  | "trash"
  | "settings";
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
  const isReader =
    (runningInTauri() && getCurrentWindow().label === "reader") ||
    new URLSearchParams(window.location.search).get("window") === "reader";
  return isIsland ? <IslandWindow /> : isReader ? <ReaderWindow /> : <LibraryWindow />;
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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const captureButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

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
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;
  const isLibrarySection = ["inbox", "recent", "all", "favorites", "trash"].includes(section);

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

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (
        event.key === "/" &&
        isLibrarySection &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [isLibrarySection]);

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
      {
          inbox: "收件箱",
          recent: "最近收藏",
          all: "全部内容",
          favorites: "收藏",
          spaces: "空间",
          agent: "Agent",
          artifacts: "产出",
          processing: "处理中",
          trash: "回收站",
          settings: "设置",
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
            {isLibrarySection && (
              <p>{itemsQuery.isLoading ? "正在读取…" : `${itemsQuery.data?.total ?? 0} 项内容`}</p>
            )}
          </div>

          {isLibrarySection && (
            <div className="command-tools">
              <label className="search-field">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">搜索资料</span>
                <input
                  ref={searchInput}
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
              className="command-palette-trigger"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="打开命令面板"
            >
              <Command size={15} />
              <span>命令</span>
              <kbd>Ctrl K</kbd>
            </button>
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
        ) : section === "spaces" ? (
          <SpacesWorkspace notify={notify} onOpenFavorites={() => setSection("favorites")} />
        ) : section === "processing" ? (
          <ProcessingWorkspace notify={notify} />
        ) : !isLibrarySection ? (
          <KnowledgeWorkspace section={section} />
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

      <CommandPalette
        isOpen={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onNavigate={(next) => {
          setSection(next);
          setCommandPaletteOpen(false);
        }}
        onCapture={(mode) => {
          setCommandPaletteOpen(false);
          if (mode === "file") void chooseFiles();
          else setCaptureMode(mode);
        }}
      />
    </div>
  );
}

function CommandPalette({
  isOpen,
  onOpenChange,
  onNavigate,
  onCapture,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (section: Section) => void;
  onCapture: (mode: CaptureMode | "file") => void;
}) {
  const [query, setQuery] = useState("");
  const commands = [
    { label: "打开收件箱", hint: "资料", icon: Inbox, action: () => onNavigate("inbox") },
    { label: "查看全部内容", hint: "资料", icon: Archive, action: () => onNavigate("all") },
    { label: "打开空间", hint: "知识", icon: Layers3, action: () => onNavigate("spaces") },
    { label: "打开 Agent", hint: "工作", icon: Bot, action: () => onNavigate("agent") },
    { label: "选择文件收藏", hint: "收藏", icon: FolderOpen, action: () => onCapture("file") },
    { label: "保存链接", hint: "收藏", icon: Link2, action: () => onCapture("url") },
    { label: "保存文字", hint: "收藏", icon: FileText, action: () => onCapture("text") },
    { label: "打开设置", hint: "系统", icon: SettingsIcon, action: () => onNavigate("settings") },
  ];
  const filtered = commands.filter((command) =>
    `${command.label} ${command.hint}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      aria-label="全局命令面板"
      className="command-dialog"
    >
      <div className="command-dialog-search">
        <Search size={18} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索命令或前往…"
          aria-label="搜索命令"
        />
        <kbd>Esc</kbd>
      </div>
      <div className="command-results" role="listbox" aria-label="命令">
        {filtered.map((command) => {
          const Icon = command.icon;
          return (
            <button key={command.label} role="option" onClick={command.action}>
              <Icon size={17} />
              <span>{command.label}</span>
              <small>{command.hint}</small>
            </button>
          );
        })}
        {!filtered.length && <p>没有匹配的命令</p>}
      </div>
    </Dialog>
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
      <nav aria-label="资料">
        <span className="nav-group-label">资料</span>
        {primary.map((entry) => (
          <NavButton
            key={entry.id}
            entry={entry}
            active={active === entry.id}
            onClick={() => onChange(entry.id)}
          />
        ))}
      </nav>
      <nav aria-label="知识" className="knowledge-nav">
        <span className="nav-group-label">知识</span>
        <NavButton entry={{ id: "spaces", label: "空间", icon: Layers3 }} active={active === "spaces"} onClick={() => onChange("spaces")} />
      </nav>
      <nav aria-label="工作" className="work-nav">
        <span className="nav-group-label">工作</span>
        <NavButton entry={{ id: "agent", label: "Agent", icon: Bot }} active={active === "agent"} onClick={() => onChange("agent")} />
        <NavButton entry={{ id: "artifacts", label: "产出", icon: FileOutput }} active={active === "artifacts"} onClick={() => onChange("artifacts")} />
        <NavButton entry={{ id: "processing", label: "处理中", icon: Workflow }} active={active === "processing"} onClick={() => onChange("processing")} />
      </nav>
      <div className="sidebar-spacer" />
      <nav aria-label="系统">
        <span className="nav-group-label">系统</span>
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

function KnowledgeWorkspace({ section }: { section: Section }) {
  if (section === "agent") {
    return (
      <section className="agent-workbench" aria-labelledby="agent-workbench-title">
        <header className="agent-workbench-header">
          <div>
            <span className="eyebrow">知识工作台</span>
            <h2 id="agent-workbench-title">与你的知识一起工作</h2>
            <p>从明确的资料范围开始任务，回答会保留来源和引用位置。</p>
          </div>
          <span className="provider-status"><span /> 尚未配置模型</span>
        </header>
        <div className="agent-workbench-body">
          <section className="agent-thread">
            <div className="agent-empty-mark"><Bot size={24} /></div>
            <h3>创建一个有边界的知识任务</h3>
            <p>例如：归纳一个空间的研究结论，或从选中资料中整理带引用的提纲。</p>
            <UiButton variant="primary" isDisabled>
              <Sparkles size={16} /> 新建知识任务
            </UiButton>
          </section>
          <aside className="context-tray">
            <div>
              <span className="eyebrow">上下文托盘</span>
              <strong>尚未选择资料</strong>
            </div>
            <p>从资料详情、空间或搜索结果唤起 Agent，来源会在这里清晰列出。</p>
            <ul>
              <li><ShieldCheck size={15} /> 本地搜索无需联网</li>
              <li><BookOpen size={15} /> 每个结论都应附带引用</li>
              <li><CircleAlert size={15} /> 写入知识库前必须确认</li>
            </ul>
          </aside>
        </div>
      </section>
    );
  }

  const content = {
    spaces: {
      title: "把资料组织成知识群岛",
      body: "同一份内容可以进入多个空间。空间、标签和智能视图的数据基础已经建立，下一迭代将接通创建和管理。",
      action: "新建空间",
      icon: Layers3,
    },
    artifacts: {
      title: "沉淀可继续编辑的产出",
      body: "报告、提纲、笔记和清单会作为独立产出保存，并保留引用来源。",
      action: "新建产出",
      icon: FileOutput,
    },
    processing: {
      title: "解析工作会在后台进行",
      body: "网页快照、正文提取、OCR、索引和 Embedding 都使用可重试任务，不阻塞收藏。",
      action: "查看任务",
      icon: Workflow,
    },
  }[section as "spaces" | "artifacts" | "processing"];
  if (!content) return null;
  const Icon = content.icon;
  return (
    <section className="knowledge-placeholder">
      <Icon size={28} />
      <h2>{content.title}</h2>
      <p>{content.body}</p>
      <button className="button secondary" disabled>{content.action}</button>
      <small>基础数据结构已就绪 · 功能将在后续里程碑开放</small>
    </section>
  );
}

function SpacesWorkspace({ notify, onOpenFavorites }: { notify: (message: string) => void; onOpenFavorites: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [viewName, setViewName] = useState("");
  const spaces = useQuery({ queryKey: ["spaces"], queryFn: listSpaces });
  const views = useQuery({ queryKey: ["smart-views"], queryFn: listSmartViews });
  const createSpaceMutation = useMutation({
    mutationFn: () => createSpace({ name, description, color: "teal" }),
    onSuccess: () => { setName(""); setDescription(""); void queryClient.invalidateQueries({ queryKey: ["spaces"] }); notify("已创建空间"); },
    onError: (error) => notify(error instanceof Error ? error.message : String(error)),
  });
  const createViewMutation = useMutation({
    mutationFn: () => createSmartView({ name: viewName, rulesJson: JSON.stringify({ favorite: true }) }),
    onSuccess: () => { setViewName(""); void queryClient.invalidateQueries({ queryKey: ["smart-views"] }); notify("已保存智能视图"); },
    onError: (error) => notify(error instanceof Error ? error.message : String(error)),
  });
  return (
    <section className="organization-workspace">
      <div className="organization-intro"><Layers3 size={24} /><div><h2>空间</h2><p>一份资料可同时属于多个空间；原始内容只保存一次。</p></div></div>
      <div className="organization-columns">
        <section className="organization-section">
          <div className="section-title"><h3>你的空间</h3><span>{spaces.data?.length ?? 0}</span></div>
          {spaces.data?.length ? <div className="space-list">{spaces.data.map((space) => <SpaceRow key={space.id} space={space} />)}</div> : <p className="muted">还没有空间。先按项目、主题或长期目标创建一个。</p>}
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) createSpaceMutation.mutate(); }}>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="空间名称，例如：设计研究" maxLength={80} />
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可选说明" maxLength={240} />
            <button className="button primary" disabled={createSpaceMutation.isPending}>{createSpaceMutation.isPending ? "创建中…" : "创建空间"}</button>
          </form>
        </section>
        <section className="organization-section">
          <div className="section-title"><h3>智能视图</h3><span>{views.data?.length ?? 0}</span></div>
          <p className="muted">智能视图保存筛选规则，不复制内容。首版预设为“收藏项”。</p>
          {views.data?.length ? <ul className="smart-view-list">{views.data.map((view) => <li key={view.id}><TagIcon size={15} /><button onClick={onOpenFavorites}>{view.name}</button><small>收藏项</small></li>)}</ul> : null}
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (viewName.trim()) createViewMutation.mutate(); }}>
            <input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="视图名称，例如：待读重点" maxLength={80} />
            <button className="button secondary" disabled={createViewMutation.isPending}>{createViewMutation.isPending ? "保存中…" : "保存收藏视图"}</button>
          </form>
        </section>
      </div>
    </section>
  );
}

function ProcessingWorkspace({ notify }: { notify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | JobRecord["status"]>("all");
  const jobs = useQuery({
    queryKey: ["jobs", filter],
    queryFn: () => listJobs(filter === "all" ? undefined : filter),
    refetchInterval: (query) => query.state.data?.some((job) => job.status === "queued" || job.status === "running") ? 2200 : false,
  });
  const retry = useMutation({
    mutationFn: retryJob,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["jobs"] }); notify("任务已重新加入队列"); },
    onError: (error) => notify(error instanceof Error ? error.message : String(error)),
  });
  return <section className="processing-workspace">
    <div className="processing-heading"><Workflow size={24} /><div><h2>处理中</h2><p>收藏不会被后台任务阻塞；失败的网页快照可在这里重新尝试。</p></div></div>
    <div className="processing-filter" role="tablist" aria-label="任务状态">
      {(["all", "running", "queued", "failed", "succeeded"] as const).map((value) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{({ all: "全部", running: "进行中", queued: "等待中", failed: "失败", succeeded: "已完成" } as Record<string, string>)[value]}</button>)}
    </div>
    {jobs.isLoading ? <ListSkeleton /> : jobs.data?.length ? <div className="job-list">{jobs.data.map((job) => <JobRow key={job.id} job={job} onRetry={() => retry.mutate(job.id)} retrying={retry.isPending} />)}</div> : <div className="job-empty"><Workflow size={27} /><strong>没有{filter === "all" ? "后台任务" : ({ running: "进行中的任务", queued: "等待中的任务", failed: "失败任务", succeeded: "已完成任务" } as Record<string, string>)[filter]}</strong><span>网页快照、文档解析和索引工作会显示在这里。</span></div>}
  </section>;
}

function JobRow({ job, onRetry, retrying }: { job: JobRecord; onRetry: () => void; retrying: boolean }) {
  const status = { queued: "等待中", running: "处理中", succeeded: "完成", failed: "失败", cancelled: "已取消" }[job.status];
  const jobLabel = { fetch_webpage: "网页快照", extract_text: "正文解析" }[job.jobType] ?? job.jobType;
  return <article className={`job-row job-${job.status}`}>
    <div className="job-status-icon">{job.status === "failed" ? <CircleAlert size={18} /> : <Workflow size={18} />}</div>
    <div className="job-main"><div><strong>{job.itemTitle}</strong><span>{jobLabel}</span></div>{(job.status === "queued" || job.status === "running") && <div className="job-progress" aria-label={`进度 ${Math.round(job.progress * 100)}%`}><i style={{ width: `${Math.max(4, job.progress * 100)}%` }} /></div>}{job.errorMessage && <p>{job.errorMessage}</p>}</div>
    <div className="job-meta"><span className={`status-badge ${job.status}`}>{status}</span><small>{job.retryCount ? `已重试 ${job.retryCount} 次` : new Date(job.createdAt).toLocaleString("zh-CN")}</small></div>
    {job.status === "failed" && <button className="button secondary" onClick={onRetry} disabled={retrying}><RotateCw size={15} /> 重试</button>}
  </article>;
}

function SpaceRow({ space }: { space: Space }) {
  return <div className="space-row"><span className="space-dot" /><div><strong>{space.name}</strong><small>{space.description || "未添加说明"}</small></div><span>{space.itemCount} 项</span></div>;
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
    <button
      className={`nav-button ${active ? "active" : ""}`}
      onClick={onClick}
      aria-label={entry.label}
    >
      <Icon size={17} aria-hidden="true" />
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
        {!trashed && <ItemOrganization itemId={item.id} onChanged={onChanged} onNotice={onNotice} />}
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
            <button className="button primary" onClick={() => openReader(item.id)}>
              <ExternalLink size={16} /> 沉浸阅读
            </button>
            <button className="button ghost" onClick={() => openItem(item.id)}>
              <ArrowUpRight size={16} /> 系统打开
            </button>
            {item.localPath && (
              <button className="button ghost" onClick={() => revealItem(item.id)}>
                <FolderOpen size={16} /> 定位
              </button>
            )}
            <MenuTrigger>
              <AriaButton className="icon-button" aria-label="更多资料操作">
                <MoreHorizontal size={17} />
              </AriaButton>
              <Popover className="action-popover" placement="top end">
                <Menu aria-label="资料操作" className="action-menu">
                  <MenuItem className="danger-menu-item" onAction={() => void handleTrash()}>
                    <Trash2 size={16} /> 移到回收站
                  </MenuItem>
                </Menu>
              </Popover>
            </MenuTrigger>
          </>
        )}
      </div>
    </aside>
  );
}

function ItemOrganization({ itemId, onChanged, onNotice }: { itemId: string; onChanged: () => void; onNotice: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [tagText, setTagText] = useState("");
  const tags = useQuery({ queryKey: ["item-tags", itemId], queryFn: () => listItemTags(itemId) });
  const spaces = useQuery({ queryKey: ["spaces"], queryFn: listSpaces });
  const memberships = useQuery({ queryKey: ["item-spaces", itemId], queryFn: () => listItemSpaces(itemId) });
  const saveTags = useMutation({
    mutationFn: () => setItemTags(itemId, [...(tags.data ?? []).map((tag) => tag.name), ...tagText.split(/[,，]/).map((value) => value.trim()).filter(Boolean)]),
    onSuccess: () => { setTagText(""); void queryClient.invalidateQueries({ queryKey: ["item-tags", itemId] }); onChanged(); onNotice("标签已保存"); },
    onError: (error) => onNotice(error instanceof Error ? error.message : String(error)),
  });
  const setSpaces = useMutation({
    mutationFn: (spaceIds: string[]) => updateSpaceMembership(itemId, spaceIds),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["item-spaces", itemId] }); void queryClient.invalidateQueries({ queryKey: ["spaces"] }); onChanged(); },
    onError: (error) => onNotice(error instanceof Error ? error.message : String(error)),
  });
  const selected = memberships.data ?? [];
  return <section className="item-organization">
    <div className="detail-section-heading"><TagIcon size={15} /><span>组织</span></div>
    <div className="tag-list">{tags.data?.map((tag) => <span key={tag.id} className="tag-chip">{tag.name}</span>) || <small>尚未添加标签</small>}</div>
    <form className="tag-entry" onSubmit={(event) => { event.preventDefault(); if (tagText.trim()) saveTags.mutate(); }}>
      <input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="标签，用逗号分隔" />
      <button className="button ghost" disabled={saveTags.isPending}>保存</button>
    </form>
    {spaces.data?.length ? <div className="item-space-list">{spaces.data.map((space) => <label key={space.id}><input type="checkbox" checked={selected.includes(space.id)} onChange={(event) => {
      const next = event.target.checked ? [...selected, space.id] : selected.filter((id) => id !== space.id);
      setSpaces.mutate(next);
    }} /><span>{space.name}</span></label>)}</div> : <small>创建空间后，可在这里关联资料。</small>}
  </section>;
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
  const { theme, setTheme } = useAppearance();
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
      <nav className="settings-index" aria-label="设置分区">
        <a href="#settings-appearance">外观</a>
        <a href="#settings-data">本地数据</a>
        <a href="#settings-network">网络与智能</a>
        <a href="#settings-preferences">使用偏好</a>
      </nav>
      <main className="settings-content">
      <section className="settings-section" id="settings-appearance">
        <div className="settings-heading">
          <div className="settings-icon"><Sun size={18} /></div>
          <div>
            <h2>外观</h2>
            <p>默认跟随 Windows，也可以只为 Island 固定主题。</p>
          </div>
        </div>
        <div className="theme-options" role="radiogroup" aria-label="界面主题">
          {([
            ["system", "跟随系统", Monitor],
            ["light", "浅色", Sun],
            ["dark", "深色", Moon],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              role="radio"
              aria-checked={theme === value}
              className={theme === value ? "active" : ""}
              onClick={() => setTheme(value as ThemeMode)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section" id="settings-data">
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

      <section className="settings-section" id="settings-network">
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

      <section className="settings-section" id="settings-preferences">
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
      </main>
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
    <Checkbox
      className={`setting-row ${disabled ? "disabled" : ""}`}
      isSelected={checked}
      isDisabled={disabled}
      onChange={onChange}
    >
      <>
        <strong>{label}</strong>
        <small>{description}</small>
      </>
    </Checkbox>
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
