import "streamdown/styles.css"
import "./styles.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Router } from "wouter"
import { useHashLocation } from "wouter/use-hash-location"

import { App } from "./App"

// Focus rings are for the keyboard. Chromium sometimes keeps one on a button
// you clicked, so a mouse or trackpad press hides them until a key is used.
const root = document.documentElement
window.addEventListener("pointerdown", () => root.setAttribute("data-pointer", ""), { capture: true, passive: true })
window.addEventListener("keydown", (e) => {
  if (e.key === "Tab" || e.key.startsWith("Arrow")) root.removeAttribute("data-pointer")
}, { capture: true })

// Hash routing: the packaged app loads from a file:// URL
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router hook={useHashLocation}>
      <App />
    </Router>
  </StrictMode>,
)
