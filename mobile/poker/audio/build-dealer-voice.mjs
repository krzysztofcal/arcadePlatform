// #1146 PR4: builds the English dealer voice lines with the open-weight Kokoro-82M TTS model (Apache-2.0,
// https://huggingface.co/hexgrad/Kokoro-82M), offline, through kokoro-js. Maintainer tool, not part of any build
// and not a repository dependency: install kokoro-js@1.2.1 elsewhere and pass its directory.
// Each line is trimmed of leading/trailing silence, given 8 ms fades, normalised to the listed peak and written
// as 16-bit mono PCM WAV at the model's 24 kHz.
// Usage: node mobile/poker/audio/build-dealer-voice.mjs <directory containing node_modules/kokoro-js>
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEALER_MODEL = { id: 'onnx-community/Kokoro-82M-v1.0-ONNX', revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231', dtype: 'fp32', voice: 'af_heart', speed: 1 };
export const DEALER_LINES = {
  dealer_next_hand: 'Next hand.',
  dealer_dealing_cards: 'Dealing cards.',
  dealer_flop: 'The flop.',
  dealer_turn: 'The turn.',
  dealer_river: 'The river.',
  dealer_all_in: 'All in!'
};
const PEAK_DBFS = -3;
const SILENCE = 0.01;

function finish(samples, rate){
  let start = samples.findIndex(v => Math.abs(v) > SILENCE);
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) <= SILENCE) end--;
  const pad = Math.round(0.03 * rate);
  const out = Array.from(samples.slice(Math.max(0, start - pad), Math.min(samples.length, end + pad)));
  const fade = Math.round(0.008 * rate);
  for (let i = 0; i < fade; i++){ out[i] *= i / fade; out[out.length - 1 - i] *= i / fade; }
  const peak = Math.max(...out.map(Math.abs));
  const gain = Math.pow(10, PEAK_DBFS / 20) / peak;
  return out.map(v => v * gain);
}

function wav(samples, rate){
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + samples.length * 2, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), 44 + index * 2));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])){
  if (!process.argv[2]) throw new Error('Usage: node build-dealer-voice.mjs <directory containing node_modules/kokoro-js>');
  const require = createRequire(path.join(path.resolve(process.argv[2]), 'index.js'));
  const { KokoroTTS } = await import(pathToFileURL(require.resolve('kokoro-js')).href);
  const tts = await KokoroTTS.from_pretrained(DEALER_MODEL.id, { dtype: DEALER_MODEL.dtype, device: 'cpu', revision: DEALER_MODEL.revision });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const summary = [];
  for (const [cue, text] of Object.entries(DEALER_LINES)){
    const audio = await tts.generate(text, { voice: DEALER_MODEL.voice, speed: DEALER_MODEL.speed });
    const samples = finish(audio.audio, audio.sampling_rate);
    const file = wav(samples, audio.sampling_rate);
    await writeFile(path.join(here, cue + '.wav'), file);
    summary.push({ cue, text, durationSeconds: +(samples.length / audio.sampling_rate).toFixed(3), sampleRate: audio.sampling_rate,
      bytes: file.length, sha256: createHash('sha256').update(file).digest('hex') });
  }
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
