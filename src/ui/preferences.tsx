/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ReaderFont = "serif" | "sans";
export type ReaderMeasure = "narrow" | "standard" | "wide";

export interface ReaderAppearance {
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
  measure: ReaderMeasure;
}

const THEME_KEY = "island.theme";
const READER_KEY = "island.reader-appearance";

const defaultReaderAppearance: ReaderAppearance = {
  font: "serif",
  fontSize: 17,
  lineHeight: 1.76,
  measure: "standard",
};

interface AppearanceContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  reader: ReaderAppearance;
  updateReader: (next: Partial<ReaderAppearance>) => void;
  resetReader: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function readTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function readReaderAppearance(): ReaderAppearance {
  try {
    const stored = JSON.parse(window.localStorage.getItem(READER_KEY) ?? "{}") as Partial<ReaderAppearance>;
    return {
      font: stored.font === "sans" ? "sans" : "serif",
      fontSize: Math.min(22, Math.max(15, stored.fontSize ?? defaultReaderAppearance.fontSize)),
      lineHeight: Math.min(1.9, Math.max(1.55, stored.lineHeight ?? defaultReaderAppearance.lineHeight)),
      measure:
        stored.measure === "narrow" || stored.measure === "wide"
          ? stored.measure
          : "standard",
    };
  } catch {
    return defaultReaderAppearance;
  }
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readTheme);
  const [reader, setReader] = useState<ReaderAppearance>(readReaderAppearance);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = theme === "system" ? (media?.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    applyTheme();
    media?.addEventListener("change", applyTheme);
    return () => media?.removeEventListener("change", applyTheme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
  }, []);

  const updateReader = useCallback((next: Partial<ReaderAppearance>) => {
    setReader((current) => {
      const value = { ...current, ...next };
      window.localStorage.setItem(READER_KEY, JSON.stringify(value));
      return value;
    });
  }, []);

  const resetReader = useCallback(() => {
    window.localStorage.setItem(READER_KEY, JSON.stringify(defaultReaderAppearance));
    setReader(defaultReaderAppearance);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, reader, updateReader, resetReader }),
    [reader, resetReader, setTheme, theme, updateReader],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider");
  return value;
}
