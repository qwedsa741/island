import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("Island library", () => {
  it("shows the local library and can search preview data", async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByRole("heading", { name: "收件箱" })).toBeInTheDocument();
    const search = screen.getByPlaceholderText("搜索标题、文件名、链接和备注");
    await user.type(search, "Tauri");
    const list = screen.getByRole("region", { name: "资料列表" });
    expect(await within(list).findByText("Tauri Documentation")).toBeInTheDocument();
    expect(screen.queryByText("Island 产品计划")).not.toBeInTheDocument();
  });

  it("opens the quick text collector", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: /新建收藏/ }));
    await user.click(screen.getByRole("menuitem", { name: /保存文字/ }));
    expect(screen.getByPlaceholderText("粘贴一段稍后要找回的文字")).toBeInTheDocument();
  });

  it("supports keyboard navigation and restores focus when the capture menu closes", async () => {
    const user = userEvent.setup();
    renderApp();
    const trigger = await screen.findByRole("button", { name: /新建收藏/ });
    await user.click(trigger);

    expect(screen.getByRole("menuitem", { name: /选择文件/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /保存链接/ })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("can close the selected item detail", async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByRole("complementary", { name: "内容详情" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(screen.queryByRole("complementary", { name: "内容详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "资料列表" })).toBeInTheDocument();
  });

  it("exposes the knowledge Agent workspace without pretending it is ready", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Agent" }));
    expect(screen.getByRole("heading", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByText("与你的知识一起工作")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建知识任务" })).toBeDisabled();
  });

  it("offers the selected item in the built-in reader", async () => {
    renderApp();
    expect(await screen.findByRole("button", { name: /沉浸阅读/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /系统打开/ })).toBeInTheDocument();
  });

  it("opens the space and smart-view organizer", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "空间" }));
    expect(screen.getAllByRole("heading", { name: "空间" }).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("空间名称，例如：设计研究")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("视图名称，例如：待读重点")).toBeInTheDocument();
  });

  it("opens the background processing center", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "处理中" }));
    expect(screen.getAllByRole("heading", { name: "处理中" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "失败" })).toBeInTheDocument();
    expect(screen.getByText("没有后台任务")).toBeInTheDocument();
  });
});
