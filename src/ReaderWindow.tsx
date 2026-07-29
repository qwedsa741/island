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
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

export function ReaderWindow() {
  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
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

  return (
    <div className="reader-shell">
      <header className="reader-toolbar">
        <button
          className="icon-button"
          aria-label="关闭阅读器"
          onClick={() => (runningInTauri() ? getCurrentWindow().close() : window.close())}
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
            <section>
              <h2>来源</h2>
              <p>{item.sourceUrl || item.originalName || "Island 本地收藏"}</p>
              {snapshot && <small>保存于 {new Date(snapshot.capturedAt).toLocaleString("zh-CN")}</small>}
            </section>
            <section>
              <h2>标注</h2>
              <p className="muted">选择正文后即可创建高亮与笔记。标注能力将在下一迭代接通。</p>
            </section>
            <button className="agent-entry">
              <Sparkles size={17} />
              <span><strong>询问 Island Agent</strong><small>以当前内容作为引用范围</small></span>
            </button>
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
