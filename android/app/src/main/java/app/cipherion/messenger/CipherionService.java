package app.cipherion.messenger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Keeps one live connection to the server, like Telegram's background service, and turns
 * new messages and incoming calls into system notifications while the app is not on screen.
 */
public class CipherionService extends Service {
    static final String CHANNEL_MESSAGES = "messages";
    static final String CHANNEL_CALLS = "calls";
    static final String CHANNEL_SERVICE = "service";
    static final int ID_SERVICE = 1;
    static final String EXTRA_LINK = "link";

    private static volatile boolean running;
    private volatile boolean stopped;
    private volatile HttpURLConnection stream;
    private Thread worker;
    private final Handler main = new Handler(Looper.getMainLooper());

    // State read from the server; touched only on the worker thread.
    private String me;
    private JSONObject prefs = new JSONObject();
    private JSONObject settings = new JSONObject();
    private final Map<String, JSONObject> chats = new HashMap<>();
    private final Set<String> seen = new LinkedHashSet<>();
    private final Map<String, List<String>> lines = new HashMap<>();
    private final Set<String> ringing = new HashSet<>();
    // Newest message time per chat, in server time, so edits and reactions on older messages stay quiet.
    private final Map<String, Long> newest = new HashMap<>();

    public static void start(Context context) {
        if (running) return;
        Intent intent = new Intent(context, CipherionService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (Exception ignored) {
            // Android may refuse a start from the background; the app retries when it opens.
        }
    }

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        NotificationChannel messages = new NotificationChannel(CHANNEL_MESSAGES, "Сообщения", NotificationManager.IMPORTANCE_HIGH);
        messages.enableVibration(true);
        messages.setShowBadge(true);
        nm.createNotificationChannel(messages);

        NotificationChannel calls = new NotificationChannel(CHANNEL_CALLS, "Входящие звонки", NotificationManager.IMPORTANCE_HIGH);
        calls.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[]{0, 800, 600, 800, 600, 800});
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(calls);

        NotificationChannel service = new NotificationChannel(CHANNEL_SERVICE, "Фоновое подключение", NotificationManager.IMPORTANCE_MIN);
        service.setDescription("Нужно, чтобы сообщения и звонки приходили, когда приложение закрыто. Это уведомление можно скрыть в настройках канала.");
        service.setShowBadge(false);
        nm.createNotificationChannel(service);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        createChannels(this);
        Notification n = builder(CHANNEL_SERVICE)
                .setContentTitle("Cipherion на связи")
                .setContentText("Сообщения и звонки придут, даже когда приложение закрыто")
                .setSmallIcon(R.drawable.ic_notify)
                .setOngoing(true)
                .setContentIntent(openApp(this, null, 0))
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID_SERVICE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        else startForeground(ID_SERVICE, n);
        worker = new Thread(this::loop, "cipherion-events");
        worker.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        running = false;
        HttpURLConnection s = stream;
        if (s != null) s.disconnect();
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------------------------------------------------------------- connection

    private void loop() {
        long delay = 2000;
        while (!stopped) {
            try {
                int status = listen();
                if (status == 401 || status == 403) {
                    // Signed out: nothing to listen to until the user signs in again in the app.
                    main.post(this::stopSelf);
                    return;
                }
                delay = 2000;
            } catch (Exception ignored) {
                // Network change or server restart: retry with backoff.
            }
            if (stopped) return;
            try {
                Thread.sleep(delay);
            } catch (InterruptedException e) {
                return;
            }
            delay = Math.min(delay * 2, 60000);
        }
    }

