import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Set only after OWNER approval of the Play Console application ID (D1, T3).
export const APPROVED_PRODUCTION_APP_ID = null;

export function callbackIntentFilter(channel) {
  if (channel === 'stage') {
    return `<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="arcadepoker-stage" android:host="auth" android:path="/callback" />
</intent-filter>`;
  }
  if (channel === 'production') {
    return `<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="play.kcswh.pl" android:path="/app/auth/callback" />
</intent-filter>`;
  }
  throw new Error('Unknown MOBILE_CHANNEL');
}

export function configureManifest(xml, channel) {
  if (xml.includes('arcadepoker-stage') || xml.includes('android:host="play.kcswh.pl"')) {
    throw new Error('Callback already configured');
  }
  const filter = callbackIntentFilter(channel);
  if (!xml.includes('</activity>')) {
    throw new Error('Android template activity missing');
  }
  return xml.replace('</activity>', `${filter}\n</activity>`);
}

export function resolveChannel(env = process.env) {
  const channel = env?.MOBILE_CHANNEL;
  if (channel === undefined) {
    return 'stage';
  }
  if (typeof channel === 'string' && channel.trim() === '') {
    throw new Error('Empty MOBILE_CHANNEL');
  }
  if (channel === 'stage' || channel === 'production') {
    return channel;
  }
  throw new Error('Unknown MOBILE_CHANNEL');
}

