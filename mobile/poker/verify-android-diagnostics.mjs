import { readFile } from 'node:fs/promises';
import { assertChannelIdentity } from './configure-android.mjs';

const [manifestPath, channel] = process.argv.slice(2);
const manifest = await readFile(manifestPath, 'utf8');
const appId = manifest.match(/\bpackage="([^"]+)"/)?.[1];
assertChannelIdentity(channel, appId);

const permissions = [...manifest.matchAll(/<uses-permission(?:-sdk-\d+)?\b[^>]*\bandroid:name="([^"]+)"/g)].map(match => match[1]);
process.stdout.write('Android permissions: ' + JSON.stringify(permissions) + '\n');
const allowed = new Set([
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  appId + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]);
if (!permissions.includes('android.permission.INTERNET') || permissions.some(permission => !allowed.has(permission))) {
  throw new Error('Unexpected permission set in the final Android manifest');
}

const metadata = [...manifest.matchAll(/<meta-data\b[^>]*>/g)].map(match => match[0]);
for (const name of ['firebase_crashlytics_collection_enabled', 'poker_diagnostics_enabled']) {
  const entries = metadata.filter(tag => tag.includes(`android:name="${name}"`));
  if (entries.length !== 1 || !/\bandroid:value="false"/.test(entries[0])) {
    throw new Error(`Expected exactly one explicit off value for ${name}`);
  }
}
