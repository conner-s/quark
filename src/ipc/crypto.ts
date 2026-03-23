// Crypto / verification IPC calls

import { invoke } from "@tauri-apps/api/core";
import type { VerificationStatus } from "./types.js";

export type { VerificationStatus };

/**
 * Get the verification status of the local device.
 * Matches the Rust `get_verification_status` command.
 */
export async function getVerificationStatus(): Promise<VerificationStatus> {
  return invoke<VerificationStatus>("get_verification_status");
}

/**
 * Start a SAS verification flow with a user's device.
 * Returns the flow ID string.
 * Matches the Rust `start_sas_verification` command.
 */
export async function startSasVerification(
  userId: string,
  deviceId: string,
): Promise<string> {
  return invoke<string>("start_sas_verification", { userId, deviceId });
}
