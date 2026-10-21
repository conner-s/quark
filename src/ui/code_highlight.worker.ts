// The code-highlighting worker: highlight.js, off the main thread.
//
// Code blocks come from arbitrary senders, and some grammars take time
// quadratic in the right input — up to seconds for one block (the numbers are
// in code_highlight.ts). Here that costs a worker thread instead of the UI, and
// the main thread can terminate this worker when a job runs past its deadline.
//
// Created by code_highlight.ts as a same-origin *module* worker: a module
// worker can `import()` the core and each grammar as their own chunks (a
// classic one would need every grammar bundled in), and the CSP has no `blob:`
// in script-src, so it can't be inlined. It takes one request at a time — the
// main thread waits for each reply before posting the next.

import {
  createGrammarRegistry,
  handleHighlightRequest,
  type HighlightReply,
  type HighlightRequest,
} from "./code_highlight_grammars.js";

/**
 * The slice of DedicatedWorkerGlobalScope used here. The project compiles
 * against the DOM lib, not WebWorker (one tsconfig for every file), so the
 * global is typed this narrowly rather than pulling a second lib's globals
 * into every other file.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<HighlightRequest>) => void) | null;
  postMessage(message: HighlightReply): void;
}

// Only inside a worker. The tests import this file into a window, where
// `self.onmessage` would be the page's own message handler.
if ("WorkerGlobalScope" in globalThis) {
  const scope = self as unknown as WorkerScope;
  const registry = createGrammarRegistry();
  scope.onmessage = (event) => {
    void handleHighlightRequest(registry, event.data, (reply) => scope.postMessage(reply));
  };
}
