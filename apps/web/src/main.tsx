import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import App from "./app/App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } },
});

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
