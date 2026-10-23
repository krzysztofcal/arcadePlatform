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
// Keep the window edge-to-edge on older Android too; SystemBars owns the padding.
const activityFile = new URL('./android/app/src/main/java/pl/kcswh/arcadepoker/stage/MainActivity.java', import.meta.url);
let activity = await readFile(activityFile, 'utf8');
if (!activity.includes('public class MainActivity extends BridgeActivity {}')) throw new Error('Unexpected Android activity template');
activity = activity.replace('import com.getcapacitor.BridgeActivity;', 'import android.os.Bundle;\nimport androidx.activity.EdgeToEdge;\nimport com.getcapacitor.BridgeActivity;');
activity = activity.replace('public class MainActivity extends BridgeActivity {}', `public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
    }
}`);
await writeFile(activityFile, activity);
