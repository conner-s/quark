// Root layout component — full application layout assembly

import { LoginScreen } from "./LoginScreen.js";
import { SpaceStrip } from "./SpaceStrip.js";
import { RoomList } from "./RoomList.js";
import { RoomHeader } from "./RoomHeader.js";
import { Timeline } from "./Timeline.js";
import { ReplyPreview } from "./ReplyPreview.js";
import { Input } from "./Input.js";
import { StatusBar } from "./StatusBar.js";
import { CommandBar } from "./CommandBar.js";
import { ThreadView } from "./ThreadView.js";
import { MemberList } from "./MemberList.js";
import { EmojiPicker } from "./EmojiPicker.js";
import { GifPicker } from "./GifPicker.js";
import { HelpDialog } from "./HelpDialog.js";
import { Verification } from "./Verification.js";
import { DevicePicker } from "./DevicePicker.js";
import { ShortcodePreview } from "./ShortcodePreview.js";
import { QuickReactPicker } from "./QuickReactPicker.js";
import { ProfileDialog } from "./ProfileDialog.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { RoomInfoDialog } from "./RoomInfoDialog.js";
import { PinnedMessagesDialog } from "./PinnedMessagesDialog.js";
import { RoomDirectoryDialog } from "./RoomDirectoryDialog.js";
import { ImageLightbox } from "./ImageLightbox.js";

// ── AppComponents ─────────────────────────────────────────────────────────────

export interface AppComponents {
  // Pre-auth
  loginScreen: LoginScreen;

  // Navigation
  spaceStrip: SpaceStrip;
  roomList: RoomList;

  // Main panel
  roomHeader: RoomHeader;
  timeline: Timeline;
  replyPreview: ReplyPreview;
  input: Input;

  // Sidebars
  threadView: ThreadView;
  memberList: MemberList;

  // Overlays
  emojiPicker: EmojiPicker;
  gifPicker: GifPicker;
  verification: Verification;
  devicePicker: DevicePicker;
  shortcodePreview: ShortcodePreview;
  helpDialog: HelpDialog;
  commandBar: CommandBar;
  quickReactPicker: QuickReactPicker;
  profileDialog: ProfileDialog;
  settingsDialog: SettingsDialog;
  roomInfoDialog: RoomInfoDialog;
  pinnedMessagesDialog: PinnedMessagesDialog;
  roomDirectoryDialog: RoomDirectoryDialog;
  imageLightbox: ImageLightbox;

  // Status
  statusBar: StatusBar;

  // Typing indicator element (below compose box)
  typingIndicator: HTMLElement;

  // Layout roots (for show/hide)
  mainLayout: HTMLElement;
}

/**
 * Mount the full Quark UI into the given container.
 * Shows the login screen initially; call showMainLayout() after login.
 */
