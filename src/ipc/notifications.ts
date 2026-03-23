// Notification IPC calls — mirrors the Rust notification commands.

import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Quiet-hours window — matches notifications::QuietHours */
export interface QuietHours {
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
}

/** Notification preferences — matches notifications::NotificationConfig */
export interface NotificationConfig {
  enabled: boolean;
  show_body: boolean;
  show_sender: boolean;
  mute_rooms: string[];
  quiet_hours: QuietHours | null;
}

// ─── IPC Functions ────────────────────────────────────────────────────────────

/** Fetch the current notification configuration from the backend. */
export async function getNotificationConfig(): Promise<NotificationConfig> {
  return invoke<NotificationConfig>("get_notification_config");
}

/** Replace the current notification configuration on the backend. */
export async function setNotificationConfig(
  config: NotificationConfig
): Promise<void> {
  return invoke<void>("set_notification_config", { config });
}

/** Add a room to the mute list. */
export async function muteRoomIpc(roomId: string): Promise<void> {
  return invoke<void>("mute_room", { roomId });
}

/** Remove a room from the mute list. */
export async function unmuteRoomIpc(roomId: string): Promise<void> {
  return invoke<void>("unmute_room", { roomId });
}

/** Send a test OS notification to verify the system is working. */
export async function testNotification(): Promise<void> {
  return invoke<void>("test_notification");
}
