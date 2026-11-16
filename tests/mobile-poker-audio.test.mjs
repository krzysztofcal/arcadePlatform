import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

test('adapter in node:vm with no Capacitor or getPlatform() === "web" is inactive and registers no listeners', async () => {
  const source = await readFile(new URL('../mobile/poker/audio.js', import.meta.url), 'utf8');

  // Case A: No Capacitor
  {
    const windowListeners = {};
    const documentListeners = {};
    const window = {
      addEventListener(name, fn) { windowListeners[name] = fn; },
      removeEventListener(name) { delete windowListeners[name]; }
    };
    const document = {
      addEventListener(name, fn) { documentListeners[name] = fn; }
    };
    vm.runInNewContext(source, { window, document });
    const audio = window.MobilePokerAudio;
    assert.ok(audio, 'MobilePokerAudio must be defined');
    assert.equal(audio.available(), false);
    assert.equal(await audio.isEnabled(), false);
    assert.equal(await audio.setEnabled(true), false);
    assert.equal(await audio.play('bet'), false);
    assert.equal(await audio.voice('check'), false);
    assert.equal(await audio.preload(['bet']), false);
    assert.equal(await audio.stop(), undefined);
    assert.deepEqual(Object.keys(windowListeners), []);
    assert.deepEqual(Object.keys(documentListeners), []);
  }

  // Case B: Capacitor with getPlatform() === 'web'
  {
    const pluginCalls = [];
    const windowListeners = {};
    const documentListeners = {};
    const window = {
      Capacitor: {
        getPlatform() { return 'web'; },
        Plugins: {
          PokerAudio: {
            getState: async () => { pluginCalls.push('getState'); return { enabled: true }; }
          }
        }
      },
      addEventListener(name, fn) { windowListeners[name] = fn; },
      removeEventListener(name) { delete windowListeners[name]; }
    };
    const document = {
      addEventListener(name, fn) { documentListeners[name] = fn; }
    };
    vm.runInNewContext(source, { window, document });
    const audio = window.MobilePokerAudio;
    assert.equal(audio.available(), false);
    assert.equal(await audio.isEnabled(), false);
    assert.equal(await audio.setEnabled(true), false);
    assert.equal(await audio.play('bet'), false);
    assert.equal(await audio.voice('check'), false);
    assert.equal(await audio.preload(['bet']), false);
    assert.equal(await audio.stop(), undefined);
    assert.deepEqual(Object.keys(windowListeners), []);
    assert.deepEqual(Object.keys(documentListeners), []);
    assert.deepEqual(pluginCalls, []);
  }
});

test('adapter with fake android PokerAudio plugin forwards gestures and calls safely', async () => {
  const source = await readFile(new URL('../mobile/poker/audio.js', import.meta.url), 'utf8');
  let unlockCalls = 0;
  const calls = [];
  const windowListeners = {};

  const fakePlugin = {
    unlock: async () => { unlockCalls++; },
    getState: async () => { calls.push('getState'); return { enabled: true }; },
    setEnabled: async (opts) => { calls.push({ setEnabled: opts }); return { enabled: opts.enabled }; },
    play: async (opts) => { calls.push({ play: opts }); return { played: true }; },
    preload: async (opts) => { calls.push({ preload: opts }); },
    stop: async () => { calls.push('stop'); }
  };

  const window = {
    Capacitor: {
      getPlatform() { return 'android'; },
      Plugins: { PokerAudio: fakePlugin }
    },
    addEventListener(name, fn) { windowListeners[name] = fn; },
    removeEventListener(name) { delete windowListeners[name]; }
  };

  vm.runInNewContext(source, { window, document: {} });
  const audio = window.MobilePokerAudio;
  assert.equal(audio.available(), true);

  // Gesture unlock listeners registered
  assert.ok(windowListeners.pointerdown, 'pointerdown listener registered');
  assert.ok(windowListeners.keydown, 'keydown listener registered');

  // First gesture calls unlock exactly once
  windowListeners.pointerdown();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(unlockCalls, 1, 'first gesture calls unlock');

  // Second gesture does not call unlock again
  if (windowListeners.pointerdown) windowListeners.pointerdown();
  if (windowListeners.keydown) windowListeners.keydown();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(unlockCalls, 1, 'second gesture does not call unlock again');

  // setEnabled(false) forwards {enabled:false} and resolves native value
  const enabledRes = await audio.setEnabled(false);
  assert.equal(enabledRes, false);
  const setEnabledCall = calls.find(c => c.setEnabled);
  assert.ok(setEnabledCall, 'setEnabled must be called');
  assert.equal(setEnabledCall.setEnabled.enabled, false);

  // Invalid cue names are not forwarded: '../x', 'A', '', null, undefined, 'lobby'
  const callCountBefore = calls.length;
  for (const invalid of ['../x', 'A', '', null, undefined, 'lobby', 'has space']) {
    const rPlay = await audio.play(invalid);
    assert.equal(rPlay, false);
    const rVoice = await audio.voice(invalid);
    assert.equal(rVoice, false);
  }
  assert.equal(calls.length, callCountBefore, 'invalid cues must not be forwarded');

  // Valid cues are forwarded
  const validPlay = await audio.play('fold_cards');
  assert.equal(validPlay, true);
  const lastPlayCall = calls[calls.length - 1];
  assert.ok(lastPlayCall.play, 'play call recorded');
  assert.equal(lastPlayCall.play.cue, 'fold_cards');
  assert.equal(lastPlayCall.play.channel, 'sfx');

  const validVoice = await audio.voice('dealer_all_in');
  assert.equal(validVoice, true);
  const lastVoiceCall = calls[calls.length - 1];
  assert.ok(lastVoiceCall.play, 'voice call recorded');
  assert.equal(lastVoiceCall.play.cue, 'dealer_all_in');
  assert.equal(lastVoiceCall.play.channel, 'voice');

  // A rejecting/throwing plugin never rejects/throws to the caller
  const brokenPlugin = {
    unlock: async () => { throw new Error('unlock failure'); },
    getState: async () => { throw new Error('getState failure'); },
    setEnabled: async () => { throw new Error('setEnabled failure'); },
    play: async () => { throw new Error('play failure'); },
    preload: async () => { throw new Error('preload failure'); },
    stop: async () => { throw new Error('stop failure'); }
  };
  const brokenWindow = {
    Capacitor: {
      getPlatform() { return 'android'; },
      Plugins: { PokerAudio: brokenPlugin }
    },
    addEventListener() {},
    removeEventListener() {}
  };
  vm.runInNewContext(source, { window: brokenWindow, document: {} });
  const brokenAudio = brokenWindow.MobilePokerAudio;

  await assert.doesNotReject(async () => {
    assert.equal(await brokenAudio.isEnabled(), false);
    assert.equal(await brokenAudio.setEnabled(true), false);
    assert.equal(await brokenAudio.play('bet'), false);
    assert.equal(await brokenAudio.voice('bet'), false);
    assert.equal(await brokenAudio.preload(['bet']), false);
    assert.equal(await brokenAudio.stop(), undefined);
  });
});

