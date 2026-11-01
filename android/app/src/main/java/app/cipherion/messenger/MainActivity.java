package app.cipherion.messenger;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/** Cipherion for Android: the web messenger in a full-screen WebView with camera, mic, files and downloads. */
public class MainActivity extends Activity {
    private static final int REQUEST_FILE = 1;
    private static final int REQUEST_MEDIA_PERMISSIONS = 2;
    private static final int REQUEST_NOTIFICATIONS = 3;

    /** True while the app is on screen: the page itself shows what is new, so no system notifications. */
    static volatile boolean visible;

    private final String siteUrl = BuildConfig.SITE_URL;
    private final String siteHost = Uri.parse(BuildConfig.SITE_URL).getHost();

    private WebView web;
    private FrameLayout root;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#070c13"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#070c13"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Speed: keep the app's own files in the HTTP cache, a fixed text size so layouts never reflow,
        // pre-rendered off-screen tiles for smooth scrolling, and top renderer priority like a native app.
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= 23) s.setOffscreenPreRaster(true);
        if (Build.VERSION.SDK_INT >= 26) {
            s.setSafeBrowsingEnabled(false); // only our own site is ever loaded here
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
        }
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        s.setUserAgentString(s.getUserAgentString() + " CipherionAndroid/" + BuildConfig.VERSION_NAME);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "CipherionAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> download(url, userAgent, contentDisposition, mimeType));

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(startUrl(getIntent()));
        }
        showOverLockScreen(getIntent());
        CipherionService.createChannels(this);
        askForNotifications();
    }

    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && "https".equals(data.getScheme()) && siteHost.equals(data.getHost())) return data.toString();
        String link = notificationLink(intent);
        if (link != null) return siteUrl + "/" + link;
        return siteUrl;
    }

    /** "#chat=…&message=…" from a tapped notification, or null. */
    private static String notificationLink(Intent intent) {
        String link = intent != null ? intent.getStringExtra(CipherionService.EXTRA_LINK) : null;
        return link != null && link.startsWith("#") ? link : null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        showOverLockScreen(intent);
        String link = notificationLink(intent);
        if (link != null) {
            // The page is already running: changing the hash opens the chat without a reload, so a live call survives.
            String hash = link.substring(1).replace("\\", "").replace("'", "");
            web.evaluateJavascript("location.hash='';location.hash='" + hash + "'", null);
        } else if (intent.getData() != null) {
            web.loadUrl(startUrl(intent));
        }
    }

    /** An incoming call opened from the lock screen shows on top of it, like a phone call. */
    @SuppressWarnings("deprecation")
    private void showOverLockScreen(Intent intent) {
        String link = notificationLink(intent);
        boolean call = link != null && link.contains("&call=");
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(call);
            setTurnScreenOn(call);
        } else if (call) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    /** Android 13+ asks for notifications once; then the background connection starts. */
    private void askForNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
        } else {
            afterNotificationsAllowed();
        }
    }

    private void afterNotificationsAllowed() {
        CipherionService.start(this);
        // Like Telegram, ask once to be exempt from battery saving so messages are not delayed.
        android.content.SharedPreferences sp = getSharedPreferences("app", MODE_PRIVATE);
        if (Build.VERSION.SDK_INT >= 23 && !sp.getBoolean("askedBattery", false)) {
            sp.edit().putBoolean("askedBattery", true).apply();
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
            if (!pm.isIgnoringBatteryOptimizations(getPackageName())) {
                try {
                    startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                } catch (Exception ignored) {
                }
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        web.onResume();
        CipherionService.clearMessages(this);
        CipherionService.start(this);
        Updater.check(this, false);
    }

    @Override
    protected void onPause() {
        visible = false;
        // Keep JS timers running so calls and live delivery survive a short trip to another app.
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            exitFullscreen();
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            // Ask the page first (closes an open chat or sheet); leave the app only if it did nothing.
            web.evaluateJavascript("(function(){var b=document.querySelector('#chat-back');if(b&&document.querySelector('.shell.show-chat')){b.click();return true;}return false;})()",
                    handled -> { if (!"true".equals(handled)) moveTaskToBack(true); });
        }
    }

    private boolean isOwnSite(Uri uri) {
        return uri != null && siteHost.equals(uri.getHost());
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Нет приложения, чтобы открыть ссылку", Toast.LENGTH_SHORT).show();
        }
    }

    private void download(String url, String userAgent, String contentDisposition, String mimeType) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            Toast.makeText(this, "Этот файл можно сохранить через меню «Поделиться»", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setMimeType(mimeType);
            request.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
            request.addRequestHeader("User-Agent", userAgent);
            request.setTitle(name);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this, "Скачивание: " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            openExternally(Uri.parse(url));
        }
    }

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        web.setVisibility(View.VISIBLE);
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    result = new Uri[n];
                    for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQUEST_NOTIFICATIONS) {
            afterNotificationsAllowed();
            return;
        }
        if (requestCode == REQUEST_MEDIA_PERMISSIONS && pendingPermission != null) {
            grantAllowed(pendingPermission);
            pendingPermission = null;
        }
    }

    /** Grants the page only the media resources whose Android permission the user allowed. */
    private void grantAllowed(PermissionRequest request) {
        List<String> granted = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && has(Manifest.permission.CAMERA)) granted.add(r);
            else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && has(Manifest.permission.RECORD_AUDIO)) granted.add(r);
            else if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(r)) granted.add(r);
        }
        if (granted.isEmpty()) request.deny();
        else request.grant(granted.toArray(new String[0]));
    }

    private boolean has(String permission) {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isOwnSite(uri)) return false;
            openExternally(uri);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String html = "<html><head><meta name=viewport content='width=device-width,initial-scale=1'></head>"
                    + "<body style='background:#070c13;color:#e8eef5;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px;box-sizing:border-box'>"
                    + "<h2 style='margin:0 0 8px'>Нет соединения</h2><p style='opacity:.7;margin:0 0 24px'>Проверьте интернет и попробуйте ещё раз.</p>"
                    + "<button onclick=\"location.href='" + siteUrl + "'\" style='background:#2fd5a6;color:#04120d;border:0;border-radius:14px;padding:14px 28px;font-size:16px;font-weight:600'>Повторить</button></body></html>";
            view.loadDataWithBaseURL(null, html, "text/html", "utf-8", siteUrl);
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!isOwnSite(request.getOrigin())) { request.deny(); return; }
                List<String> needed = new ArrayList<>();
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !has(Manifest.permission.CAMERA)) needed.add(Manifest.permission.CAMERA);
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !has(Manifest.permission.RECORD_AUDIO)) needed.add(Manifest.permission.RECORD_AUDIO);
                }
                if (needed.isEmpty()) {
                    grantAllowed(request);
                } else {
                    if (pendingPermission != null) pendingPermission.deny();
                    pendingPermission = request;
                    requestPermissions(needed.toArray(new String[0]), REQUEST_MEDIA_PERMISSIONS);
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(Intent.createChooser(intent, "Выберите файл"), REQUEST_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) { callback.onCustomViewHidden(); return; }
            fullscreenView = view;
            fullscreenCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }
    }

    /** Called from the page as window.CipherionAndroid. */
    private class Bridge {
        /** Blocks screenshots and screen recording while a protected chat is open. */
        @JavascriptInterface
        public void setSecure(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            });
        }

        /** Lets a "Проверить обновления" button in the page trigger a check right away. */
        @JavascriptInterface
        public void checkForUpdates() {
            runOnUiThread(() -> Updater.check(MainActivity.this, true));
        }

        @JavascriptInterface
        public int versionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public boolean isApp() {
            return true;
        }
    }
}