export function mountApp(container: HTMLElement): AppComponents {
  container.innerHTML = "";

  // ── Instantiate all components ───────────────────────────────────────────

  const loginScreen = new LoginScreen();
  const spaceStrip = new SpaceStrip();
  const roomList = new RoomList();
  const roomHeader = new RoomHeader();
  const timeline = new Timeline();
  const replyPreview = new ReplyPreview();
  const input = new Input();
  const statusBar = new StatusBar();
  const commandBar = new CommandBar();
  const threadView = new ThreadView();
  const memberList = new MemberList();
  const emojiPicker = new EmojiPicker();
  const gifPicker = new GifPicker();
  const verification = new Verification();
  const devicePicker = new DevicePicker();
  const shortcodePreview = new ShortcodePreview();
  const helpDialog = new HelpDialog();
  const quickReactPicker = new QuickReactPicker();
  const profileDialog = new ProfileDialog();
  const settingsDialog = new SettingsDialog();
  const roomInfoDialog = new RoomInfoDialog();
  const pinnedMessagesDialog = new PinnedMessagesDialog();
  const roomDirectoryDialog = new RoomDirectoryDialog();
  const imageLightbox = new ImageLightbox();

  // ── Login screen ─────────────────────────────────────────────────────────
  container.appendChild(loginScreen.getElement());

  // ── Main layout (hidden until login succeeds) ─────────────────────────────
  const mainLayout = document.createElement("div");
  mainLayout.className = "quark-layout";
  mainLayout.style.display = "none";

  // Column 1: Space strip
  mainLayout.appendChild(spaceStrip.getElement());

  // Column 2: Room list
  mainLayout.appendChild(roomList.getElement());

  // Column 3: Content area (room header + timeline + reply preview + input)
  const contentArea = document.createElement("div");
  contentArea.className = "content-area";

  contentArea.appendChild(roomHeader.getElement());
  contentArea.appendChild(timeline.getElement());
  contentArea.appendChild(replyPreview.getElement());

  // Shortcode preview sits above input bar
  contentArea.appendChild(shortcodePreview.getElement());
  contentArea.appendChild(commandBar.getElement());
  contentArea.appendChild(input.getElement());

  // Typing indicator sits below the input bar
  const typingIndicator = document.createElement("div");
  typingIndicator.className = "typing-indicator";
  const typingDots = document.createElement("span");
  typingDots.className = "typing-indicator__dots";
  typingDots.innerHTML = "<span></span><span></span><span></span>";
  typingIndicator.appendChild(typingDots);
  const typingText = document.createElement("span");
  typingText.className = "typing-indicator__text";
  typingIndicator.appendChild(typingText);
  contentArea.appendChild(typingIndicator);

  mainLayout.appendChild(contentArea);

  // Column 4: Thread view sidebar (hidden by default)
  mainLayout.appendChild(threadView.getElement());

  // Column 5: Member list sidebar (hidden by default)
  mainLayout.appendChild(memberList.getElement());

  container.appendChild(mainLayout);

  // ── Align compose-box right edge with message bubbles ────────────────────
  // The timeline scrollbar takes space from its content area (classic scrollbars)
  // or nothing (overlay scrollbars on macOS). Measure the actual gutter width at
  // runtime so the input-bar's padding-right always matches — regardless of OS
  // scrollbar style, user preferences, or DPI.
  const timelineEl = timeline.getElement();
  const inputBarEl = input.getInputBarElement();
  const syncComposeRight = () => {
    const gutterPx = timelineEl.offsetWidth - timelineEl.clientWidth;
    inputBarEl.style.paddingRight = `${12 + gutterPx}px`;
  };
  syncComposeRight();
  new ResizeObserver(syncComposeRight).observe(timelineEl);

  // ── Status bar (fixed bottom-right, floats over content) ─────────────────
  container.appendChild(statusBar.getElement());

  // ── Overlays (appended to body so they float above everything) ───────────
  document.body.appendChild(emojiPicker.getElement());
  document.body.appendChild(gifPicker.getElement());
  document.body.appendChild(verification.getElement());
  document.body.appendChild(devicePicker.getElement());
  document.body.appendChild(helpDialog.getElement());
  document.body.appendChild(quickReactPicker.getElement());
  document.body.appendChild(profileDialog.getElement());
  document.body.appendChild(settingsDialog.getElement());
  document.body.appendChild(roomInfoDialog.getElement());
  document.body.appendChild(pinnedMessagesDialog.getElement());
  document.body.appendChild(roomDirectoryDialog.getElement());
  document.body.appendChild(imageLightbox.getElement());

  return {
    loginScreen,
    spaceStrip,
    roomList,
    roomHeader,
    timeline,
    replyPreview,
    input,
    statusBar,
    commandBar,
    threadView,
    memberList,
    emojiPicker,
    gifPicker,
    verification,
    devicePicker,
    shortcodePreview,
    helpDialog,
    quickReactPicker,
    profileDialog,
    settingsDialog,
    roomInfoDialog,
    pinnedMessagesDialog,
    roomDirectoryDialog,
    imageLightbox,
    typingIndicator,
    mainLayout,
  };
}

/**
 * Transition from login screen to main app layout.
 */
export function showMainLayout(components: AppComponents): void {
  components.loginScreen.hide();
  components.mainLayout.style.display = "";
}
