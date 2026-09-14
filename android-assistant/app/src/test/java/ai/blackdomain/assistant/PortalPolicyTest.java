package ai.blackdomain.assistant;

import org.junit.Test;
import static org.junit.Assert.*;

public class PortalPolicyTest {
    @Test public void internalOriginIsExactAndHttpsOnly() {
        assertTrue(PortalPolicy.isInternal(PortalPolicy.ORIGIN + "/portal/?embed=1"));
        assertTrue(PortalPolicy.isInternal(PortalPolicy.ORIGIN + ":443/portal/"));
        for (String url : new String[]{
            "http://blackdomain-ai-v3-production.up.railway.app/portal/",
            PortalPolicy.ORIGIN + ".evil.example/portal/",
            "https://evil.example@blackdomain-ai-v3-production.up.railway.app/",
            PortalPolicy.ORIGIN + ":8443/", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,test", null
        }) assertFalse("Must reject " + url, PortalPolicy.isInternal(url));
    }
    @Test public void externalLinksCannotRunIntentsOrScripts() {
        assertTrue(PortalPolicy.canOpenExternal(PortalPolicy.GAME));
        assertFalse(PortalPolicy.canOpenExternal("intent://test/#Intent;end"));
        assertFalse(PortalPolicy.canOpenExternal("javascript:alert(1)"));
        assertFalse(PortalPolicy.canOpenExternal("https://user:password@example.com"));
        assertFalse(PortalPolicy.canOpenExternal("file:///sdcard/test.html"));
    }
    @Test public void loginUsesPersistentDeviceAndEmbeddedLayout() {
        String id = "a".repeat(48);
        assertEquals(PortalPolicy.ORIGIN + "/portal/mobile-login?embed=1&device=" + id, PortalPolicy.login(id));
    }
    @Test(expected = IllegalArgumentException.class) public void invalidDeviceIsRejected() {
        PortalPolicy.login("test&session=bad");
    }
}
