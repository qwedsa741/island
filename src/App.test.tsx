import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
    expect(await screen.findByText("Tauri Documentation")).toBeInTheDocument();
    expect(screen.queryByText("Island 产品计划")).not.toBeInTheDocument();
  });

  it("opens the quick text collector", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: /快速收藏/ }));
    await user.click(screen.getByRole("tab", { name: /文字/ }));
    expect(screen.getByPlaceholderText("粘贴一段稍后要找回的文字")).toBeInTheDocument();
  });
});