test('generate-lobby-loop reproduces committed lobby.wav byte-for-byte matching manifest.json', async () => {
  const { render } = await import('../mobile/poker/audio/generate-lobby-loop.mjs');
  const rendered = render();
  assert.ok(Buffer.isBuffer(rendered), 'render() must return a Buffer');

  const committed = await readFile(new URL('../mobile/poker/audio/lobby.wav', import.meta.url));
  assert.equal(Buffer.compare(rendered, committed), 0, 'rendered buffer must match committed lobby.wav byte-for-byte');

  const manifest = JSON.parse(await readFile(new URL('../mobile/poker/audio/manifest.json', import.meta.url), 'utf8'));
  const sha256 = createHash('sha256').update(rendered).digest('hex');
  assert.equal(rendered.length, manifest.bytes, 'byte length must match manifest.bytes');
  assert.equal(sha256, manifest.sha256, 'sha256 must match manifest.sha256');

  // WAV header check: PCM, mono, 16-bit, 22050
  assert.equal(rendered.toString('utf8', 0, 4), 'RIFF');
  assert.equal(rendered.toString('utf8', 8, 12), 'WAVE');
  assert.equal(rendered.toString('utf8', 12, 16), 'fmt ');
  assert.equal(rendered.readUInt16LE(20), 1, 'AudioFormat must be 1 (PCM)');
  assert.equal(rendered.readUInt16LE(22), 1, 'NumChannels must be 1 (mono)');
  assert.equal(rendered.readUInt32LE(24), 22050, 'SampleRate must be 22050');
  assert.equal(rendered.readUInt16LE(34), 16, 'BitsPerSample must be 16');

  // Seam delta
  const firstSample = rendered.readInt16LE(44);
  const lastSample = rendered.readInt16LE(rendered.length - 2);
  const seamDelta = Math.abs(firstSample - lastSample);
  assert.ok(seamDelta < 200, `first and last sample must be within small amplitude delta (got ${seamDelta})`);

  // Peak check
  let maxInt = 0;
  for (let i = 44; i < rendered.length; i += 2) {
    const v = Math.abs(rendered.readInt16LE(i));
    if (v > maxInt) maxInt = v;
  }
  const peakNorm = maxInt / 32768;
  const dBFS = 20 * Math.log10(peakNorm);
  assert.ok(dBFS <= -6.0, `peak must be <= -6 dBFS (got ${dBFS.toFixed(2)} dBFS)`);
});

test('static guards: root pages contain no mobile/audio references, plugin contains default-ON and no seekTo', async () => {
  const rootFiles = [
    'poker/index.html',
    'poker/table-v2.html',
    'account.html',
    'index.html',
    'poker/offline/play.html'
  ];
  for (const rel of rootFiles) {
    const content = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /mobile\/audio/, `root ${rel} must not contain mobile/audio reference`);
  }

  const pluginJava = await readFile(new URL('../mobile/poker/PokerAudioPlugin.java', import.meta.url), 'utf8');
  assert.ok(pluginJava.includes('getBoolean("sound_on", true)'), 'PokerAudioPlugin.java must contain default-ON getBoolean("sound_on", true)');
  assert.ok(!pluginJava.includes('seekTo('), 'PokerAudioPlugin.java must not contain seekTo(');
});
