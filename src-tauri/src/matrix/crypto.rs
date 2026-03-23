use matrix_sdk::{
    ruma::UserId,
    Client,
};
use serde::{Deserialize, Serialize};
use tracing::info;

/// Verification status for a device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationStatus {
    pub user_id: String,
    pub device_id: String,
    pub is_verified: bool,
    pub is_cross_signed: bool,
    pub trust_level: String,
}

/// Get verification status for the local device.
pub async fn get_own_verification_status(client: &Client) -> Result<VerificationStatus, String> {
    let user_id = client
        .user_id()
        .ok_or("Not logged in")?;
    let device_id = client
        .device_id()
        .ok_or("No device ID")?;

    let encryption = client.encryption();

    let own_device = encryption
        .get_device(user_id, device_id)
        .await
        .map_err(|e| format!("Failed to get device: {e}"))?
        .ok_or_else(|| "Own device not found in store".to_string())?;

    let is_verified = own_device.is_verified();
    let is_cross_signed = own_device.is_cross_signed_by_owner();

    let trust_level = if is_cross_signed {
        "cross-signed".to_string()
    } else if is_verified {
        "self-verified".to_string()
    } else {
        "unverified".to_string()
    };

    Ok(VerificationStatus {
        user_id: user_id.to_string(),
        device_id: device_id.to_string(),
        is_verified,
        is_cross_signed,
        trust_level,
    })
}

/// Get verification status for another user's devices.
pub async fn get_user_verification_statuses(
    client: &Client,
    user_id_str: &str,
) -> Result<Vec<VerificationStatus>, String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let devices = encryption
        .get_user_devices(&user_id)
        .await
        .map_err(|e| format!("Failed to get user devices: {e}"))?;

    let statuses = devices
        .devices()
        .map(|device| {
            let is_verified = device.is_verified();
            let is_cross_signed = device.is_cross_signed_by_owner();
            let trust_level = if is_cross_signed {
                "cross-signed".to_string()
            } else if is_verified {
                "self-verified".to_string()
            } else {
                "unverified".to_string()
            };

            VerificationStatus {
                user_id: user_id.to_string(),
                device_id: device.device_id().to_string(),
                is_verified,
                is_cross_signed,
                trust_level,
            }
        })
        .collect();

    Ok(statuses)
}

/// Request info about a started SAS verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SasInfo {
    pub flow_id: String,
    pub other_user_id: String,
    pub other_device_id: String,
    /// The emoji list for SAS verification (index 0..6, each is [emoji, description]).
    pub emoji: Vec<[String; 2]>,
    pub decimals: Option<[u16; 3]>,
}

/// Start a SAS verification with a user/device.
/// Returns a flow_id that the frontend can use to accept/confirm.
pub async fn start_sas_verification(
    client: &Client,
    user_id_str: &str,
    device_id_str: &str,
) -> Result<String, String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let device = encryption
        .get_device(&user_id, device_id_str.into())
        .await
        .map_err(|e| format!("Failed to get device: {e}"))?
        .ok_or_else(|| format!("Device {} not found for user {}", device_id_str, user_id_str))?;

    let request = device
        .request_verification()
        .await
        .map_err(|e| format!("Failed to start verification request: {e}"))?;

    let flow_id = request.flow_id().to_string();
    info!(flow_id = %flow_id, user = %user_id_str, device = %device_id_str, "SAS verification requested");
    Ok(flow_id)
}

/// Accept a SAS verification request.
pub async fn accept_sas_verification(
    client: &Client,
    user_id_str: &str,
    flow_id: &str,
) -> Result<(), String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let verification = encryption
        .get_verification(&user_id, flow_id)
        .await
        .ok_or_else(|| format!("Verification flow {} not found", flow_id))?;

    if let matrix_sdk::encryption::verification::Verification::SasV1(sas) = verification {
        sas.accept()
            .await
            .map_err(|e| format!("Failed to accept verification: {e}"))?;
        info!(flow_id = %flow_id, "SAS verification accepted");
    }

    Ok(())
}

/// Confirm a SAS verification (after checking emojis match).
pub async fn confirm_sas_verification(
    client: &Client,
    user_id_str: &str,
    flow_id: &str,
) -> Result<(), String> {
    let user_id =
        UserId::parse(user_id_str).map_err(|e| format!("Invalid user ID: {e}"))?;

    let encryption = client.encryption();

    let verification = encryption
        .get_verification(&user_id, flow_id)
        .await
        .ok_or_else(|| format!("Verification flow {} not found", flow_id))?;

    if let matrix_sdk::encryption::verification::Verification::SasV1(sas) = verification {
        sas.confirm()
            .await
            .map_err(|e| format!("Failed to confirm verification: {e}"))?;
        info!(flow_id = %flow_id, "SAS verification confirmed");
    }

    Ok(())
}
