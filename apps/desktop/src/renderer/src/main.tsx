import "streamdown/styles.css"
import "./styles.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Router } from "wouter"
import { useHashLocation } from "wouter/use-hash-location"

import { App } from "./App"

// Hash routing: the packaged app loads from a file:// URL
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router hook={useHashLocation}>
      <App />
    </Router>
  </StrictMode>,
)
