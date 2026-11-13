package ai.blackdomain.assistant;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class GameActivity extends Activity {
    private WebView game;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        game = new WebView(this);
        game.getSettings().setJavaScriptEnabled(true);
        game.getSettings().setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(game, true);
        game.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame() && !"https".equalsIgnoreCase(request.getUrl().getScheme());
            }
        });
        setContentView(game);
        if (state == null || game.restoreState(state) == null) game.loadUrl(PortalPolicy.GAME);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        game.saveState(state);
    }

    @Override public void onBackPressed() {
        if (game.canGoBack()) game.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        setContentView(new android.widget.FrameLayout(this));
        game.destroy();
        super.onDestroy();
    }
}
