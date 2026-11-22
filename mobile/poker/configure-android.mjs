import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// OWNER-approved in #1291, 2026-11-20.
export const APPROVED_PRODUCTION_APP_ID = 'pl.kcswh.arcadepoker';

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

export function releaseVersion(channel, env = process.env) {
  if (channel === 'stage') {
    return { name: '0.0.1', code: 1 };
  }
  if (channel === 'production') {
    const name = env?.MOBILE_VERSION_NAME;
    if (typeof name !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(name)) {
      throw new Error('Invalid MOBILE_VERSION_NAME');
    }
    const code = env?.MOBILE_VERSION_CODE;
    const codeStr = typeof code === 'string' ? code : (typeof code === 'number' ? String(code) : '');
    if (!/^[1-9][0-9]{0,9}$/.test(codeStr) || Number(codeStr) > 2100000000) {
      throw new Error('Invalid MOBILE_VERSION_CODE');
    }
    return { name, code: Number(codeStr) };
  }
  throw new Error('Unknown MOBILE_CHANNEL');
}

// #1300: public Google Web OAuth client ID (Supabase/Google token audience) for native sign-in. Production requires it;
// Stage keeps its existing browser OAuth and gets no client ID. Never a client secret.
export const GOOGLE_WEB_CLIENT_ID = /^[0-9]{6,32}-[0-9a-z]{16,64}\.apps\.googleusercontent\.com$/;
export function googleWebClientId(channel, env = process.env) {
  if (channel === 'stage') return null;
  if (channel === 'production') {
    const id = env?.MOBILE_GOOGLE_WEB_CLIENT_ID;
    if (typeof id !== 'string' || !GOOGLE_WEB_CLIENT_ID.test(id)) throw new Error('Invalid MOBILE_GOOGLE_WEB_CLIENT_ID');
    return id;
  }
  throw new Error('Unknown MOBILE_CHANNEL');
}

// Pinned Credential Manager + Sign in with Google libraries used by PokerGoogleSignInPlugin.java.
export const GOOGLE_SIGNIN_DEPENDENCIES = [
  'androidx.credentials:credentials:1.6.0',
  'androidx.credentials:credentials-play-services-auth:1.6.0',
  'com.google.android.libraries.identity.googleid:googleid:1.2.1',
];

// Credential Manager pulls androidx.biometric, whose manifest requests biometric permissions that Google ID-token
// sign-in never uses. Drop them in the merged manifest so the release permission allowlist stays unchanged.
export const REMOVED_LIBRARY_PERMISSIONS = ['android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT'];
export function removeUnusedLibraryPermissions(xml) {
  if (!/<manifest\b/.test(xml) || !xml.includes('<application')) throw new Error('Android template manifest missing');
  if (xml.includes('tools:node="remove"')) throw new Error('Library permissions already configured');
  let out = xml.includes('xmlns:tools=') ? xml : xml.replace(/<manifest\b/, '<manifest xmlns:tools="http://schemas.android.com/tools"');
  const removals = REMOVED_LIBRARY_PERMISSIONS.map(name => `<uses-permission android:name="${name}" tools:node="remove" />\n`).join('');
  return out.replace('<application', removals + '<application');
}

export function googleSignInResource(clientId) {
  if (typeof clientId !== 'string' || !GOOGLE_WEB_CLIENT_ID.test(clientId)) throw new Error('Invalid MOBILE_GOOGLE_WEB_CLIENT_ID');
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="poker_google_web_client_id" translatable="false">${clientId}</string>\n</resources>\n`;
}

// Pin to the OWNER-provisioned dedicated Spark project once its configuration is supplied.
const FIREBASE_PROJECT_ID = null;
const FIREBASE_CRASHLYTICS_DEPENDENCIES = ['com.google.firebase:firebase-crashlytics:21.1.0'];
const CRASHLYTICS_GRADLE_CLASSPATH = 'com.google.firebase:firebase-crashlytics-gradle:3.0.8';
const DIAGNOSTICS_COLLECTION = { stage: false, production: false };

export function assertFirebaseConfig(json, appId, projectId) {
  if (!projectId) throw new Error('Firebase Spark project ID is not pinned in configure-android.mjs');
  const project = json?.project_info;
  if (project?.project_id !== projectId || !/^[0-9]+$/.test(project.project_number)) {
    throw new Error('Firebase project does not match the pinned project');
  }
  const clients = Array.isArray(json.client)
    ? json.client.filter(client => client?.client_info?.android_client_info?.package_name === appId)
    : [];
  const client = clients[0];
  const sdkAppId = client?.client_info?.mobilesdk_app_id;
  if (clients.length !== 1 || typeof sdkAppId !== 'string'
      || !sdkAppId.startsWith(`1:${project.project_number}:android:`)
      || !/^1:[0-9]+:android:[a-f0-9]+$/.test(sdkAppId)
      || !Array.isArray(client.api_key) || client.api_key.length !== 1
      || !/^AIza[A-Za-z0-9_-]{35}$/.test(client.api_key[0]?.current_key)) {
    throw new Error(`Expected one valid Firebase Android client for ${appId}`);
  }
}

export function configureDiagnosticsManifest(xml, channel) {
  if (!Object.hasOwn(DIAGNOSTICS_COLLECTION, channel) || !xml.includes('</application>')
      || /firebase_crashlytics_collection_enabled|poker_diagnostics_enabled/.test(xml)) {
    throw new Error('Unexpected Android template diagnostics metadata');
  }
  return xml.replace('</application>', `<meta-data android:name="firebase_crashlytics_collection_enabled" android:value="false" />
    <meta-data android:name="poker_diagnostics_enabled" android:value="${DIAGNOSTICS_COLLECTION[channel]}" />
</application>`);
}

export function buildResources(channel, sha) {
  if (!Object.hasOwn(DIAGNOSTICS_COLLECTION, channel) || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error('Invalid Android diagnostics channel or source SHA');
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="poker_build_channel" translatable="false">${channel}</string>
    <string name="poker_source_sha" translatable="false">${sha}</string>
</resources>
`;
}

