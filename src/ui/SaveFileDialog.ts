// SaveFileDialog — in-app modal for picking a save destination
//
// We can't reliably use a native file picker on every Linux desktop (rfd
// goes through xdg-portal/GTK, which can crash with "No GSettings schemas
// are installed" on misconfigured systems). A small terminal-styled modal
// avoids that whole stack and works the same everywhere.

export interface SaveFilePromptOptions {
  /** Suggested filename (no path). Falls back to "file" if empty. */
  suggestedFilename?: string;
  /** Initial folder shown in the folder input. */
  defaultDir: string;
}

/**
 * Show the save modal. Resolves to the chosen absolute path (folder + filename
 * joined), or `null` if the user cancels.
 *
 * The returned path is *not* validated — the caller passes it to the backend,
 * which expands `~` and creates missing parent directories.
 */
export function promptSaveFilePath(opts: SaveFilePromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "save-file-dialog";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", "Save file");

    const panel = document.createElement("div");
    panel.className = "save-file-dialog__panel";
    backdrop.appendChild(panel);

    // ── Header ─────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "save-file-dialog__header";
    const title = document.createElement("span");
    title.className = "save-file-dialog__title";
    title.textContent = "── save file as ──";
    header.appendChild(title);
    const closeHint = document.createElement("span");
    closeHint.className = "save-file-dialog__close-hint";
    closeHint.textContent = "Esc";
    closeHint.setAttribute("aria-hidden", "true");
    header.appendChild(closeHint);
    panel.appendChild(header);

    // ── Body ───────────────────────────────────────────────────────────────
    const body = document.createElement("div");
    body.className = "save-file-dialog__body";

    const folderLabel = document.createElement("label");
    folderLabel.className = "save-file-dialog__label";
    folderLabel.textContent = "folder:";
    body.appendChild(folderLabel);

    const folderInput = document.createElement("input");
    folderInput.type = "text";
    folderInput.className = "save-file-dialog__input";
    folderInput.value = opts.defaultDir;
    folderInput.setAttribute("spellcheck", "false");
    folderInput.setAttribute("autocomplete", "off");
    folderLabel.appendChild(folderInput);

    const nameLabel = document.createElement("label");
    nameLabel.className = "save-file-dialog__label";
    nameLabel.textContent = "filename:";
    body.appendChild(nameLabel);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "save-file-dialog__input";
    nameInput.value = sanitiseFilename(opts.suggestedFilename) || "file";
    nameInput.setAttribute("spellcheck", "false");
    nameInput.setAttribute("autocomplete", "off");
    nameLabel.appendChild(nameInput);

    panel.appendChild(body);

    // ── Footer ─────────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.className = "save-file-dialog__footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "save-file-dialog__btn";
    cancelBtn.textContent = "[cancel]";
    footer.appendChild(cancelBtn);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "save-file-dialog__btn save-file-dialog__btn--primary";
    saveBtn.textContent = "[save]";
    footer.appendChild(saveBtn);

    panel.appendChild(footer);

    // ── Wiring ─────────────────────────────────────────────────────────────
    let settled = false;
    const cleanup = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKeyDown, true);
    };
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const submit = () => {
      const folder = folderInput.value.trim();
      const name = sanitiseFilename(nameInput.value) || "file";
      if (!folder) {
        folderInput.focus();
        folderInput.select();
        return;
      }
      finish(joinPath(folder, name));
    };

    cancelBtn.addEventListener("click", () => finish(null));
    saveBtn.addEventListener("click", submit);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) finish(null);
    });

    const onKeyDown = (e: KeyboardEvent) => {
      // Capture-phase so we beat the global keymap (which would otherwise
      // route j/k/etc. to room/timeline panels while typing a filename).
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        submit();
        return;
      }
      // Stop propagation for any other key while focus is inside the dialog
      // so vim mode doesn't grab keystrokes meant for the inputs.
      if (backdrop.contains(e.target as Node)) {
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    document.body.appendChild(backdrop);
    // Defer focus + select until next paint so the dialog is positioned.
    requestAnimationFrame(() => {
      nameInput.focus();
      // Select just the basename (drop extension) so common-case rename is
      // one keystroke — same behaviour as native save dialogs.
      const dot = nameInput.value.lastIndexOf(".");
      if (dot > 0) {
        nameInput.setSelectionRange(0, dot);
      } else {
        nameInput.select();
      }
    });
  });
}

/** Strip path separators and other characters that don't belong in a filename. */
function sanitiseFilename(name: string | undefined | null): string {
  if (!name) return "";
  // Take just the basename (in case the suggestion accidentally included a path)
  // then trim characters that are unsafe across Windows/macOS/Linux filenames.
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[<>:"|?*\x00-\x1f]/g, "_").trim();
}

/** Join a folder + filename without depending on a path lib. */
function joinPath(folder: string, name: string): string {
  const trimmed = folder.replace(/\/+$/, "");
  return `${trimmed}/${name}`;
}
