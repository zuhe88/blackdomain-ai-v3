package ai.blackdomain.assistant;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private TextView status;
    private Button start;
    private boolean awaitingOverlay;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) awaitingOverlay = state.getBoolean("awaitingOverlay");
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(AppUi.BG);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(24), dp(30), dp(24), dp(28));
        scroll.addView(body);
        body.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(dp(24), dp(24) + insets.getSystemWindowInsetTop(), dp(24), dp(24) + insets.getSystemWindowInsetBottom());
            return insets;
        });
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.brand_logo);
        logo.setContentDescription("黑域 AI");
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(80), dp(80));
        logoParams.gravity = Gravity.CENTER_HORIZONTAL;
        body.addView(logo, logoParams);
        TextView title = AppUi.text(this, "黑域 AI 懸浮助手", 26, Color.WHITE);
        title.setTypeface(null, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        add(body, title, 18);
        TextView lead = AppUi.text(this, "遊戲照常開，預測隨手看。\n點浮球展開助手，看完即可縮回。", 15, AppUi.MUTED);
        lead.setGravity(Gravity.CENTER);
        add(body, lead, 10);
        status = AppUi.text(this, "", 14, Color.rgb(111, 240, 189));
        status.setGravity(Gravity.CENTER);
        add(body, status, 24);
        start = AppUi.button(this, "啟動懸浮助手", true);
        start.setOnClickListener(v -> begin());
        add(body, start, 14);
        Button game = AppUi.button(this, "前往 3A 遊戲", false);
        game.setOnClickListener(v -> openGame());
        add(body, game, 12);
        Button stop = AppUi.button(this, "關閉懸浮助手", false);
        stop.setOnClickListener(v -> {
            stopService(new Intent(this, OverlayService.class));
            status.setText("助手已關閉");
            start.setText("啟動懸浮助手");
        });
        add(body, stop, 12);
        LinearLayout guide = new LinearLayout(this);
        guide.setOrientation(LinearLayout.VERTICAL);
        guide.setPadding(dp(18), dp(18), dp(18), dp(18));
        guide.setBackground(AppUi.surface(this, Color.rgb(17, 20, 28), 18));
        guide.addView(AppUi.text(this, "第一次使用", 18, Color.WHITE));
        add(guide, AppUi.text(this, "1　允許顯示在其他應用程式上層。\n2　在助手內輸入已開通的 3A 帳號。\n3　按「縮小」，再開啟遊戲。\n4　點浮球查看預測；按住可拖曳位置。", 14, AppUi.MUTED), 12);
        add(body, guide, 24);
        TextView help = AppUi.text(this, "浮球不見了？", 15, AppUi.ACCENT);
        help.setPadding(0, dp(12), 0, dp(12));
        help.setOnClickListener(v -> new AlertDialog.Builder(this)
            .setTitle("恢復懸浮助手")
            .setMessage("回到本 App，再按一次「啟動懸浮助手」。\n\n若經常被手機關閉，可在系統的 App 電池設定允許背景執行。部分遊戲或安全畫面會自行隱藏浮窗。\n\n關閉助手可使用本頁按鈕，或通知列的「關閉助手」。")
            .setPositiveButton("開啟 App 設定", (dialog, which) -> {
                try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); }
                catch (ActivityNotFoundException e) { toast("請至系統設定找到黑域 AI 懸浮助手"); }
            }).setNegativeButton("知道了", null).show());
        add(body, help, 6);
        add(body, AppUi.text(this, "版本 " + BuildConfig.VERSION_NAME + "　｜　會員資格沿用黑域 AI\n預測依後端資料更新；請核對房號與平台牌局。", 12, AppUi.MUTED), 4);
        setContentView(scroll);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().getInsetsController().setSystemBarsAppearance(0,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
    }

    private int dp(int n) { return AppUi.dp(this, n); }
    private void add(LinearLayout parent, View view, int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(top);
        parent.addView(view, lp);
    }
    private void begin() {
        if (!Settings.canDrawOverlays(this)) {
            awaitingOverlay = true;
            new AlertDialog.Builder(this).setTitle("允許懸浮助手")
                .setMessage("請在接下來的系統畫面，允許黑域 AI 顯示在其他應用程式上層。完成後返回這裡即可開啟助手。")
                .setPositiveButton("前往允許", (d, w) -> {
                    try { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); }
                    catch (ActivityNotFoundException e) { awaitingOverlay = false; toast("請至系統設定開啟懸浮視窗權限"); }
                }).setNegativeButton("稍後", (d, w) -> awaitingOverlay = false).show();
            return;
        }
        requestNotificationThenStart();
    }
    private void requestNotificationThenStart() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            && !getPreferences(0).getBoolean("notificationAsked", false)) {
            getPreferences(0).edit().putBoolean("notificationAsked", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 20);
        } else startAssistant();
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 20) startAssistant();
    }
    private void startAssistant() {
        if (!Settings.canDrawOverlays(this)) { toast("請先允許懸浮視窗權限"); return; }
        try {
            startForegroundService(new Intent(this, OverlayService.class).setAction(OverlayService.OPEN));
            status.setText("助手啟動中");
            start.setText("開啟助手面板");
        } catch (RuntimeException e) { toast("目前無法啟動，請回到 App 再試一次"); }
    }
    private void openGame() {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(PortalPolicy.GAME))); }
        catch (ActivityNotFoundException e) { toast("請先安裝可開啟遊戲的瀏覽器"); }
    }
    @Override protected void onResume() {
        super.onResume();
        status.setText(OverlayService.running ? "助手已啟動・點浮球即可展開" : Settings.canDrawOverlays(this) ? "已準備好，點下方啟動" : "首次使用需允許懸浮視窗");
        start.setText(OverlayService.running ? "開啟助手面板" : "啟動懸浮助手");
        if (awaitingOverlay && Settings.canDrawOverlays(this)) {
            awaitingOverlay = false;
            requestNotificationThenStart();
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("awaitingOverlay", awaitingOverlay);
        super.onSaveInstanceState(state);
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
}
