import "./assets/styles.css";

import { createRoot } from "react-dom/client";
import App from "./App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

/*
 * TODO: Make terminal sessions idempotent/reattachable, then re-enable React
 * StrictMode. In development StrictMode mounts effects twice, and App's terminal
 * effect currently spawns a real node-pty shell, causing spawn/kill/spawn races
 * and duplicate startup errors.
 */
createRoot(root).render(<App />);
