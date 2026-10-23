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
