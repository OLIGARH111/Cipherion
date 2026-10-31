package app.cipherion.messenger;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Starts the background connection after the phone restarts or the app updates, like Telegram. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        CipherionService.start(context);
    }
}
