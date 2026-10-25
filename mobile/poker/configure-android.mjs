import { readFile, writeFile } from 'node:fs/promises';
const file = new URL('./android/app/src/main/AndroidManifest.xml', import.meta.url);
let xml = await readFile(file, 'utf8');
if (xml.includes('arcadepoker-stage')) throw new Error('Callback already configured');
xml = xml.replace('</activity>', `<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="arcadepoker-stage" android:host="auth" android:path="/callback" />
</intent-filter>\n</activity>`);
if (!xml.includes('arcadepoker-stage')) throw new Error('Android template activity missing');
await writeFile(file, xml);
const gradleFile = new URL('./android/app/build.gradle', import.meta.url);
let gradle = await readFile(gradleFile, 'utf8');
if (!gradle.includes('versionName "1.0"') || !gradle.includes('versionCode 1')) throw new Error('Unexpected Android template version');
gradle = gradle.replace('versionName "1.0"', 'versionName "0.0.1"');
await writeFile(gradleFile, gradle);
// One inset owner: full table background, safe content; native margins elsewhere.
const activityFile = new URL('./android/app/src/main/java/pl/kcswh/arcadepoker/stage/MainActivity.java', import.meta.url);
let activity = await readFile(activityFile, 'utf8');
if (!activity.includes('public class MainActivity extends BridgeActivity {}')) throw new Error('Unexpected Android activity template');
activity = activity.replace('import com.getcapacitor.BridgeActivity;', `import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
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
        super.onCreate(savedInstanceState);
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
