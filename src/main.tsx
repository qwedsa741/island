import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "@fontsource/noto-serif-sc/chinese-simplified-400.css";
import "./styles.css";
import { AppearanceProvider } from "./ui/preferences";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <App />
      </AppearanceProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
