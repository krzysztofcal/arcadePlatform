// #1146: licensed lobby music. The track (Pixabay Content License) may ship inside the APK but must not
// be redistributed as a standalone file, so the repository holds it only AES-256-GCM encrypted.
// The Android APK workflow decrypts it with the MOBILE_LOBBY_MUSIC_KEY secret and fails closed.
// Usage (in mobile/poker): MOBILE_LOBBY_MUSIC_KEY=<base64 32-byte key> node licensed-audio.mjs decrypt|encrypt <plain.mp3>
import { readFile, writeFile, access } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAGIC = Buffer.from('arcade-audio-aes256gcm-v1\n');
const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = data => createHash('sha256').update(data).digest('hex');

// Never echoes the value: errors name the problem only.
export function parseKey(value) {
  const key = Buffer.from(String(value || '').trim(), 'base64');
  if (key.length !== 32) throw new Error('MOBILE_LOBBY_MUSIC_KEY missing or not a base64 32-byte key');
  return key;
}

// Layout: MAGIC | 12-byte IV | 16-byte tag | ciphertext. The file name is authenticated as AAD.
export function encryptAsset(plain, key, name) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.concat([MAGIC, Buffer.from(name)]));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptAsset(blob, key, name, expectedSha256) {
  if (blob.length < MAGIC.length + 28 || !blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Encrypted audio has an unknown format');
  const at = MAGIC.length;
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(at, at + 12));
  decipher.setAAD(Buffer.concat([MAGIC, Buffer.from(name)]));
  decipher.setAuthTag(blob.subarray(at + 12, at + 28));
  let plain;
  try { plain = Buffer.concat([decipher.update(blob.subarray(at + 28)), decipher.final()]); }
  catch { throw new Error('Encrypted audio failed authentication (wrong key or altered file)'); }
  if (sha256(plain) !== expectedSha256) throw new Error('Decrypted audio checksum differs from the manifest');
  return plain;
}

// Official CI packaging must contain the exact licensed lobby track.
export function assertLobbyPackaged(audioFiles, entry) {
  if (!entry || !audioFiles.some(file => file.name === entry.file && file.sha256 === entry.sha256)) throw new Error('Licensed lobby music missing or altered: refusing to package the APK');
}

export async function lobbyEntry() {
  const manifest = JSON.parse(await readFile(path.join(here, 'audio/manifest.json'), 'utf8'));
  const entry = manifest.assets.find(asset => asset.cue === 'lobby');
  if (!entry || !entry.encryptedFile || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) throw new Error('Manifest lacks the encrypted lobby entry');
  return entry;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const key = parseKey(process.env.MOBILE_LOBBY_MUSIC_KEY);
    const entry = await lobbyEntry();
    const encrypted = path.join(here, 'audio', entry.encryptedFile);
    const plainPath = path.join(here, 'audio', entry.file);
    if (process.argv[2] === 'decrypt') {
      if (await access(plainPath).then(() => true, () => false)) throw new Error('Decrypted lobby music already exists');
      await writeFile(plainPath, decryptAsset(await readFile(encrypted), key, entry.file, entry.sha256));
      process.stdout.write('Licensed lobby music decrypted and verified (' + entry.sha256 + ')\n');
    } else if (process.argv[2] === 'encrypt' && process.argv[3]) {
      const plain = await readFile(process.argv[3]);
      if (sha256(plain) !== entry.sha256) throw new Error('Input checksum differs from the manifest');
      const blob = encryptAsset(plain, key, entry.file);
      decryptAsset(blob, key, entry.file, entry.sha256);
      await writeFile(encrypted, blob);
      process.stdout.write('Encrypted ' + entry.encryptedFile + ' (' + blob.length + ' bytes)\n');
    } else throw new Error('Usage: node licensed-audio.mjs decrypt | encrypt <plain file>');
  } catch (error) {
    process.stderr.write('licensed-audio: ' + error.message + '\n');
    process.exit(1);
  }
}
