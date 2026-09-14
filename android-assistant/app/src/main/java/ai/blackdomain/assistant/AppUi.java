package ai.blackdomain.assistant;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.widget.Button;
import android.widget.TextView;

final class AppUi {
    static final int BG = Color.rgb(9, 11, 16);
    static final int MUTED = Color.rgb(174, 181, 195);
    static final int ACCENT = Color.rgb(255, 83, 104);
    static int dp(Context c, float n) { return Math.round(n * c.getResources().getDisplayMetrics().density); }
    static GradientDrawable surface(Context c, int color, int radius) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(dp(c, radius));
        bg.setStroke(dp(c, 1), Color.rgb(60, 44, 53));
        return bg;
    }
    static TextView text(Context c, String text, int size, int color) {
        TextView view = new TextView(c);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(dp(c, 3), 1);
        return view;
    }
    static Button button(Context c, String title, boolean primary) {
        Button view = new Button(c);
        view.setText(title);
        view.setAllCaps(false);
        view.setTextSize(15);
        view.setTextColor(Color.WHITE);
        view.setTypeface(null, Typeface.BOLD);
        view.setMinHeight(dp(c, 50));
        view.setPadding(dp(c, 10), 0, dp(c, 10), 0);
        view.setBackground(surface(c, primary ? Color.rgb(184, 26, 49) : Color.rgb(27, 30, 40), 13));
        return view;
    }
}
