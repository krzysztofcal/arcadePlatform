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
// Keep one native owner of the WebView bounds, including rotation and IME insets.
const activityFile = new URL('./android/app/src/main/java/pl/kcswh/arcadepoker/stage/MainActivity.java', import.meta.url);
let activity = await readFile(activityFile, 'utf8');
if (!activity.includes('public class MainActivity extends BridgeActivity {}')) throw new Error('Unexpected Android activity template');
activity = activity.replace('import com.getcapacitor.BridgeActivity;', 'import android.os.Bundle;\nimport android.view.ViewGroup;\nimport androidx.activity.EdgeToEdge;\nimport androidx.core.graphics.Insets;\nimport androidx.core.view.ViewCompat;\nimport androidx.core.view.WindowInsetsCompat;\nimport com.getcapacitor.BridgeActivity;');
activity = activity.replace('public class MainActivity extends BridgeActivity {}', `public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        // Size the actual WebView viewport, so fixed controls and 100dvh stay safe too.
        ViewCompat.setOnApplyWindowInsetsListener(bridge.getWebView(), (view, insets) -> {
            int safeTypes = WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.systemGestures();
            Insets safe = insets.getInsets(safeTypes);
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            int bottom = Math.max(safe.bottom, ime.bottom);
            ViewGroup.MarginLayoutParams layout = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            if (layout.leftMargin != safe.left || layout.topMargin != safe.top
                || layout.rightMargin != safe.right || layout.bottomMargin != bottom) {
                layout.setMargins(safe.left, safe.top, safe.right, bottom);
                view.setLayoutParams(layout);
            }
            // The viewport is already inset; do not apply the same space again in CSS.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(safeTypes | WindowInsetsCompat.Type.ime(), Insets.NONE).build();
        });
        ViewCompat.requestApplyInsets(bridge.getWebView());
    }
}`);
await writeFile(activityFile, activity);
