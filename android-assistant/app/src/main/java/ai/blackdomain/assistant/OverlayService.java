package ai.blackdomain.assistant;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Point;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.security.SecureRandom;

public class OverlayService extends Service {
    static final String OPEN = "ai.blackdomain.assistant.OPEN";
    static final String STOP = "ai.blackdomain.assistant.STOP";
    static volatile boolean running;
    private static final String CHANNEL = "assistant_active";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager windows;
    private ImageView bubble;
    private LinearLayout panel;
    private FrameLayout browserHost;
    private WebView web;
    private TextView message;
    private Button retry;
    private WindowManager.LayoutParams bubbleParams;
    private WindowManager.LayoutParams panelParams;
    private boolean expanded;
    private SharedPreferences prefs;
    private boolean pageFailed;
    private final Runnable loadTimeout = () -> showError("連線較慢，請確認網路後重試");

    @Override public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences("assistant", MODE_PRIVATE);
        windows = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return START_NOT_STICKY; }
        try {
            foreground();
            if (bubble == null) createBubble();
            running = true;
            if (intent != null && OPEN.equals(intent.getAction())) expand();
        } catch (RuntimeException error) {
            Toast.makeText(this, "助手啟動失敗，請重新開啟 App 並確認懸浮權限", Toast.LENGTH_LONG).show();
            stopSelf();
        }
        // Do not unexpectedly restart over another app after a system kill or reboot.
        return START_NOT_STICKY;
    }

    private void foreground() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "懸浮助手執行中", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("顯示助手狀態，並提供關閉按鈕");
        manager.createNotificationChannel(channel);
        PendingIntent main = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, OverlayService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("黑域 AI 懸浮助手已啟動")
            .setContentText("點浮球查看預測；不使用時可關閉助手")
            .setContentIntent(main).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(new Notification.Action.Builder(null, "關閉助手", stop).build()).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, notification);
    }

    private int dp(float n) { return AppUi.dp(this, n); }
    private Point screen() {
        Point size = new Point();
        windows.getDefaultDisplay().getSize(size);
        return size;
    }
    @SuppressLint("RtlHardcoded") // Drag coordinates are physical display pixels, independent of text direction.
    private WindowManager.LayoutParams params(int width, int height, int flags) {
        WindowManager.LayoutParams result = new WindowManager.LayoutParams(width, height,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, flags, android.graphics.PixelFormat.TRANSLUCENT);
        result.gravity = Gravity.TOP | Gravity.LEFT;
        result.setTitle("黑域 AI 懸浮助手");
        return result;
    }
    @SuppressLint("ClickableViewAccessibility")
    private void createBubble() {
        bubble = new ImageView(this);
        bubble.setImageResource(R.drawable.brand_logo);
        bubble.setContentDescription("開啟黑域 AI 助手，按住可拖曳");
        bubble.setPadding(dp(3), dp(3), dp(3), dp(3));
        bubble.setBackground(AppUi.surface(this, AppUi.BG, 36));
        bubble.setElevation(dp(8));
        bubble.setOnClickListener(v -> expand());
        Point size = screen();
        bubbleParams = params(dp(64), dp(64), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
        bubbleParams.x = prefs.getInt("bubbleX", size.x - dp(80));
        bubbleParams.y = prefs.getInt("bubbleY", size.y / 3);
        clampBubble();
        final int slop = ViewConfiguration.get(this).getScaledTouchSlop();
        bubble.setOnTouchListener(new View.OnTouchListener() {
            float startX, startY;
            int originX, originY;
            boolean moved;
            @Override public boolean onTouch(View v, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = event.getRawX(); startY = event.getRawY();
                        originX = bubbleParams.x; originY = bubbleParams.y; moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - startX, dy = event.getRawY() - startY;
                        if (Math.hypot(dx, dy) > slop) moved = true;
                        if (moved) {
                            bubbleParams.x = originX + Math.round(dx);
                            bubbleParams.y = originY + Math.round(dy);
                            clampBubble();
                            update(bubble, bubbleParams);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (moved) savePosition(); else v.performClick();
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        savePosition(); return true;
                    default: return false;
                }
            }
        });
        windows.addView(bubble, bubbleParams);
    }
    private void clampBubble() {
        Point size = screen();
        bubbleParams.x = Math.max(0, Math.min(bubbleParams.x, Math.max(0, size.x - dp(64))));
        bubbleParams.y = Math.max(0, Math.min(bubbleParams.y, Math.max(0, size.y - dp(88))));
    }
    private void savePosition() { prefs.edit().putInt("bubbleX", bubbleParams.x).putInt("bubbleY", bubbleParams.y).apply(); }
    private void update(View view, WindowManager.LayoutParams layout) {
        if (view != null && view.isAttachedToWindow()) {
            try { windows.updateViewLayout(view, layout); }
            catch (RuntimeException e) { stopSelf(); }
        }
    }
    private void createPanel() {
        panel = new LinearLayout(this) {
            @Override public boolean dispatchKeyEvent(KeyEvent event) {
                if (event.getKeyCode() == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP) {
                    collapse(); return true;
                }
                return super.dispatchKeyEvent(event);
            }
        };
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackground(AppUi.surface(this, AppUi.BG, 18));
        panel.setClipToOutline(true);
        panel.setElevation(dp(10));
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), dp(6), dp(8), dp(6));
        TextView name = AppUi.text(this, "黑域 AI", 17, Color.WHITE);
        toolbar.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
        Button minimize = AppUi.button(this, "縮小", false);
        minimize.setContentDescription("縮小助手回到遊戲");
        minimize.setOnClickListener(v -> collapse());
        toolbar.addView(minimize, new LinearLayout.LayoutParams(dp(68), dp(48)));
        Button close = AppUi.button(this, "關閉", false);
        close.setContentDescription("關閉懸浮助手");
        close.setOnClickListener(v -> stopSelf());
        LinearLayout.LayoutParams closeLp = new LinearLayout.LayoutParams(dp(68), dp(48));
        closeLp.leftMargin = dp(6);
        toolbar.addView(close, closeLp);
        panel.addView(toolbar);
        LinearLayout status = new LinearLayout(this);
        status.setGravity(Gravity.CENTER_VERTICAL);
        status.setPadding(dp(12), 0, dp(8), 0);
        message = AppUi.text(this, "正在連線…", 12, AppUi.MUTED);
        status.addView(message, new LinearLayout.LayoutParams(0, -2, 1));
        retry = AppUi.button(this, "重試", false);
        retry.setTextSize(12);
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(v -> {
            if (web == null) createWebView();
            web.loadUrl(PortalPolicy.login(deviceId()));
        });
        status.addView(retry, new LinearLayout.LayoutParams(dp(64), dp(48)));
        panel.addView(status, new LinearLayout.LayoutParams(-1, -2));
        browserHost = new FrameLayout(this);
        panel.addView(browserHost, new LinearLayout.LayoutParams(-1, 0, 1));
        panelParams = params(1, 1, WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
        panelParams.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        if (Build.VERSION.SDK_INT >= 30) {
            panelParams.setFitInsetsTypes(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
        }
        browserHost.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (bottom < oldBottom && web != null) web.postDelayed(() -> {
                if (web != null) web.evaluateJavascript("if(document.activeElement?.matches('input,textarea'))document.activeElement.scrollIntoView({block:'center'})", null);
            }, 200);
        });
        sizePanel();
        createWebView();
        web.loadUrl(PortalPolicy.login(deviceId()));
    }
    private void sizePanel() {
        Point size = screen();
        panelParams.width = Math.min(size.x - dp(16), dp(560));
        panelParams.height = WindowManager.LayoutParams.MATCH_PARENT;
        panelParams.x = (size.x - panelParams.width) / 2;
        panelParams.y = 0;
    }
    private void expand() {
        try {
            if (panel == null) createPanel();
            if (!panel.isAttachedToWindow()) windows.addView(panel, panelParams);
            if (bubble != null) bubble.setVisibility(View.GONE);
            expanded = true;
        } catch (RuntimeException error) {
            Toast.makeText(this, "面板無法開啟，請重新啟動助手", Toast.LENGTH_LONG).show();
            stopSelf();
        }
    }
    private void collapse() {
        if (panel != null && panel.isAttachedToWindow()) {
            getSystemService(InputMethodManager.class).hideSoftInputFromWindow(panel.getWindowToken(), 0);
            windows.removeView(panel);
        }
        if (bubble != null) bubble.setVisibility(View.VISIBLE);
        expanded = false;
        CookieManager.getInstance().flush();
    }
    private String deviceId() {
        String value = prefs.getString("deviceId", "");
        if (value.matches("[a-f0-9]{48}")) return value;
        byte[] bytes = new byte[24];
        new SecureRandom().nextBytes(bytes);
        StringBuilder hex = new StringBuilder();
        for (byte b : bytes) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        value = hex.toString();
        prefs.edit().putString("deviceId", value).apply();
        return value;
    }
    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " BlackdomainAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setBackgroundColor(AppUi.BG);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (PortalPolicy.isInternal(url)) {
                    if (request.isForMainFrame() && "/portal/mobile-login".equals(request.getUrl().getPath())
                        && !deviceId().equals(request.getUrl().getQueryParameter("device"))) {
                        view.loadUrl(PortalPolicy.login(deviceId())); return true;
                    }
                    return false;
                }
                if (request.isForMainFrame() && request.hasGesture() && PortalPolicy.canOpenExternal(url)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        collapse();
                    } catch (ActivityNotFoundException e) { showError("手機沒有可開啟此連結的瀏覽器"); }
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                pageFailed = false;
                message.setText("正在連線…"); retry.setVisibility(View.GONE);
                handler.removeCallbacks(loadTimeout);
                handler.postDelayed(loadTimeout, 25000);
            }
            @Override public void onPageFinished(WebView view, String url) {
                handler.removeCallbacks(loadTimeout);
                if (!pageFailed) {
                    message.setText("看完按「縮小」，即可返回遊戲");
                    retry.setVisibility(View.GONE);
                }
                CookieManager.getInstance().flush();
                hideWebInstall(view, url);
            }
            @Override public void onPageCommitVisible(WebView view, String url) {
                hideWebInstall(view, url);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("連線失敗，請確認網路後按重試");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError("服務暫時無法使用，請稍後重試");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler ssl, SslError error) {
                ssl.cancel();
                showError("安全連線無法建立，請確認手機日期與網路");
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                browserHost.removeView(view); view.destroy(); web = null;
                showError("助手頁面已暫停，按重試即可恢復");
                return true;
            }
        });
        browserHost.addView(web, new FrameLayout.LayoutParams(-1, -1));
    }
    private void hideWebInstall(WebView view, String url) {
        if (PortalPolicy.isInternal(url)) {
            view.evaluateJavascript("['installButton','installGuide','installApp','installDialog'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'})", null);
        }
    }
    private void showError(String text) {
        pageFailed = true;
        handler.removeCallbacks(loadTimeout);
        if (message != null) message.setText(text);
        if (retry != null) retry.setVisibility(View.VISIBLE);
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        if (bubbleParams != null) { clampBubble(); update(bubble, bubbleParams); }
        if (panelParams != null) { sizePanel(); if (expanded) update(panel, panelParams); }
    }
    @Override public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        if (panel != null && panel.isAttachedToWindow()) windows.removeView(panel);
        if (bubble != null && bubble.isAttachedToWindow()) windows.removeView(bubble);
        if (web != null) {
            browserHost.removeView(web); web.stopLoading(); web.destroy(); web = null;
        }
        CookieManager.getInstance().flush();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
