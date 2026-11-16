import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SAMPLE_RATE = 22050;
const DURATION_SECONDS = 14;
const NUM_SAMPLES = SAMPLE_RATE * DURATION_SECONDS;
const TARGET_PEAK = 0.45; // ~ -6.93 dBFS (strictly <= -6 dBFS)

function synthesizePadTone(freq, t, dur) {
  // Soft pad with gentle warmth: fundamental + subtle 2nd and 3rd harmonics
  const phase1 = 2 * Math.PI * freq * t;
  const phase2 = 2 * Math.PI * (freq * 2) * t;
  const phase3 = 2 * Math.PI * (freq * 3) * t;
  const raw = Math.sin(phase1) + 0.15 * Math.sin(phase2) + 0.05 * Math.sin(phase3);

  // Soft attack (0.8s) and gentle release (1.2s)
  const attack = 0.8;
  const release = 1.2;
  let env = 1.0;
  if (t < attack) {
    env = 0.5 * (1 - Math.cos((Math.PI * t) / attack));
  } else if (t > dur - release) {
    const relT = (dur - t) / release;
    env = Math.max(0, 0.5 * (1 - Math.cos(Math.PI * Math.max(0, relT))));
  }
  return raw * env * 0.25;
}

function synthesizePluckTone(freq, t, dur) {
  // Sparse gentle pluck: sine + fast decay envelope + slight bell overtone
  const phase1 = 2 * Math.PI * freq * t;
  const phase2 = 2 * Math.PI * (freq * 2.75) * t;
  const raw = Math.sin(phase1) + 0.12 * Math.sin(phase2);
  const env = Math.exp(-3.5 * t);
  return raw * env * 0.3;
}

export function render() {
  const buf = new Float64Array(NUM_SAMPLES);

  // Helper to add note wrapped modulo NUM_SAMPLES
  function addNote(synthFn, freq, startSec, durSec) {
    const startSample = Math.round(startSec * SAMPLE_RATE);
    const totalSamples = Math.round(durSec * SAMPLE_RATE);
    for (let i = 0; i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      const val = synthFn(freq, t, durSec);
      const idx = (startSample + i) % NUM_SAMPLES;
      buf[idx] += val;
    }
  }

  // 4 Chords (3.5s each, overlapping slightly for seamless cross-fade)
  // Chord 1: Fmaj7 (F3, A3, C4, E4)
  const chord1 = [174.61, 220.00, 261.63, 329.63];
  // Chord 2: Gsus4 / G (G3, C4, D4, G4)
  const chord2 = [196.00, 261.63, 293.66, 392.00];
  // Chord 3: Em7 (E3, G3, B3, D4)
  const chord3 = [164.81, 196.00, 246.94, 293.66];
  // Chord 4: Am9 (A3, C4, E4, B4)
  const chord4 = [220.00, 261.63, 329.63, 493.88];

  const chords = [
    { notes: chord1, start: 0.0, dur: 3.8 },
    { notes: chord2, start: 3.5, dur: 3.8 },
    { notes: chord3, start: 7.0, dur: 3.8 },
    { notes: chord4, start: 10.5, dur: 3.8 }
  ];

  for (const c of chords) {
    for (const freq of c.notes) {
      addNote(synthesizePadTone, freq, c.start, c.dur);
    }
  }

  // Gentle pluck arpeggio (sparse, calming melody)
  const plucks = [
    // Over Chord 1 (Fmaj7)
    { freq: 523.25, start: 0.5 },  // C5
    { freq: 659.25, start: 1.5 },  // E5
    { freq: 440.00, start: 2.5 },  // A4
    // Over Chord 2 (Gsus4)
    { freq: 587.33, start: 4.0 },  // D5
    { freq: 392.00, start: 5.0 },  // G4
    { freq: 523.25, start: 6.0 },  // C5
    // Over Chord 3 (Em7)
    { freq: 493.88, start: 7.5 },  // B4
    { freq: 587.33, start: 8.5 },  // D5
    { freq: 392.00, start: 9.5 },  // G4
    // Over Chord 4 (Am9)
    { freq: 440.00, start: 11.0 }, // A4
    { freq: 493.88, start: 12.0 }, // B4
    { freq: 659.25, start: 13.0 }  // E5
  ];

  for (const p of plucks) {
    addNote(synthesizePluckTone, p.freq, p.start, 1.8);
  }

  // Measure peak
  let maxAbs = 0;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const abs = Math.abs(buf[i]);
    if (abs > maxAbs) maxAbs = abs;
  }

  // Normalize to TARGET_PEAK
  const scale = maxAbs > 0 ? TARGET_PEAK / maxAbs : 0;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    buf[i] *= scale;
  }

  // Create 16-bit PCM WAV buffer (44 bytes header + NUM_SAMPLES * 2 bytes)
  const dataSize = NUM_SAMPLES * 2;
  const out = Buffer.alloc(44 + dataSize);

  // RIFF header
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write('WAVE', 8);

  // "fmt " chunk
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);          // Subchunk1Size (16 for PCM)
  out.writeUInt16LE(1, 20);           // AudioFormat (1 = PCM)
  out.writeUInt16LE(1, 22);           // NumChannels (1 = Mono)
  out.writeUInt32LE(SAMPLE_RATE, 24); // SampleRate
  out.writeUInt32LE(SAMPLE_RATE * 2, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  out.writeUInt16LE(2, 32);           // BlockAlign (NumChannels * BitsPerSample/8)
  out.writeUInt16LE(16, 34);          // BitsPerSample (16)

  // "data" chunk
  out.write('data', 36);
  out.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const s = Math.max(-1.0, Math.min(1.0, buf[i]));
    const val = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    const clamped = Math.max(-32768, Math.min(32767, val));
    out.writeInt16LE(clamped, offset);
    offset += 2;
  }

  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const wav = render();
  const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lobby.wav');
  await writeFile(dest, wav);
  process.stdout.write(`Wrote ${wav.length} bytes to ${dest}\n`);
}
