import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { getStoredTheme, applyTheme } from "@/lib/theme"
import "./index.css"
import App from "./App"

applyTheme(getStoredTheme())

// Installable mobile app (PWA): register the service worker in production only,
// so local dev keeps hot-reloading without cache surprises.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
