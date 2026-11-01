package app.cipherion.messenger;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Checks the site for a newer APK when the app opens and installs it over the current one.
 * The build publishes /android/version.json and /android/Cipherion.apk next to the web app.
 */
public class Updater {
    private static final long CHECK_EVERY = 3 * 60 * 60 * 1000L;
    private static boolean busy;
    private static final Handler main = new Handler(Looper.getMainLooper());

    /** Called from onResume; checks at most every few hours unless {@code force}. */
    static void check(Activity activity, boolean force) {
        SharedPreferences sp = activity.getSharedPreferences("app", Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (busy || (!force && now - sp.getLong("updateChecked", 0) < CHECK_EVERY)) return;
        busy = true;
        new Thread(() -> {
            try {
                JSONObject v = new JSONObject(fetchText(BuildConfig.SITE_URL + "/android/version.json"));
                sp.edit().putLong("updateChecked", now).apply();
                int code = v.optInt("versionCode");
                if (code > BuildConfig.VERSION_CODE && code != sp.getInt("updateSkipped", 0)) {
                    main.post(() -> offer(activity, v));
                    return;
                }
            } catch (Exception ignored) {
            }
            busy = false;
        }).start();
    }

    private static void offer(Activity activity, JSONObject v) {
        if (activity.isFinishing()) { busy = false; return; }
        String notes = v.optString("notes", "");
        new AlertDialog.Builder(activity)
                .setTitle("Доступно обновление")
                .setMessage("Cipherion " + v.optString("versionName") + (notes.isEmpty() ? "" : "\n\n" + notes)
                        + "\n\nВаши чаты и вход сохранятся.")
                .setCancelable(false)
                .setPositiveButton("Обновить", (d, w) -> start(activity, v))
                .setNegativeButton("Позже", (d, w) -> busy = false)
                .show();
    }

    private static void start(Activity activity, JSONObject v) {
        // Android 8+: the user allows installs from Cipherion once, then updates go straight through.
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            busy = false;
            new AlertDialog.Builder(activity)
                    .setTitle("Разрешите обновления")
                    .setMessage("Включите «Разрешить установку из этого источника» для Cipherion и вернитесь в приложение — обновление продолжится.")
                    .setPositiveButton("Открыть настройки", (d, w) -> {
                        activity.getSharedPreferences("app", Context.MODE_PRIVATE).edit().putLong("updateChecked", 0).apply();
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                    })
                    .setNegativeButton("Позже", null)
                    .show();
            return;
        }
        AlertDialog progress = new AlertDialog.Builder(activity)
                .setTitle("Обновление Cipherion")
                .setMessage("Загрузка… 0%")
                .setCancelable(false)
                .show();
        String apkUrl = v.optString("url", "/android/Cipherion.apk");
        if (apkUrl.startsWith("/")) apkUrl = BuildConfig.SITE_URL + apkUrl;
        String url = apkUrl;
        new Thread(() -> {
            try {
                install(activity, url, percent -> main.post(() -> progress.setMessage("Загрузка… " + percent + "%")));
                main.post(() -> progress.setMessage("Установка…"));
            } catch (Exception e) {
                main.post(() -> {
                    progress.dismiss();
                    busy = false;
                    Toast.makeText(activity, "Не удалось загрузить обновление. Попробуйте позже.", Toast.LENGTH_LONG).show();
                });
            }
        }).start();
    }

    interface Progress {
        void update(int percent);
    }

    /** Streams the APK straight into a PackageInstaller session; no file or FileProvider is needed. */
    private static void install(Activity activity, String url, Progress progress) throws Exception {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(activity.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("Cache-Control", "no-cache");
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            long total = c.getContentLengthLong();
            try (InputStream in = c.getInputStream(); OutputStream out = session.openWrite("Cipherion.apk", 0, total)) {
                byte[] buf = new byte[65536];
                long done = 0;
                int n, last = -1;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    if (total > 0) {
                        int p = (int) (done * 100 / total);
                        if (p != last) progress.update(last = p);
                    }
                }
                session.fsync(out);
            } finally {
                c.disconnect();
            }
            Intent done = new Intent(activity, InstallReceiver.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(activity, id, done, flags).getIntentSender());
        } catch (Exception e) {
            installer.abandonSession(id);
            throw e;
        }
    }

    private static String fetchText(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url + "?t=" + System.currentTimeMillis()).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        try (InputStream in = c.getInputStream()) {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }

    /** Receives the installer's answer: shows the system confirmation or reports a failure. */
    public static class InstallReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(confirm);
                }
                return;
            }
            busy = false;
            if (status != PackageInstaller.STATUS_SUCCESS) {
                String reason = status == PackageInstaller.STATUS_FAILURE_CONFLICT || status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE
                        ? "Эта версия подписана другим ключом — удалите Cipherion и установите заново один раз."
                        : status == PackageInstaller.STATUS_FAILURE_ABORTED ? "Обновление отменено." : "Не удалось установить обновление.";
                Toast.makeText(context, reason, Toast.LENGTH_LONG).show();
            }
        }
    }
}