// Compare canonical paths so a symlinked invocation still configures (never a silent no-op).
function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isDirectRun()) {
  const channel = resolveChannel(process.env);
  const capacitorConfig = JSON.parse(await readFile(new URL('./capacitor.config.json', import.meta.url), 'utf8'));
  const appId = capacitorConfig?.appId;
  assertChannelIdentity(channel, appId);
  const version = releaseVersion(channel, process.env);
  const googleClientId = googleWebClientId(channel, process.env);
  const packagePath = appId.split('.').join('/');

  const firebaseFile = new URL('./google-services.json', import.meta.url);
  let firebaseConfig;
  try {
    firebaseConfig = JSON.parse(await readFile(firebaseFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Missing mobile/poker/google-services.json from the dedicated Firebase Spark project');
    if (error instanceof SyntaxError) throw new Error('Invalid mobile/poker/google-services.json');
    throw error;
  }
  for (const packageName of [APPROVED_PRODUCTION_APP_ID, 'pl.kcswh.arcadepoker.stage']) {
    assertFirebaseConfig(firebaseConfig, packageName, FIREBASE_PROJECT_ID);
  }
  const receipt = JSON.parse(await readFile(new URL('./www/build-receipt.json', import.meta.url), 'utf8'));
  const resources = buildResources(channel, receipt.sha);

  const file = new URL('./android/app/src/main/AndroidManifest.xml', import.meta.url);
  let xml = await readFile(file, 'utf8');
  xml = configureManifest(xml, channel);
  xml = removeUnusedLibraryPermissions(xml);
  xml = configureDiagnosticsManifest(xml, channel);
  await writeFile(file, xml);

  const gradleFile = new URL('./android/app/build.gradle', import.meta.url);
  let gradle = await readFile(gradleFile, 'utf8');
  if (!gradle.includes('versionName "1.0"') || !gradle.includes('versionCode 1')) throw new Error('Unexpected Android template version');
  gradle = gradle.replace('versionName "1.0"', `versionName "${version.name}"`);
  gradle = gradle.replace('versionCode 1', `versionCode ${version.code}`);
  const capacitorDependency = "    implementation project(':capacitor-android')\n";
  if (!gradle.includes(capacitorDependency)) throw new Error('Unexpected Android template dependencies');
  gradle = gradle.replace(capacitorDependency, capacitorDependency + [...GOOGLE_SIGNIN_DEPENDENCIES, ...FIREBASE_CRASHLYTICS_DEPENDENCIES].map(dep => `    implementation "${dep}"\n`).join(''));
  const servicesBlock = /\ntry \{\n    def servicesJSON = file\('google-services\.json'\)[\s\S]*?\n\} catch\(Exception e\) \{[^}]*\}\s*$/;
  if (!servicesBlock.test(gradle)) throw new Error('Unexpected Android template Google Services block');
  gradle = gradle.replace(servicesBlock, "\napply plugin: 'com.google.gms.google-services'\napply plugin: 'com.google.firebase.crashlytics'\n");
  const rootGradleFile = new URL('./android/build.gradle', import.meta.url);
  const rootGradle = await readFile(rootGradleFile, 'utf8');
  const servicesClasspath = "classpath 'com.google.gms:google-services:4.4.4'";
  if (rootGradle.split(servicesClasspath).length !== 2) throw new Error('Unexpected Android template Google Services classpath');
  await writeFile(rootGradleFile, rootGradle.replace(servicesClasspath,
    `${servicesClasspath}\n        classpath '${CRASHLYTICS_GRADLE_CLASSPATH}'`));
  await copyFile(firebaseFile, new URL('./android/app/google-services.json', import.meta.url));
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
        registerPlugin(PokerGoogleSignInPlugin.class);
        registerPlugin(PokerDiagnosticsPlugin.class);
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
  for (const name of ['PokerAudioPlugin', 'PokerGoogleSignInPlugin', 'PokerDiagnosticsPlugin']) {
    let pluginSrc = await readFile(new URL(`./${name}.java`, import.meta.url), 'utf8');
    const firstLine = pluginSrc.split(/\r?\n/, 1)[0];
    if (firstLine !== 'package pl.kcswh.arcadepoker.stage;') {
      throw new Error(`${name} package header missing`);
    }
    pluginSrc = pluginSrc.replace('package pl.kcswh.arcadepoker.stage;', `package ${appId};`);
    await writeFile(new URL(`./android/app/src/main/java/${packagePath}/${name}.java`, import.meta.url), pluginSrc);
  }
  await writeFile(new URL('./android/app/src/main/res/values/poker_diagnostics.xml', import.meta.url), resources);
  if (googleClientId) await writeFile(new URL('./android/app/src/main/res/values/poker_google_signin.xml', import.meta.url), googleSignInResource(googleClientId));

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
