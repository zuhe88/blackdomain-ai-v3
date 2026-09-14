package ai.blackdomain.assistant;

import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AssistantFlowTest {
    private UiDevice device;
    private Context context;
    @Before public void prepare() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        device.executeShellCommand("appops set " + context.getPackageName() + " SYSTEM_ALERT_WINDOW allow");
        device.executeShellCommand("pm grant " + context.getPackageName() + " android.permission.POST_NOTIFICATIONS");
        device.setOrientationNatural();
        context.startActivity(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        assertNotNull(device.wait(Until.findObject(By.text("啟動懸浮助手")), 10000));
    }
    @After public void cleanup() throws Exception {
        context.stopService(new Intent(context, OverlayService.class));
        device.unfreezeRotation();
    }
    private void shot(String name) {
        File folder = new File(context.getExternalFilesDir(null), "qa");
        folder.mkdirs();
        assertTrue(device.takeScreenshot(new File(folder, name + ".png")));
    }
    @Test public void deniedOverlayPermissionExplainsNextStepWithoutStartingService() throws Exception {
        device.executeShellCommand("appops set " + context.getPackageName() + " SYSTEM_ALERT_WINDOW deny");
        device.findObject(By.text("啟動懸浮助手")).click();
        assertNotNull(device.wait(Until.findObject(By.text("允許懸浮助手")), 5000));
        shot("00-permission-help");
        device.findObject(By.text("稍後")).click();
        assertNotNull(device.wait(Until.findObject(By.text("啟動懸浮助手")), 5000));
        assertFalse(device.hasObject(By.desc("開啟黑域 AI 助手，按住可拖曳")));
    }
    @Test public void installedAssistantCanOpenTypeMinimizeDragRotateAndStop() throws Exception {
        shot("01-home");
        device.findObject(By.text("啟動懸浮助手")).click();
        assertNotNull(device.wait(Until.findObject(By.desc("縮小助手回到遊戲")), 10000));
        // Real public login page only. Never submit a member account during this test.
        UiObject2 account = device.wait(Until.findObject(By.clazz("android.widget.EditText")), 45000);
        assertNotNull("The real member login page must load inside the overlay", account);
        assertNotNull(device.wait(Until.findObject(By.text("看完按「縮小」，即可返回遊戲")), 10000));
        shot("02-login-panel");
        account.click();
        account.setText("AndroidTest");
        assertTrue(device.wait(Until.hasObject(By.text("AndroidTest")), 5000));
        android.os.SystemClock.sleep(800);
        UiObject2 keyboard = device.findObject(By.pkg("com.google.android.inputmethod.latin"));
        assertNotNull("Keyboard must be shown for login", keyboard);
        shot("03-keyboard");
        assertTrue("Login field must remain above the keyboard",
            device.findObject(By.clazz("android.widget.EditText")).getVisibleBounds().bottom <= keyboard.getVisibleBounds().top);
        device.findObject(By.desc("縮小助手回到遊戲")).click();
        UiObject2 bubble = device.wait(Until.findObject(By.desc("開啟黑域 AI 助手，按住可拖曳")), 5000);
        assertNotNull(bubble);
        device.pressHome();
        bubble = device.wait(Until.findObject(By.desc("開啟黑域 AI 助手，按住可拖曳")), 5000);
        assertNotNull("Bubble must remain above another app", bubble);
        Rect before = bubble.getVisibleBounds();
        int destinationX = before.centerX() > device.getDisplayWidth() / 2 ? 70 : device.getDisplayWidth() - 70;
        device.drag(before.centerX(), before.centerY(), destinationX, 240, 30);
        device.waitForIdle();
        Rect after = device.findObject(By.desc("開啟黑域 AI 助手，按住可拖曳")).getVisibleBounds();
        assertTrue("Dragging must move the bubble", Math.abs(before.left - after.left) > 10);
        shot("04-floating-bubble");
        device.findObject(By.desc("開啟黑域 AI 助手，按住可拖曳")).click();
        assertNotNull(device.wait(Until.findObject(By.text("AndroidTest")), 5000));
        device.executeShellCommand("am start -n " + context.getPackageName() + "/.MainActivity");
        device.setOrientationLeft();
        for (int i = 0; i < 20 && device.getDisplayWidth() < device.getDisplayHeight(); i++) android.os.SystemClock.sleep(250);
        assertTrue("Underlying activity and overlay must actually rotate", device.getDisplayWidth() > device.getDisplayHeight());
        assertNotNull(device.wait(Until.findObject(By.desc("縮小助手回到遊戲")), 5000));
        shot("05-landscape");
        device.findObject(By.desc("關閉懸浮助手")).click();
        assertTrue(device.wait(Until.gone(By.desc("開啟黑域 AI 助手，按住可拖曳")), 5000));
        assertTrue(device.wait(Until.gone(By.desc("縮小助手回到遊戲")), 5000));
    }
}
