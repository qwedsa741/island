import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { runningInTauri } from "../lib/api";

export function useDesktopDrop(onDrop: (paths: string[]) => void) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!runningInTauri()) return;
    let cleanup: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragging(true);
        } else if (event.payload.type === "leave") {
          setDragging(false);
        } else if (event.payload.type === "drop") {
          setDragging(false);
          onDrop(event.payload.paths);
        }
      })
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch(() => setDragging(false));
    return () => cleanup?.();
  }, [onDrop]);

  return dragging;
}
