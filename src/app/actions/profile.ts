// Profile actions: viewing a user's profile, own profile, and editing it.

import { AppState } from "../state.js";

import {
  getOwnProfile,
  downloadMedia,
  setPresenceStatus as ipcSetPresenceStatus,
  setDisplayName as ipcSetDisplayName,
} from "../../ipc/index.js";

import { showError } from "../../ui/NotificationToast.js";

import {
  getComponents,
  _memberAvatarMxc,
  _avatarDataUrl,
  _mediaToBlobUrl,
  resolveDisplayName,
  resolveUserStatus,
} from "./context.js";
import { openOrCreateDm } from "./rooms.js";

/**
 * Open the profile dialog for a specific user ID.
 */
export async function openProfileForUser(userId: string): Promise<void> {
  const { profileDialog } = getComponents();
  try {
    const displayName = resolveDisplayName(userId);
    const mxcUrl = _memberAvatarMxc.get(userId);
    const cachedDataUrl = mxcUrl ? _avatarDataUrl.get(mxcUrl) : undefined;
    let avatarUrl: string | null = null;
    if (cachedDataUrl) {
      avatarUrl = cachedDataUrl;
    } else if (mxcUrl) {
      try {
        const dl = await downloadMedia(mxcUrl);
        avatarUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
        _avatarDataUrl.set(mxcUrl, avatarUrl);
      } catch { /* non-critical */ }
    }
    const ownUserId = AppState.get("ownUserId");
    const onMessage = userId !== ownUserId
      ? () => { void openOrCreateDm(userId); }
      : undefined;
    const statusMessage = await resolveUserStatus(userId);
    profileDialog.show({ userId, displayName, avatarUrl, statusMessage, onMessage });
  } catch (err) {
    showError(`Failed to load profile: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Open the profile dialog. Shows the selected message's sender if one is
 * selected, otherwise shows the current user's own profile.
 */
export async function openProfileDialog(): Promise<void> {
  const { profileDialog, timeline, memberList } = getComponents();
  try {
    // When the member list is focused, show that member's profile instead of
    // the selected message's sender.
    if (AppState.get("activePanel") === "members") {
      const focused = memberList.getFocusedMember();
      if (focused) {
        const mxcUrl = _memberAvatarMxc.get(focused.userId);
        const cachedDataUrl = mxcUrl ? _avatarDataUrl.get(mxcUrl) : undefined;
        let avatarUrl: string | null = null;
        if (cachedDataUrl) {
          avatarUrl = cachedDataUrl;
        } else if (mxcUrl) {
          try {
            const dl = await downloadMedia(mxcUrl);
            avatarUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
            _avatarDataUrl.set(mxcUrl, avatarUrl);
          } catch { /* non-critical */ }
        }
        const ownUserId = AppState.get("ownUserId");
        const onMessage = focused.userId !== ownUserId
          ? () => { void openOrCreateDm(focused.userId); }
          : undefined;
        const statusMessage = await resolveUserStatus(focused.userId);
        profileDialog.show({ userId: focused.userId, displayName: focused.name, avatarUrl, statusMessage, onMessage });
        return;
      }
    }

    const selectedId = timeline.selectedMessageId;
    if (selectedId) {
      // Show the sender of the selected message
      const events = AppState.get("currentTimeline");
      const evt = events.find((e) => e.event_id === selectedId);
      if (evt) {
        const displayName = resolveDisplayName(evt.sender);
        const mxcUrl = _memberAvatarMxc.get(evt.sender);
        const cachedDataUrl = mxcUrl ? _avatarDataUrl.get(mxcUrl) : undefined;
        let avatarUrl: string | null = null;
        if (cachedDataUrl) {
          avatarUrl = cachedDataUrl;
        } else if (mxcUrl) {
          try {
            // Use full media (not thumbnail) so animated GIF/WEBP avatars are preserved.
            const dl = await downloadMedia(mxcUrl);
            avatarUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
            _avatarDataUrl.set(mxcUrl, avatarUrl);
          } catch { /* non-critical */ }
        }
        const ownUserId = AppState.get("ownUserId");
        const onMessage = evt.sender !== ownUserId
          ? () => { void openOrCreateDm(evt.sender); }
          : undefined;
        const statusMessage = await resolveUserStatus(evt.sender);
        profileDialog.show({ userId: evt.sender, displayName, avatarUrl, statusMessage, onMessage });
        return;
      }
    }
    // Fallback: own profile
    await openOwnProfile();
  } catch (err) {
    showError(`Failed to load profile: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Show the current user's own profile dialog with an [edit profile] button.
 *
 * Wired to the SpaceStrip profile button, so it's the universal "my profile"
 * entry point. Keyboard-driven flows still go through `openProfileDialog`,
 * which falls back here when no message or member is selected.
 */
export async function openOwnProfile(): Promise<void> {
  const { profileDialog } = getComponents();
  try {
    const profile = await getOwnProfile();
    let avatarUrl: string | null = null;
    if (profile.avatar_url) {
      try {
        const dl = await downloadMedia(profile.avatar_url);
        avatarUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
      } catch { /* non-critical */ }
    }
    const statusMessage = await resolveUserStatus(profile.user_id);
    profileDialog.show({
      userId: profile.user_id,
      displayName: profile.display_name,
      avatarUrl,
      statusMessage,
      onEdit: () => openProfileEdit(),
    });
  } catch (err) {
    showError(`Failed to load profile: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Open the profile-edit modal pre-filled with the user's current display
 * name and status. On save: persist both via IPC, refresh the status bar
 * presence chip, and surface a toast on failure.
 */
export async function openProfileEdit(): Promise<void> {
  const { profileEditDialog, statusBar } = getComponents();
  let profile;
  try {
    profile = await getOwnProfile();
  } catch (err) {
    showError(`Failed to load profile: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // The presence event handler caches own-user status into AppState, but on
  // cold launch — before the first sync — that cache is empty. resolveUserStatus
  // falls back to an active fetch; if even that fails (e.g. offline), read the
  // status bar as a last resort — it's either fresh from the user's last edit
  // or from the homeserver's previous presence push.
  const fetchedStatus = await resolveUserStatus(profile.user_id);
  const currentStatus = fetchedStatus ?? statusBar.getStatusMessage() ?? null;
  profileEditDialog.show(
    {
      userId: profile.user_id,
      displayName: profile.display_name,
      statusMessage: currentStatus,
    },
    async ({ displayName, statusMessage, displayNameChanged, statusChanged }) => {
      // Persist in parallel — neither call depends on the other and there's
      // no rollback story we can offer either way. The dialog surfaces any
      // error string returned from either IPC.
      const ops: Promise<unknown>[] = [];
      if (displayNameChanged) ops.push(ipcSetDisplayName(displayName));
      if (statusChanged) ops.push(ipcSetPresenceStatus(statusMessage));
      await Promise.all(ops);
      // Reflect the new status in the status bar so the user sees the change
      // without re-opening their profile. The display-name change shows up
      // automatically on the next presence event from the homeserver.
      if (statusChanged) statusBar.setStatusMessage(statusMessage);
      AppState.cacheUserStatus(profile.user_id, statusMessage || null);
    }
  );
}