    /** Reads the server's event stream until it closes. Returns the HTTP status on failure. */
    private int listen() throws IOException {
        JSONObject meResponse;
        try {
            meResponse = new JSONObject(get("/api/me"));
        } catch (HttpError e) {
            return e.status;
        } catch (Exception e) {
            throw new IOException(e);
        }
        me = meResponse.optJSONObject("user") != null ? meResponse.optJSONObject("user").optString("id") : null;
        settings = meResponse.optJSONObject("settings") != null ? meResponse.optJSONObject("settings") : new JSONObject();
        refreshPrefs();
        refreshChats();

        HttpURLConnection c = open("/api/events", "GET");
        c.setReadTimeout(70000);
        c.setRequestProperty("Accept", "text/event-stream");
        int status = c.getResponseCode();
        if (status != 200) {
            c.disconnect();
            return status;
        }
        stream = c;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            String event = "message";
            StringBuilder data = new StringBuilder();
            String line;
            while (!stopped && (line = r.readLine()) != null) {
                if (line.isEmpty()) {
                    if (data.length() > 0) handle(event, data.toString());
                    event = "message";
                    data.setLength(0);
                } else if (line.startsWith("event:")) {
                    event = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    if (data.length() > 0) data.append('\n');
                    data.append(line.substring(5).trim());
                }
            }
        } finally {
            stream = null;
            c.disconnect();
        }
        return 200;
    }

    private void handle(String event, String data) {
        try {
            JSONObject p = new JSONObject(data);
            if ("message".equals(event)) onMessage(p);
            else if ("call".equals(event)) onCall(p);
            else if ("settings".equals(event)) {
                refreshPrefs();
                refreshChats();
                JSONObject m = new JSONObject(get("/api/me"));
                if (m.optJSONObject("settings") != null) settings = m.optJSONObject("settings");
            }
        } catch (Exception ignored) {
        }
    }

    // ---------------------------------------------------------------- messages

    private void onMessage(JSONObject p) throws Exception {
        JSONObject m = p.optJSONObject("message");
        if (m == null || m.optBoolean("deleted")) return;
        String id = m.optString("id");
        String chatId = m.optString("chat_id", p.optString("chat"));
        if (id.isEmpty() || seen.contains(id)) return;
        // Edits, reactions and read receipts also arrive as "message": only brand-new ones notify.
        long created = m.optLong("created");
        Long last = newest.get(chatId);
        if (last != null && created <= last) return;
        newest.put(chatId, created);
        if (!m.isNull("edited") && m.optLong("edited") > 0) return;
        seen.add(id);
        if (seen.size() > 500) seen.remove(seen.iterator().next());
        if (me == null || me.equals(m.optString("user_id"))) return;
        if (MainActivity.visible) return;

        JSONObject chat = chats.get(chatId);
        if (chat == null) {
            refreshChats();
            chat = chats.get(chatId);
        }
        if (!allowed(chat, m)) return;

        boolean showName = prefs.optBoolean("showName", true);
        boolean showText = prefs.optBoolean("showText", true) && settings.optBoolean("preview", true);
        JSONObject author = m.optJSONObject("author");
        String sender = author != null ? author.optString("name", "") : "";
        String kind = chat != null ? chat.optString("kind") : "direct";
        String title = !showName ? "Cipherion" : chat == null ? sender
                : "direct".equals(kind) ? chat.optString("title", sender) : chat.optString("title", "Cipherion");
        String body = showText ? preview(m) : "Новое сообщение";
        if (showName && chat != null && !"direct".equals(kind) && !"channel".equals(kind) && !sender.isEmpty()) body = sender + ": " + body;

        List<String> list = lines.get(chatId);
        if (list == null) lines.put(chatId, list = new ArrayList<>());
        list.add(body);
        while (list.size() > 6) list.remove(0);

        Notification.InboxStyle style = new Notification.InboxStyle();
        for (String l : list) style.addLine(l);
        if (list.size() > 1) style.setSummaryText(list.size() + " новых");

        String link = "#chat=" + chatId + "&message=" + id + (me != null ? "&account=" + me : "");
        Notification.Builder b = builder(CHANNEL_MESSAGES)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(style)
                .setNumber(list.size())
                .setAutoCancel(true)
                .setShowWhen(true)
                .setWhen(m.optLong("created", System.currentTimeMillis()))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setGroup("messages")
                .setContentIntent(openApp(this, link, chatId.hashCode()));
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH);
            int defaults = 0;
            if (prefs.optBoolean("sound", true)) defaults |= Notification.DEFAULT_SOUND;
            if (prefs.optBoolean("vibration", true)) defaults |= Notification.DEFAULT_VIBRATE;
            b.setDefaults(defaults);
        }
        notify(tagFor(chatId), b.build());
    }

    private boolean allowed(JSONObject chat, JSONObject m) {
        if (settings.optBoolean("notifications", true) == false) return false;
        String chatId = m.optString("chat_id");
        JSONArray muted = settings.optJSONArray("muted");
        if (muted != null) for (int i = 0; i < muted.length(); i++) if (chatId.equals(muted.optString(i))) return false;
        if (chat == null) return true;
        if (chat.optBoolean("muted")) return false;
        String kind = chat.optString("kind", "direct");
        if ("saved".equals(kind)) return false;
        return prefs.optBoolean(kind, true);
    }

    private static String preview(JSONObject m) {
        if (m.optInt("ghost", 0) > 0 || m.optBoolean("ghost")) return "👻 Призрачное сообщение";
        String kind = m.optString("kind", "text");
        if ("treat".equals(kind)) return "🍬 Сладость или гадость?";
        if (!m.isNull("e2e") && !m.optString("e2e").isEmpty()) return "🔒 Зашифрованное сообщение";
        if ("sticker".equals(kind)) return "Стикер";
        if ("poll".equals(kind)) return "📊 Опрос";
        JSONObject media = m.optJSONObject("media");
        if (media != null) {
            String type = media.optString("type");
            if (type.startsWith("image/")) return "🖼 Фото";
            if (type.startsWith("video/")) return "🎬 Видео";
            if (type.startsWith("audio/")) return "🎤 Голосовое сообщение";
            return "📎 " + media.optString("name", "Файл");
        }
        String body = m.optString("body", "").trim();
        if (body.isEmpty()) return "Новое сообщение";
        return body.length() > 180 ? body.substring(0, 180) + "…" : body;
    }

    static String tagFor(String chatId) {
        return "chat:" + chatId;
    }

    /** Forgets accumulated lines, called when the user opens the app. */
    static void clearMessages(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 23) {
            for (android.service.notification.StatusBarNotification s : nm.getActiveNotifications()) {
                if (s.getTag() != null && s.getTag().startsWith("chat:")) nm.cancel(s.getTag(), s.getId());
            }
        }
        clearRequested = true;
    }

    private static volatile boolean clearRequested;

    private void notify(String tag, Notification n) {
        if (clearRequested) {
            clearRequested = false;
            lines.clear();
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(tag, 2, n);
    }

    // ---------------------------------------------------------------- calls

    private void onCall(JSONObject call) {
        String id = call.optString("id");
        String state = call.optString("state");
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (!"ringing".equals(state)) {
            if (ringing.remove(id)) nm.cancel("call:" + id, 3);
            return;
        }
        if (me == null || me.equals(call.optString("caller")) || ringing.contains(id)) return;
        if (!prefs.optBoolean("calls", true) || !settings.optBoolean("notifications", true)) return;
        if (MainActivity.visible) return;
        ringing.add(id);

        String chatId = call.optString("chat");
        String link = "#chat=" + chatId + "&call=" + id + (me != null ? "&account=" + me : "");
        PendingIntent answer = openApp(this, link, id.hashCode());
        Intent rejectIntent = new Intent(this, CallActionReceiver.class).putExtra("call", id);
        PendingIntent reject = PendingIntent.getBroadcast(this, id.hashCode(), rejectIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = builder(CHANNEL_CALLS)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(call.optString("name", "Cipherion"))
                .setContentText(call.optBoolean("video") ? "Входящий видеозвонок" : "Входящий аудиозвонок")
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
                .setAutoCancel(true)
                .setContentIntent(answer)
                .setFullScreenIntent(answer, true)
                .addAction(new Notification.Action.Builder(null, "Отклонить", reject).build())
                .addAction(new Notification.Action.Builder(null, "Ответить", answer).build());
        if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(45000);
        else {
            b.setPriority(Notification.PRIORITY_MAX);
            b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE));
            b.setVibrate(new long[]{0, 800, 600, 800, 600, 800});
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT;
        nm.notify("call:" + id, 3, n);
        main.postDelayed(() -> {
            if (ringing.remove(id)) nm.cancel("call:" + id, 3);
        }, 45000);
    }

    // ---------------------------------------------------------------- helpers

    private void refreshPrefs() {
        try {
            prefs = new JSONObject(get("/api/notification-settings"));
        } catch (Exception ignored) {
        }
    }

    private void refreshChats() {
        try {
            JSONArray list = new JSONArray(get("/api/chats"));
            chats.clear();
            for (int i = 0; i < list.length(); i++) {
                JSONObject c = list.getJSONObject(i);
                String id = c.optString("id");
                chats.put(id, c);
                JSONObject last = c.optJSONObject("last");
                long created = last != null ? last.optLong("created") : 0;
                Long known = newest.get(id);
                if (known == null || created > known) newest.put(id, created);
            }
        } catch (Exception ignored) {
        }
    }

    private Notification.Builder builder(String channel) {
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channel) : new Notification.Builder(this);
    }

    static PendingIntent openApp(Context context, String link, int code) {
        Intent intent = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (link != null) intent.putExtra(EXTRA_LINK, link);
        return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static HttpURLConnection open(String path, String method) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.SITE_URL + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        String cookie = CookieManager.getInstance().getCookie(BuildConfig.SITE_URL);
        if (cookie != null) c.setRequestProperty("Cookie", cookie);
        c.setRequestProperty("User-Agent", "CipherionAndroid/" + BuildConfig.VERSION_NAME);
        // Same-origin header the server's CSRF check expects from the web app.
        c.setRequestProperty("Origin", BuildConfig.SITE_URL);
        return c;
    }

    static String get(String path) throws IOException {
        return request(path, "GET", null);
    }

    static String request(String path, String method, String json) throws IOException {
        HttpURLConnection c = open(path, method);
        try {
            if (json != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream o = c.getOutputStream()) {
                    o.write(json.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = c.getResponseCode();
            if (status >= 400) throw new HttpError(status);
            try (InputStream in = c.getInputStream()) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return out.toString("UTF-8");
            }
        } finally {
            c.disconnect();
        }
    }

    static class HttpError extends IOException {
        final int status;

        HttpError(int status) {
            super("HTTP " + status);
            this.status = status;
        }
    }
}
