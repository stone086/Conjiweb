import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import App from "./app/App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/globals.css";
import { applyTheme, getStoredTheme } from "./utils/theme";
import { applyConfiguredHistoryRetention } from "./services/historyRetention";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } },
});

async function clearLegacyPwaCachesOnce() {
  const flag = "conjiweb-sw-reset-2026-04-20";
  if (localStorage.getItem(flag) === "done") return;
  if (!("serviceWorker" in navigator)) {
    localStorage.setItem(flag, "done");
    return;
  }
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Ignore cache cleanup errors.
  } finally {
    localStorage.setItem(flag, "done");
  }
}

applyTheme(getStoredTheme());
document.documentElement.classList.toggle("density-compact", localStorage.getItem("conjiweb-message-density") === "compact");
applyConfiguredHistoryRetention().catch(() => {});
clearLegacyPwaCachesOnce().catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster
            position="top-right"
            toastOptions={{
              style: { background: "#1a1a2e", color: "#e0e0f0", border: "1px solid rgba(255,255,255,0.08)", fontSize: "13px" },
              success: { iconTheme: { primary: "#22c55e", secondary: "#0f0f1a" } },
              error:   { iconTheme: { primary: "#ef4444", secondary: "#0f0f1a" } },
            }}
          />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
