// Smart invoke wrapper — uses real Tauri IPC when available, mock otherwise

import { isTauri, mockInvoke } from "./mock.js";

let realInvoke: typeof import("@tauri-apps/api/core").invoke | null = null;
let _forceMock = false;

/** Force all IPC calls through the mock backend (for debug mode). */
export function setForceMock(enabled: boolean): void {
  _forceMock = enabled;
}

async function getInvoke() {
  if (!_forceMock && isTauri() && !realInvoke) {
    const mod = await import("@tauri-apps/api/core");
    realInvoke = mod.invoke;
  }
  return _forceMock ? null : realInvoke;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = await getInvoke();
  if (fn) {
    return fn<T>(cmd, args);
  }
  return mockInvoke(cmd, args) as Promise<T>;
}
