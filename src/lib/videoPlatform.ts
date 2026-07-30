export type VideoPlatform = {
  id: "youtube" | "bilibili" | "douyin" | "kuaishou" | "xiaohongshu";
  label: string;
  host: string;
};

const platforms: Array<VideoPlatform & { hosts: string[] }> = [
  { id: "youtube", label: "YouTube", host: "youtube.com", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"] },
  { id: "bilibili", label: "Bilibili", host: "bilibili.com", hosts: ["bilibili.com", "www.bilibili.com", "b23.tv"] },
  { id: "douyin", label: "抖音", host: "douyin.com", hosts: ["douyin.com", "www.douyin.com", "v.douyin.com"] },
  { id: "kuaishou", label: "快手", host: "kuaishou.com", hosts: ["kuaishou.com", "www.kuaishou.com", "v.kuaishou.com"] },
  { id: "xiaohongshu", label: "小红书", host: "xiaohongshu.com", hosts: ["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com"] },
];

export function detectVideoPlatform(value?: string | null): VideoPlatform | null {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.toLowerCase();
    const match = platforms.find((platform) => platform.hosts.includes(host));
    return match ? { id: match.id, label: match.label, host: match.host } : null;
  } catch {
    return null;
  }
}
