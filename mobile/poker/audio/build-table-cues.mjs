// #1146 PR3: builds the poker table cue WAVs from Kenney "Casino Audio" 1.1 (CC0, https://kenney.nl/assets/casino-audio).
// Maintainer tool, not part of any build: decodes the original OGG files with the repo's Playwright Chromium,
// downmixes to mono, applies the listed gain, optional trim with a fade-out, and writes 16-bit 44.1 kHz WAVs.
// Usage: node mobile/poker/audio/build-table-cues.mjs <extracted Kenney Audio/ directory>
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// cue -> source file, gain in dB, optional trim end (s) with fade-out (s). Kept short: the native cue limit is 3 s.
export const TABLE_CUE_SOURCES = {
  card_shuffle: { source: 'card-shuffle.ogg', gainDb: -8, trimEnd: 1.4, fadeOut: 0.2 },
  card_deal_1: { source: 'card-slide-1.ogg', gainDb: -9 },
  card_deal_2: { source: 'card-slide-3.ogg', gainDb: -9 },
  card_board_1: { source: 'card-place-1.ogg', gainDb: -8 },
  card_board_2: { source: 'card-place-2.ogg', gainDb: -8 },
  card_fold: { source: 'card-shove-3.ogg', gainDb: -8 },
  chips_bet_1: { source: 'chip-lay-1.ogg', gainDb: -8 },
  chips_bet_2: { source: 'chip-lay-3.ogg', gainDb: -8 },
  chips_allin: { source: 'chips-handle-5.ogg', gainDb: -6 },
  chips_pot_1: { source: 'chips-collide-1.ogg', gainDb: -9 },
  chips_pot_2: { source: 'chips-collide-2.ogg', gainDb: -9 },
  chips_payout: { source: 'chips-stack-3.ogg', gainDb: -6 },
  chips_win: { source: 'chips-handle-6.ogg', gainDb: -6 }
};

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
  const sourceDir = process.argv[2];
  if (!sourceDir) throw new Error('Usage: node build-table-cues.mjs <Kenney Audio directory>');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const summary = [];
  for (const [cue, spec] of Object.entries(TABLE_CUE_SOURCES)){
    const original = await readFile(path.join(sourceDir, spec.source));
    const decoded = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const buffer = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(bytes.buffer);
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) buffer.getChannelData(c).forEach((v, i) => { mono[i] += v / buffer.numberOfChannels; });
      return { rate: buffer.sampleRate, samples: Array.from(mono) };
    }, original.toString('base64'));
    let samples = decoded.samples.map(v => v * Math.pow(10, spec.gainDb / 20));
    if (spec.trimEnd){
      samples = samples.slice(0, Math.round(spec.trimEnd * decoded.rate));
      const fade = Math.round(spec.fadeOut * decoded.rate);
      for (let i = 0; i < fade; i++) samples[samples.length - 1 - i] *= i / fade;
    }
    const file = wav(samples, decoded.rate);
    await writeFile(path.join(here, cue + '.wav'), file);
    const peak = Math.max(...samples.map(Math.abs));
    summary.push({ cue, source: spec.source, sourceSha256: createHash('sha256').update(original).digest('hex'), gainDb: spec.gainDb,
      trimEnd: spec.trimEnd || null, durationSeconds: +(samples.length / decoded.rate).toFixed(3), peakDbfs: +(20 * Math.log10(peak)).toFixed(1),
      bytes: file.length, sha256: createHash('sha256').update(file).digest('hex') });
  }
  await browser.close();
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
