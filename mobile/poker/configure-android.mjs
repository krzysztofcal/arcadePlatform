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
