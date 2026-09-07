import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, Image, Linking, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const GAME_HOME = 'https://sn058.3a1788.bet/';
const AI_HOME = 'https://blackdomain-ai-v3-production.up.railway.app/portal/mobile-login';
const AI_ORIGIN = new URL(AI_HOME).origin;
const READ_MEMBER_STATE = `
  (function () {
    fetch('/api/web/me', { cache: 'no-store', credentials: 'include' })
      .then(function (response) { return response.json(); })
      .then(function (value) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'BLACKDOMAIN_MEMBER_STATE',
          authenticated: Boolean(value && value.authenticated),
          accessAllowed: Boolean(value && value.accessAllowed)
        }));
      }).catch(function () {});
  })(); true;
`;

function isEmbeddedPage(url: string) {
  return /^(about:|blob:|data:)/i.test(url);
}

function openExternal(url: string) {
  if (!/^(https:|line:|tel:|mailto:)/i.test(url)) return;
  Alert.alert('開啟其他應用程式', '這會離開助手畫面，遊戲可能暫停。', [
    { text: '取消', style: 'cancel' },
    { text: '開啟', onPress: () => { void Linking.openURL(url).catch(() => Alert.alert('無法開啟', '手機目前沒有可開啟此連結的應用程式。')); } },
  ]);
}

