package ai.blackdomain.assistant;

import java.net.URI;

/** Pure URL policy, shared by the WebView navigation handler and unit tests. */
final class PortalPolicy {
    static final String ORIGIN = "https://blackdomain-ai-v3-production.up.railway.app";
    static final String GAME = "https://sn058.3a1788.bet/";

    static boolean isInternal(String url) {
        try {
            URI uri = URI.create(url);
            return "https".equalsIgnoreCase(uri.getScheme())
                && "blackdomain-ai-v3-production.up.railway.app".equalsIgnoreCase(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (IllegalArgumentException | NullPointerException e) { return false; }
    }

    static boolean canOpenExternal(String url) {
        try {
            URI uri = URI.create(url);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                && uri.getUserInfo() == null;
        } catch (IllegalArgumentException | NullPointerException e) { return false; }
    }

    static String login(String device) {
        if (device == null || !device.matches("[a-f0-9]{48}")) {
            throw new IllegalArgumentException("Invalid assistant device ID");
        }
        return ORIGIN + "/portal/mobile-login?embed=1&device=" + device;
    }
}