export function assertChannelIdentity(channel, appId) {
  if (!appId || typeof appId !== 'string' || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId)) {
    throw new Error('Invalid appId in capacitor.config.json');
  }
  if (channel === 'stage') {
    if (appId !== 'pl.kcswh.arcadepoker.stage') {
      throw new Error('Stage appId mismatch');
    }
    return;
  }
  if (channel === 'production') {
    if (APPROVED_PRODUCTION_APP_ID === null) {
      throw new Error('Production applicationId not approved');
    }
    if (appId !== APPROVED_PRODUCTION_APP_ID || appId === 'pl.kcswh.arcadepoker.stage') {
      throw new Error('Production appId mismatch');
    }
    return;
  }
  throw new Error('Unknown MOBILE_CHANNEL');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const channel = resolveChannel(process.env);
  const capacitorConfig = JSON.parse(await readFile(new URL('./capacitor.config.json', import.meta.url), 'utf8'));
  const appId = capacitorConfig?.appId;
  assertChannelIdentity(channel, appId);
  const packagePath = appId.split('.').join('/');

  const file = new URL('./android/app/src/main/AndroidManifest.xml', import.meta.url);
  let xml = await readFile(file, 'utf8');
  xml = configureManifest(xml, channel);
  await writeFile(file, xml);

  const gradleFile = new URL('./android/app/build.gradle', import.meta.url);
  let gradle = await readFile(gradleFile, 'utf8');
  if (!gradle.includes('versionName "1.0"') || !gradle.includes('versionCode 1')) throw new Error('Unexpected Android template version');
  gradle = gradle.replace('versionName "1.0"', 'versionName "0.0.1"');
  await writeFile(gradleFile, gradle);

  // One inset owner: full table background, safe content; native margins elsewhere.
  const activityFile = new URL(`./android/app/src/main/java/${packagePath}/MainActivity.java`, import.meta.url);
  let activity = await readFile(activityFile, 'utf8');
  if (!activity.includes('public class MainActivity extends BridgeActivity {}')) throw new Error('Unexpected Android activity template');
  activity = activity.replace('import com.getcapacitor.BridgeActivity;', `import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;`);
  activity = activity.replace('public class MainActivity extends BridgeActivity {}', `public class MainActivity extends BridgeActivity {
    private boolean tableMode;
    private boolean keyboardVisible;
    private String safeAreaScript = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(PokerAudioPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(android.graphics.Color.rgb(10, 15, 20));
        EdgeToEdge.enable(this);
        WindowManager.LayoutParams window = getWindow().getAttributes();
        if (Build.VERSION.SDK_INT >= 30) {
            window.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        } else if (Build.VERSION.SDK_INT >= 28) {
            window.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        getWindow().setAttributes(window);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                Uri page = Uri.parse(url);
                tableMode = "https".equals(page.getScheme()) && "localhost".equals(page.getHost())
                    && ("/poker/table-v2.html".equals(page.getPath()) || "/poker/offline/play.html".equals(page.getPath()));
                safeAreaScript = ""; // The next document needs its own CSS values.
                ViewCompat.requestApplyInsets(view);
            }
        });
        ViewCompat.setOnApplyWindowInsetsListener(bridge.getWebView(), (view, insets) -> {
            int safeTypes = WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.systemGestures();
            Insets safe = insets.getInsets(safeTypes);
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean nextKeyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            if (tableMode && keyboardVisible && !nextKeyboardVisible) bars.hide(WindowInsetsCompat.Type.systemBars());
            keyboardVisible = nextKeyboardVisible;
            // Only the IME may reduce the table viewport. Cutouts/gestures inset its content instead.
            Insets margin = tableMode ? Insets.of(0, 0, 0, ime.bottom)
                : Insets.of(safe.left, safe.top, safe.right, Math.max(safe.bottom, ime.bottom));
            ViewGroup.MarginLayoutParams layout = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            if (layout.leftMargin != margin.left || layout.topMargin != margin.top
                || layout.rightMargin != margin.right || layout.bottomMargin != margin.bottom) {
                layout.setMargins(margin.left, margin.top, margin.right, margin.bottom);
                view.setLayoutParams(layout);
            }
            Insets touch = tableMode ? Insets.of(safe.left, safe.top, safe.right, keyboardVisible ? 0 : safe.bottom) : Insets.NONE;
            float density = view.getResources().getDisplayMetrics().density;
            String script = "(function(){var s=document.documentElement.style;"
                + "s.setProperty('--mobile-safe-top','" + (touch.top / density) + "px');"
                + "s.setProperty('--mobile-safe-right','" + (touch.right / density) + "px');"
                + "s.setProperty('--mobile-safe-bottom','" + (touch.bottom / density) + "px');"
                + "s.setProperty('--mobile-safe-left','" + (touch.left / density) + "px');"
                + "window.dispatchEvent(new Event('resize'));})()";
            if (!script.equals(safeAreaScript)) {
                safeAreaScript = script;
                bridge.getWebView().evaluateJavascript(script, null);
            }
            // CSS uses the values above; do not also apply WebView safe-area env values.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(safeTypes | WindowInsetsCompat.Type.ime(), Insets.NONE).build();
        });
        ViewCompat.requestApplyInsets(bridge.getWebView());
    }
}`);
  await writeFile(activityFile, activity);
  await copyFile(new URL('./PokerAudioPlugin.java', import.meta.url), new URL(`./android/app/src/main/java/${packagePath}/PokerAudioPlugin.java`, import.meta.url));

  // Keep the launch window and WebView on the same dark brand surface.
  const stylesFile = new URL('./android/app/src/main/res/values/styles.xml', import.meta.url);
  let styles = await readFile(stylesFile, 'utf8');
  if (!styles.includes('<item name="android:background">@drawable/splash</item>')) throw new Error('Unexpected launch theme template');
  styles = styles.replace('<item name="android:background">@null</item>', '<item name="android:windowBackground">#0a0f14</item>');
  styles = styles.replace('<item name="android:background">@drawable/splash</item>', `<item name="windowSplashScreenBackground">#0a0f14</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/poker_launch_mark</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>`);
  await writeFile(stylesFile, styles);
  await copyFile(new URL('./launch-mark.xml', import.meta.url), new URL('./android/app/src/main/res/drawable/poker_launch_mark.xml', import.meta.url));
}
