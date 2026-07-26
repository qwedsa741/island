import { describe, expect, it, vi } from "vitest";
import { formatBytes, formatRelativeDate } from "./format";

describe("formatBytes", () => {
  it("formats common file sizes", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });
});

describe("formatRelativeDate", () => {
  it("formats recent timestamps in Chinese", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    expect(formatRelativeDate("2026-07-26T11:55:00Z")).toBe("5 分钟前");
    expect(formatRelativeDate("2026-07-25T12:00:00Z")).toBe("1 天前");
    vi.useRealTimers();
  });
});
