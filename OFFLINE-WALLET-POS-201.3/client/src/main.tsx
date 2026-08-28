import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import "./index.css";

console.log("[main.tsx] Starting app...");
// alert("Dashboard is starting...");
const rootElement = document.getElementById("root");
console.log("[main.tsx] Root element:", rootElement);

if (!rootElement) {
  console.error("[main.tsx] ERROR: Root element not found!");
} else {
  try {
    ReactDOM.createRoot(rootElement).render(
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    );
    console.log("[main.tsx] App rendered successfully!");
  } catch (error) {
    console.error("[main.tsx] ERROR rendering app:", error);
    rootElement.innerHTML = `
      <div style="padding: 40px; color: red; font-family: sans-serif;">
        <h1>Error Rendering App</h1>
        <pre style="background: #fee; padding: 10px; border-radius: 4px;">${error instanceof Error ? error.message : String(error)}</pre>
        <p>Check the browser console (F12) for more details.</p>
      </div>
    `;
  }
}
