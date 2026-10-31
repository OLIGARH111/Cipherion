package app.cipherion.messenger;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/** "Отклонить" on the incoming call notification. */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String call = intent.getStringExtra("call");
        if (call == null) return;
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).cancel("call:" + call, 3);
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                CipherionService.request("/api/call-action", "POST", new JSONObject().put("id", call).put("action", "reject").toString());
            } catch (Exception ignored) {
            } finally {
                pending.finish();
            }
        }).start();
    }
}
