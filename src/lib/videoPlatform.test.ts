import { describe, expect, it } from "vitest";
import { detectVideoPlatform } from "./videoPlatform";

describe("detectVideoPlatform", () => {
  it("recognizes supported public video links", () => {
    expect(detectVideoPlatform("https://youtu.be/example")?.id).toBe("youtube");
    expect(detectVideoPlatform("https://www.bilibili.com/video/BV1xx")?.id).toBe("bilibili");
    expect(detectVideoPlatform("https://v.douyin.com/example/")?.id).toBe("douyin");
  });

  it("does not misclassify regular web links", () => {
    expect(detectVideoPlatform("https://v2.tauri.app/")).toBeNull();
    expect(detectVideoPlatform("not a url")).toBeNull();
  });
});
