import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SAMPLE_RATE = 44100;
const DURATION_SECONDS = 1.75;
const NUM_SAMPLES = Math.round(SAMPLE_RATE * DURATION_SECONDS);
const TARGET_PEAK_DBFS = -8.0;
const TARGET_PEAK = Math.pow(10, TARGET_PEAK_DBFS / 20); // ~0.398107

function mulberry32(seed) {
  let s = seed | 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function render() {
  const prng = mulberry32(0x1146);
  const buf = new Float64Array(NUM_SAMPLES);

  // 14 coin impacts over ~1.1 s, denser in the middle, settling at the end
  const intervals = [
    0.040, 0.080, 0.070, 0.065, 0.055, 0.050, 0.055,
    0.065, 0.075, 0.085, 0.095, 0.120, 0.150, 0.200
  ];
  let curOnset = 0.035;
  const numCoins = intervals.length;

  for (let c = 0; c < numCoins; c++) {
    curOnset += intervals[c] + (prng() - 0.5) * 0.012;
    const onsetSample = Math.round(curOnset * SAMPLE_RATE);
    if (onsetSample >= NUM_SAMPLES) break;

    // Amplitude: slightly quieter on average, random +-3 dB
    const progress = c / (numCoins - 1);
    const avgGain = 1.0 - 0.45 * progress;
    const jitterDb = (prng() * 2 - 1) * 3;
    const coinGain = avgGain * Math.pow(10, jitterDb / 20);

    // Modal disc partials (5-7 inharmonic partials of a small metal disc)
    const baseFreq = 2600 + prng() * 1600;
    const ratios = [1.0, 1.59, 2.14, 2.65, 3.16, 3.89];
    const partialAmps = [1.0, 0.70, 0.50, 0.35, 0.25, 0.15];
    const baseT60 = 0.070 + prng() * 0.120; // 70-190 ms

    const partials = ratios.map((r, k) => {
      const detune = 1.0 + (prng() - 0.5) * 0.015;
      const freq = baseFreq * r * detune;
      const t60 = Math.max(0.040, baseT60 * Math.pow(0.78, k));
      const decay = 6.907755 / t60;
      const amp = partialAmps[k] * coinGain;
      const phase = prng() * 2 * Math.PI;
      return { freq, decay, amp, phase };
    }).filter(p => p.freq < SAMPLE_RATE * 0.45);

    // Ceramic body: 3 damped low/mid resonances of the hollow pig
    const ceramicFreqs = [520 + (prng() - 0.5) * 30, 870 + (prng() - 0.5) * 40, 1340 + (prng() - 0.5) * 60];
    const ceramicT60 = 0.090 + prng() * 0.070; // 90-160 ms
    const ceramicDecay = 6.907755 / ceramicT60;
    const ceramicLevel = 0.316 * coinGain; // -10 dB under coin
    const ceramicAmps = [0.32, 0.22, 0.14].map(a => a * ceramicLevel);
    const ceramicPhases = [prng() * 2 * Math.PI, prng() * 2 * Math.PI, prng() * 2 * Math.PI];

    // Click noise at onset (2-4 ms)
    const clickSamples = Math.round((0.002 + prng() * 0.002) * SAMPLE_RATE);
    let prevNoise = 0;

    // Render impact into buffer
    const impactDuration = Math.min(NUM_SAMPLES - onsetSample, Math.round(0.400 * SAMPLE_RATE));
    for (let i = 0; i < impactDuration; i++) {
      const t = i / SAMPLE_RATE;
      let s = 0;

      // Partials
      for (let k = 0; k < partials.length; k++) {
        const p = partials[k];
        s += p.amp * Math.exp(-p.decay * t) * Math.sin(2 * Math.PI * p.freq * t + p.phase);
      }

      // Ceramic resonances
      for (let k = 0; k < 3; k++) {
        s += ceramicAmps[k] * Math.exp(-ceramicDecay * t) * Math.sin(2 * Math.PI * ceramicFreqs[k] * t + ceramicPhases[k]);
      }

      // Filtered click noise
      if (i < clickSamples) {
        const white = (prng() * 2 - 1);
        const hp = white - 0.8 * prevNoise;
        prevNoise = white;
        const clickEnv = Math.exp(-t / 0.001);
        s += 0.20 * coinGain * hp * clickEnv;
      }

      buf[onsetSample + i] += s;
    }

    // Secondary bounce/rattle for some impacts
    if ([2, 5, 8, 11].includes(c)) {
      const bounceDelay = 0.020 + prng() * 0.040;
      const bounceOnset = onsetSample + Math.round(bounceDelay * SAMPLE_RATE);
      if (bounceOnset < NUM_SAMPLES) {
        const bounceGain = 0.20 * coinGain;
        const bT60 = 0.035 + prng() * 0.025;
        const bDecay = 6.907755 / bT60;
        const bFreq = baseFreq * (1.02 + (prng() - 0.5) * 0.05);
        const bDur = Math.min(NUM_SAMPLES - bounceOnset, Math.round(0.150 * SAMPLE_RATE));
        for (let i = 0; i < bDur; i++) {
          const t = i / SAMPLE_RATE;
          buf[bounceOnset + i] += bounceGain * Math.exp(-bDecay * t) * Math.sin(2 * Math.PI * bFreq * t);
        }
      }
    }
  }

  // Gentle one-pole low-pass filter (cutoff ~11 kHz)
  const dt = 1 / SAMPLE_RATE;
  const rc = 1 / (2 * Math.PI * 11000);
  const alpha = dt / (rc + dt);
  let lp = 0;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    lp = lp + alpha * (buf[i] - lp);
    buf[i] = lp;
  }

  // Remove DC offset
  let sum = 0;
  for (let i = 0; i < NUM_SAMPLES; i++) sum += buf[i];
  const mean = sum / NUM_SAMPLES;
  for (let i = 0; i < NUM_SAMPLES; i++) buf[i] -= mean;

  // 2 ms fade-in
  const fadeInSamples = Math.round(0.002 * SAMPLE_RATE);
  for (let i = 0; i < fadeInSamples; i++) {
    buf[i] *= 0.5 * (1 - Math.cos(Math.PI * i / fadeInSamples));
  }

  // Soft tail fade-out to exact silence at the end
  const fadeOutSamples = Math.round(0.200 * SAMPLE_RATE);
  const fadeOutStart = NUM_SAMPLES - fadeOutSamples;
  for (let i = fadeOutStart; i < NUM_SAMPLES; i++) {
    const p = (i - fadeOutStart) / fadeOutSamples;
    buf[i] *= 0.5 * (1 + Math.cos(Math.PI * p));
  }
  buf[NUM_SAMPLES - 1] = 0;

  // Measure peak
  let maxAbs = 0;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const a = Math.abs(buf[i]);
    if (a > maxAbs) maxAbs = a;
  }

  // Normalize to TARGET_PEAK (-8 dBFS)
  const scale = maxAbs > 0 ? TARGET_PEAK / maxAbs : 0;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    buf[i] *= scale;
  }

  // Ensure last sample is strictly 0
  buf[NUM_SAMPLES - 1] = 0;

  // Build 16-bit PCM Mono WAV
  const dataSize = NUM_SAMPLES * 2;
  const out = Buffer.alloc(44 + dataSize);

  // RIFF header
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write('WAVE', 8);

  // "fmt " chunk
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);          // Subchunk1Size
  out.writeUInt16LE(1, 20);           // AudioFormat (1 = PCM)
  out.writeUInt16LE(1, 22);           // NumChannels (1 = Mono)
  out.writeUInt32LE(SAMPLE_RATE, 24); // SampleRate
  out.writeUInt32LE(SAMPLE_RATE * 2, 28); // ByteRate
  out.writeUInt16LE(2, 32);           // BlockAlign
  out.writeUInt16LE(16, 34);          // BitsPerSample

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
  const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bonus_coins.wav');
  await writeFile(dest, wav);
  process.stdout.write(`Wrote ${wav.length} bytes to ${dest}\n`);
}
