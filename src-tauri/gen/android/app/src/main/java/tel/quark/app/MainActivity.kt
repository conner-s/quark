package tel.quark.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.app.RemoteInput
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    capturePendingNotificationAction(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    capturePendingNotificationAction(intent)
  }

  /**
   * The notification plugin delivers taps/actions as Activity intents and
   * fires its `actionPerformed` event from them — but events that arrive
   * before the frontend registers a listener (cold start, or the webview
   * relaunching while the foreground sync service kept the process alive)
   * are silently dropped. Mirror the intent's extras to a file the Rust
   * `take_pending_notification_action` command reads-and-deletes at boot.
   *
   * Extra keys match tauri-plugin-notification's TauriNotificationManager:
   * "NotificationId", "NotificationUserAction", "LocalNotficationObject"
   * (sic), "NotificationRemoteInput".
   */
  private fun capturePendingNotificationAction(intent: Intent?) {
    if (intent == null || Intent.ACTION_MAIN != intent.action) return
    val notificationId = intent.getIntExtra("NotificationId", Int.MIN_VALUE)
    if (notificationId == Int.MIN_VALUE) return

    try {
      val json = JSONObject()
      json.put("ts", System.currentTimeMillis())
      json.put("actionId", intent.getStringExtra("NotificationUserAction") ?: "tap")
      val input = RemoteInput.getResultsFromIntent(intent)
        ?.getCharSequence("NotificationRemoteInput")
        ?.toString()
      json.put("inputValue", input ?: JSONObject.NULL)
      val notificationJson = intent.getStringExtra("LocalNotficationObject")
      json.put(
        "notification",
        if (notificationJson != null) JSONObject(notificationJson) else JSONObject.NULL
      )
      // dataDir matches Tauri's app_data_dir() on Android.
      File(dataDir, "pending_notification.json").writeText(json.toString())
    } catch (_: Exception) {
      // Non-critical: a lost cold-start tap degrades to opening the app.
    }
  }
}
