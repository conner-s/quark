// Smart invoke wrapper — uses real Tauri IPC when available, mock otherwise

import { isTauri, mockInvoke } from "./mock.js";

let realInvoke: typeof import("@tauri-apps/api/core").invoke | null = null;

async function getInvoke() {
  if (isTauri() && !realInvoke) {
    const mod = await import("@tauri-apps/api/core");
    realInvoke = mod.invoke;
  }
  return realInvoke;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = await getInvoke();
  if (fn) {
    return fn<T>(cmd, args);
  }
  return mockInvoke(cmd, args) as Promise<T>;
}
