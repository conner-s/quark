// Quark entry point
// Note: base.css and vars.css are referenced via <link> tags in index.html

import { mountApp } from "./ui/App.js";
import { modeManager, Mode } from "./vim/mode.js";
import { keymapManager } from "./vim/keybindings.js";

// ── Bootstrap ───────────────────────────────────────────────────────────────

const appEl = document.getElementById("app");
if (!appEl) {
  throw new Error("Fatal: #app element not found in DOM");
}

const { input } = mountApp(appEl);

// ── Register default keybindings ─────────────────────────────────────────────

keymapManager.nmap("i", "mode-insert");
keymapManager.nmap(":", "mode-command");
keymapManager.nmap("v", "mode-visual");
keymapManager.nmap("j", "nav-down");
keymapManager.nmap("k", "nav-up");
keymapManager.nmap("gg", "jump-top");
keymapManager.nmap("G", "jump-bottom");
keymapManager.nmap("r", "reply");
keymapManager.nmap("e", "react");
keymapManager.nmap("dd", "redact");
keymapManager.nmap("E", "edit");

// ── Sync input bar with mode manager ─────────────────────────────────────────

modeManager.on((_from, to) => {
  input.setMode(to);
});

// ── Global keyboard event delegation ─────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  const mode = modeManager.current;

  // Escape always returns to Normal
  if (e.key === "Escape") {
    modeManager.transition(Mode.Normal);
    keymapManager.resetSequence();
    return;
  }

  // In Insert or Command mode, let the browser handle text input
  if (mode === Mode.Insert || mode === Mode.Command) {
    return;
  }

  // Normal / Visual — resolve key through keymapManager
  const result = keymapManager.resolveKey(e.key, "global");

  if (result.kind === "action") {
    e.preventDefault();
    dispatchAction(result.action);
  } else if (result.kind === "partial") {
    // Awaiting more keys — suppress default to avoid side effects
    e.preventDefault();
  }
  // "none" — pass through (e.g. Tab for focus management)
});

// ── Action dispatcher ─────────────────────────────────────────────────────────

function dispatchAction(action: string): void {
  switch (action) {
    case "mode-insert":
      modeManager.transition(Mode.Insert);
      input.focus();
      break;

    case "mode-command":
      modeManager.transition(Mode.Command);
      input.focus();
      break;

    case "mode-visual":
      modeManager.transition(Mode.Visual);
      break;

    // Navigation and other actions will be wired to actual components as they
    // are implemented. For now, emit a custom event for extensibility.
    default:
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action } }));
      break;
  }
}