function Assistant() {
  const game = useRef<WebView>(null);
  const ai = useRef<WebView>(null);
  const [gameSource, setGameSource] = useState({ uri: GAME_HOME });
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelLoaded, setPanelLoaded] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [aiSource, setAiSource] = useState({ uri: AI_HOME });
  const [aiAuthenticated, setAiAuthenticated] = useState(false);
  const [aiAccessAllowed, setAiAccessAllowed] = useState(false);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const fabPosition = useRef(new Animated.ValueXY({ x: Math.max(12, width - 78), y: Math.max(24, height * 0.42) })).current;
  const fabPoint = useRef({ x: Math.max(12, width - 78), y: Math.max(24, height * 0.42) });
  const fabMoved = useRef(false);
  const fabPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 6,
    onPanResponderGrant: () => {
      fabMoved.current = true;
      fabPosition.setOffset(fabPoint.current);
      fabPosition.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: Animated.event([null, { dx: fabPosition.x, dy: fabPosition.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => {
      fabPosition.flattenOffset();
      const next = {
        x: Math.max(8, Math.min(width - 70, fabPoint.current.x)),
        y: Math.max(8, Math.min(height - 132, fabPoint.current.y)),
      };
      Animated.spring(fabPosition, { toValue: next, useNativeDriver: false, bounciness: 4 }).start();
      setTimeout(() => { fabMoved.current = false; }, 80);
    },
    onPanResponderTerminate: () => {
      fabPosition.flattenOffset();
      fabMoved.current = false;
    },
  })).current;

  useEffect(() => {
    const listener = fabPosition.addListener(value => { fabPoint.current = value; });
    return () => fabPosition.removeListener(listener);
  }, [fabPosition]);

  useEffect(() => {
    const next = {
      x: Math.max(8, Math.min(width - 70, fabPoint.current.x)),
      y: Math.max(8, Math.min(height - 132, fabPoint.current.y)),
    };
    fabPosition.setValue(next);
  }, [fabPosition, height, width]);

  const togglePanel = () => { setPanelLoaded(true); setPanelOpen(value => !value); };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panelOpen) { setPanelOpen(false); return true; }
      if (canGoBack) { game.current?.goBack(); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [panelOpen, canGoBack]);

  const reloadGame = () => Alert.alert('重新載入遊戲', '目前遊戲連線會重新建立。', [
    { text: '取消', style: 'cancel' },
    { text: '重新載入', onPress: () => { setError(false); game.current?.reload(); } },
  ]);
  const navigateGame = (url: string) => {
    if (/^https:\/\//i.test(url)) setGameSource({ uri: url });
    else openExternal(url);
  };

  return <SafeAreaView style={styles.root}>
    <View style={styles.toolbar}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回上一頁" disabled={!canGoBack} onPress={() => game.current?.goBack()} style={styles.navButton}>
        <Text style={[styles.navText, !canGoBack && styles.disabled]}>‹</Text>
      </Pressable>
      <View style={styles.brand}><Text style={styles.title}>黑域 AI 助手</Text><Text style={styles.subtitle}>{loading ? '頁面載入中' : '遊戲瀏覽器'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="重新載入遊戲" onPress={reloadGame} style={styles.navButton}><Text style={styles.navText}>↻</Text></Pressable>
    </View>
    <View style={styles.stage}>
      <WebView ref={game} source={gameSource} style={styles.webview}
        originWhitelist={['https://*', 'about:*', 'blob:*', 'data:*']} sharedCookiesEnabled thirdPartyCookiesEnabled
        javaScriptCanOpenWindowsAutomatically setSupportMultipleWindows allowsInlineMediaPlayback
        onOpenWindow={event => navigateGame(event.nativeEvent.targetUrl)}
        onShouldStartLoadWithRequest={request => {
          if (isEmbeddedPage(request.url) || /^https:\/\//i.test(request.url)) return true;
          openExternal(request.url); return false;
        }}
        onNavigationStateChange={state => setCanGoBack(state.canGoBack)}
        onLoadStart={() => { setLoading(true); setError(false); }} onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
        onContentProcessDidTerminate={() => setError(true)}
        onRenderProcessGone={() => setError(true)}
      />
      {error && <View style={styles.error}><Text style={styles.title}>遊戲頁面已中斷</Text><Text style={styles.message}>請確認網路，再手動重新載入。</Text><Pressable onPress={reloadGame} style={styles.action}><Text style={styles.actionText}>重新載入</Text></Pressable></View>}
      {!panelOpen && <Animated.View {...fabPan.panHandlers} style={[styles.fab, { transform: fabPosition.getTranslateTransform() }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="開啟黑域 AI 分析；可拖曳移動" onPress={() => { if (!fabMoved.current) togglePanel(); }} style={styles.fabPress}>
          <Image source={require('./assets/blackdomain-ai-logo.png')} style={styles.fabLogo}/><Text style={styles.fabCaption}>AI 分析</Text>
        </Pressable>
      </Animated.View>}
      {panelLoaded && <View pointerEvents={panelOpen ? 'auto' : 'none'} accessibilityElementsHidden={!panelOpen} importantForAccessibility={panelOpen ? 'auto' : 'no-hide-descendants'} style={[
        styles.panel,
        landscape ? { width: Math.min(420, width * 0.48), height: '100%' } : { width: '100%', height: '68%' },
        !panelOpen && styles.hidden,
      ]}>
        <View style={styles.panelHeader}><View style={styles.brand}><Text style={styles.title}>黑域 AI 分析</Text><Text style={styles.subtitle}>收起面板即可繼續遊戲</Text></View><Pressable accessibilityRole="button" accessibilityLabel="收起分析" onPress={() => setPanelOpen(false)} style={styles.close}><Text style={styles.closeText}>收起 ⌄</Text></Pressable></View>
        {aiAuthenticated && <View style={[styles.memberState, aiAccessAllowed ? styles.memberActive : styles.memberLimited]}><Text style={styles.memberStateText}>{aiAccessAllowed ? '會員權限已啟用' : '已登入・尚未開通分析權限'}</Text></View>}
        <WebView ref={ai} source={aiSource} style={styles.webview} sharedCookiesEnabled thirdPartyCookiesEnabled
          originWhitelist={['https://*', 'about:*', 'blob:*', 'data:*']} setSupportMultipleWindows
          onOpenWindow={event => openExternal(event.nativeEvent.targetUrl)}
          onShouldStartLoadWithRequest={request => {
            if (isEmbeddedPage(request.url)) return true;
            try { if (new URL(request.url).origin === AI_ORIGIN) return true; } catch { return false; }
            openExternal(request.url); return false;
          }}
          injectedJavaScript={READ_MEMBER_STATE}
          onMessage={event => {
            try {
              const value = JSON.parse(event.nativeEvent.data);
              if (value.type !== 'BLACKDOMAIN_MEMBER_STATE') return;
              setAiAuthenticated(Boolean(value.authenticated));
              setAiAccessAllowed(Boolean(value.accessAllowed));
            } catch { /* Ignore messages not created by the member-state check. */ }
          }}
          onLoadStart={() => setAiError(false)} onError={() => setAiError(true)}
          onContentProcessDidTerminate={() => setAiError(true)} onRenderProcessGone={() => setAiError(true)}
        />
        {aiError && <View style={styles.aiError}><Text style={styles.message}>分析頁面暫時無法載入</Text><Pressable onPress={() => ai.current?.reload()} style={styles.action}><Text style={styles.actionText}>重試分析</Text></Pressable></View>}
      </View>}
    </View>
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><Assistant /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080c13' },
  toolbar: { height: 54, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#263143', paddingHorizontal: 8 },
  brand: { flex: 1 }, title: { color: '#f3f6fc', fontSize: 16, fontWeight: '700' }, subtitle: { color: '#9dacc3', fontSize: 11, marginTop: 3 },
  navButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, navText: { color: '#e3bc73', fontSize: 30 }, disabled: { opacity: 0.25 },
  stage: { flex: 1, overflow: 'hidden' }, webview: { flex: 1, backgroundColor: '#080c13' },
  fab: { position: 'absolute', left: 0, top: 0, width: 62, height: 70, borderRadius: 22, backgroundColor: '#101926', borderWidth: 1, borderColor: '#e3bc73', elevation: 8, overflow: 'hidden' },
  fabPress: { flex: 1, alignItems: 'center', justifyContent: 'center' }, fabLogo: { width: 42, height: 42, borderRadius: 21, resizeMode: 'contain' }, fabCaption: { color: '#ecdfc6', fontSize: 9, marginTop: 2 },
  panel: { position: 'absolute', right: 0, bottom: 0, backgroundColor: '#0e1521', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: '#425069', overflow: 'hidden', elevation: 12 },
  hidden: { opacity: 0, transform: [{ translateX: 10000 }] },
  panelHeader: { flexDirection: 'row', padding: 14, alignItems: 'center', minHeight: 68 },
  close: { padding: 12, borderRadius: 12, backgroundColor: '#263143' }, closeText: { color: '#eee4cf', fontWeight: '600' },
  memberState: { paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1 }, memberActive: { backgroundColor: '#0e2b22', borderBottomColor: '#245b49' }, memberLimited: { backgroundColor: '#322317', borderBottomColor: '#6d4b27' }, memberStateText: { color: '#e9f4ee', fontSize: 12, fontWeight: '700' },
  error: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111824', gap: 16 },
  message: { color: '#c2ccdc', fontSize: 14 }, action: { backgroundColor: '#e3bc73', padding: 14, borderRadius: 12 }, actionText: { color: '#15100a', fontWeight: '700' },
  aiError: { position: 'absolute', top: 90, left: 20, right: 20, padding: 20, gap: 12, backgroundColor: '#172131', borderRadius: 12 },
});
