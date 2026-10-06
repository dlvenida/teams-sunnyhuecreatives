import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { getStoredTheme, applyTheme } from "@/lib/theme"
import "./index.css"
import App from "./App"

applyTheme(getStoredTheme())

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
