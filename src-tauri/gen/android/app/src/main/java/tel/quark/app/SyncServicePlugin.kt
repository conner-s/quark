package tel.quark.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * App-local Tauri plugin bridging the Rust backend to [SyncForegroundService].
 * Registered from Rust via `register_android_plugin` (mobile_sync.rs) and
 * invoked only through `run_mobile_plugin` — there is no JS surface.
 */
@TauriPlugin
class SyncServicePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun start(invoke: Invoke) {
    val intent = Intent(activity, SyncForegroundService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      activity.startForegroundService(intent)
    } else {
      activity.startService(intent)
    }
    invoke.resolve()
  }

  @Command
  fun stop(invoke: Invoke) {
    activity.stopService(Intent(activity, SyncForegroundService::class.java))
    invoke.resolve()
  }

  @Command
  fun status(invoke: Invoke) {
    val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
    val result = JSObject()
    result.put("running", SyncForegroundService.isRunning)
    result.put("batteryExempt", pm.isIgnoringBatteryOptimizations(activity.packageName))
    invoke.resolve(result)
  }

  /**
   * Ask the user to exempt Quark from battery optimization so Doze doesn't
   * throttle the sync connection. Falls back to the optimization-settings
   * list if the direct request intent is unavailable on this build.
   */
  @SuppressLint("BatteryLife")
  @Command
  fun requestBatteryExemption(invoke: Invoke) {
    val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
    if (pm.isIgnoringBatteryOptimizations(activity.packageName)) {
      invoke.resolve()
      return
    }
    try {
      activity.startActivity(
        Intent(
          Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          Uri.parse("package:${activity.packageName}")
        )
      )
    } catch (_: Exception) {
      try {
        activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
      } catch (_: Exception) {
        // Settings screen unavailable — nothing more we can do.
      }
    }
    invoke.resolve()
  }
}
