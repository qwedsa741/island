import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileQuestion,
  Globe2,
  Minus,
  PanelRightClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Text,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getReaderResource,
  localAssetUrl,
  openLiveReader,
  runningInTauri,
} from "./lib/api";
import { useAppearance } from "./ui/preferences";

export function ReaderWindow({
  itemId,
  onClose,
}: {
  itemId?: string;
  onClose?: () => void;
}) {
  const id = itemId ?? new URLSearchParams(window.location.search).get("id") ?? "";
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [contextTab, setContextTab] = useState<"outline" | "annotations" | "related" | "agent">("outline");
  const { reader, updateReader, resetReader } = useAppearance();
  const resource = useQuery({
    queryKey: ["reader-resource", id],
    queryFn: () => getReaderResource(id),
    enabled: Boolean(id),
  });

  if (!id) return <ReaderError message="没有指定要阅读的内容" />;
  if (resource.isLoading) return <div className="reader-loading">正在准备阅读器…</div>;
  if (resource.isError || !resource.data) {
    return <ReaderError message={resource.error instanceof Error ? resource.error.message : "无法打开内容"} />;
  }

  const { item, snapshot, mode } = resource.data;
  const localPath = snapshot?.sanitizedPath ?? item.localPath;
  const assetUrl = localAssetUrl(localPath);
  const readerStyle = {
    "--reader-font-size": `${reader.fontSize}px`,
    "--reader-line-height": reader.lineHeight,
    "--reader-measure": reader.measure === "narrow" ? "58ch" : reader.measure === "wide" ? "78ch" : "68ch",
  } as CSSProperties;

  return (
    <div className={`reader-shell reader-font-${reader.font}`} style={readerStyle}>
      <header className="reader-toolbar">
        <button
          className="icon-button"
          aria-label="关闭阅读器"
          onClick={() => {
            if (onClose) {
              onClose();
              return;
            }
            if (runningInTauri()) void getCurrentWindow().close();
            else window.close();
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="reader-title">
          <strong>{item.title}</strong>
          <span>
            {mode === "web-snapshot" ? (
              <>
                <ShieldCheck size={13} /> 已保存快照
              </>
            ) : (
              item.originalName ?? "Island 本地内容"
            )}
          </span>
        </div>
        <label className="reader-find">
          <Search size={15} />
          <input placeholder="在内容中查找" aria-label="在内容中查找" />
        </label>
        <div className="reader-appearance-wrap">
          <button
            className="icon-button"
            aria-label="阅读外观"
            aria-expanded={appearanceOpen}
            onClick={() => setAppearanceOpen((open) => !open)}
          >
            <Settings2 size={17} />
          </button>
          {appearanceOpen && (
            <div className="reader-appearance-panel">
              <div className="appearance-heading">
                <strong>阅读外观</strong>
                <button onClick={resetReader}>恢复默认</button>
              </div>
              <label>
                <span>正文字体</span>
                <select value={reader.font} onChange={(event) => updateReader({ font: event.target.value as "serif" | "sans" })}>
                  <option value="serif">思源宋体</option>
                  <option value="sans">无衬线</option>
                </select>
              </label>
              <label>
                <span>字号 <output>{reader.fontSize}px</output></span>
                <input type="range" min="15" max="22" step="1" value={reader.fontSize} onChange={(event) => updateReader({ fontSize: Number(event.target.value) })} />
              </label>
              <label>
                <span>行距 <output>{reader.lineHeight.toFixed(2)}</output></span>
                <input type="range" min="1.55" max="1.9" step=".05" value={reader.lineHeight} onChange={(event) => updateReader({ lineHeight: Number(event.target.value) })} />
              </label>
              <fieldset>
                <legend>版心宽度</legend>
                <div className="appearance-segments">
                  {(["narrow", "standard", "wide"] as const).map((measure) => (
                    <button
                      key={measure}
                      className={reader.measure === measure ? "active" : ""}
                      onClick={() => updateReader({ measure })}
                    >
                      {{ narrow: "窄", standard: "标准", wide: "宽" }[measure]}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </div>
        {item.sourceUrl && (
          <button className="button secondary" onClick={() => openLiveReader(item.sourceUrl!)}>
            <Globe2 size={16} /> 在线查看
          </button>
        )}
        <button
          className="icon-button"
          onClick={() => setRightPanelOpen((open) => !open)}
          aria-label={rightPanelOpen ? "收起阅读侧栏" : "展开阅读侧栏"}
        >
          <PanelRightClose size={18} />
        </button>
      </header>

      <main className={`reader-workspace ${rightPanelOpen ? "" : "reader-panel-hidden"}`}>
        <section className="reader-surface">
          {mode === "pdf" && assetUrl ? (
            <PdfReader url={assetUrl} />
          ) : mode === "image" && assetUrl ? (
            <div className="image-reader"><img src={assetUrl} alt={item.title} /></div>
          ) : mode === "text" ? (
            <article className="text-reader"><pre>{item.plainText || "暂无可读文字"}</pre></article>
          ) : mode === "web-snapshot" && assetUrl ? (
            <iframe
              className="snapshot-frame"
              src={assetUrl}
              title={`${item.title} 的安全快照`}
              sandbox=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <ReaderError message="当前格式暂不支持内置预览，可返回资料库使用系统应用打开。" />
          )}
        </section>

        {rightPanelOpen && (
          <aside className="reader-context">
            <div className="reader-context-heading">
              <span>阅读上下文</span>
              <button className="icon-button compact" aria-label="收起" onClick={() => setRightPanelOpen(false)}>
                <PanelRightClose size={15} />
              </button>
            </div>
            <div className="reader-context-tabs" role="tablist" aria-label="阅读上下文">
              {([
                ["outline", "目录"],
                ["annotations", "标注"],
                ["related", "关联"],
                ["agent", "Agent"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={contextTab === value}
                  onClick={() => setContextTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="reader-context-panel" role="tabpanel">
              {contextTab === "outline" && (
                <section>
                  <h2><Text size={15} /> 来源与目录</h2>
                  <p>{item.sourceUrl || item.originalName || "Island 本地收藏"}</p>
                  {snapshot && <small>快照保存于 {new Date(snapshot.capturedAt).toLocaleString("zh-CN")}</small>}
                  <p className="muted">解析完成后，章节目录会显示在这里。</p>
                </section>
              )}
              {contextTab === "annotations" && (
                <section>
                  <h2>标注</h2>
                  <p className="muted">选择正文后即可创建高亮与笔记。标注能力将在下一迭代接通。</p>
                </section>
              )}
              {contextTab === "related" && (
                <section>
                  <h2>相关资料</h2>
                  <p className="muted">Island 将根据来源、标签和正文发现相关内容。</p>
                </section>
              )}
              {contextTab === "agent" && (
                <section className="reader-agent-panel">
                  <Sparkles size={19} />
                  <h2>询问 Island Agent</h2>
                  <p>当前资料会作为明确的引用范围，不会自动扩展到整个资料库。</p>
                  <button className="button primary" disabled>开始知识任务</button>
                  <small><ShieldCheck size={13} /> 尚未配置模型，不会发送任何内容</small>
                </section>
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

function PdfReader({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.15);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    void import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
      task = pdfjs.getDocument(url);
      return task.promise;
    }).then((pdf) => {
      if (!cancelled && pdf) setDocument(pdf);
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    void document.getPage(page).then((pdfPage) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport });
      return renderTask.promise;
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, page, scale]);

  return (
    <div className="pdf-reader">
      <div className="pdf-controls">
        <button className="icon-button compact" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
          <ChevronLeft size={16} />
        </button>
        <span>{page} / {document?.numPages ?? "…"}</span>
        <button className="icon-button compact" disabled={!document || page >= document.numPages} onClick={() => setPage((value) => value + 1)}>
          <ChevronRight size={16} />
        </button>
        <span className="pdf-divider" />
        <button className="icon-button compact" onClick={() => setScale((value) => Math.max(.6, value - .15))}><Minus size={15} /></button>
        <span>{Math.round(scale * 100)}%</span>
        <button className="icon-button compact" onClick={() => setScale((value) => Math.min(2.5, value + .15))}><Plus size={15} /></button>
      </div>
      <div className="pdf-canvas-wrap"><canvas ref={canvasRef} /></div>
    </div>
  );
}

function ReaderError({ message }: { message: string }) {
  return (
    <div className="reader-error">
      <FileQuestion size={30} />
      <strong>暂时无法预览</strong>
      <p>{message}</p>
      <button className="button secondary" onClick={() => window.history.back()}>
        <ExternalLink size={16} /> 返回
      </button>
    </div>
  );
}
