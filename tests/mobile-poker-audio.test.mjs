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
    assert.equal(await audio.stop(), false);
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
    assert.equal(await audio.stop(), false);
    assert.deepEqual(Object.keys(windowListeners), []);
    assert.deepEqual(Object.keys(documentListeners), []);
    assert.deepEqual(pluginCalls, []);
  }
});

test('adapter with fake android PokerAudio plugin needs no gesture and forwards calls safely', async () => {
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

  // Music is started natively without a gesture: the adapter listens to nothing and has no unlock call
  assert.deepEqual(Object.keys(windowListeners), [], 'adapter registers no gesture listeners');
  assert.equal(unlockCalls, 0);

  // setEnabled(false) forwards {enabled:false} and resolves native value
  const enabledRes = await audio.setEnabled(false);
  assert.equal(enabledRes, false);
  const setEnabledCall = calls.find(c => c.setEnabled);
  assert.ok(setEnabledCall, 'setEnabled must be called');
  assert.equal(setEnabledCall.setEnabled.enabled, false);

  // Invalid cue names are not forwarded (the native owner additionally refuses the music cue)
  const callCountBefore = calls.length;
  for (const invalid of ['../x', 'A', '', null, undefined, 'has space']) {
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
    assert.equal(await brokenAudio.stop(), false);
  });
});

test('generate-lobby-loop reproduces committed lobby.wav byte-for-byte matching manifest.json', async () => {
  const { render } = await import('../mobile/poker/audio/generate-lobby-loop.mjs');
  const rendered = render();
  assert.ok(Buffer.isBuffer(rendered), 'render() must return a Buffer');

  const committed = await readFile(new URL('../mobile/poker/audio/lobby.wav', import.meta.url));
  assert.equal(Buffer.compare(rendered, committed), 0, 'rendered buffer must match committed lobby.wav byte-for-byte');

  const manifest = JSON.parse(await readFile(new URL('../mobile/poker/audio/manifest.json', import.meta.url), 'utf8'));
  const lobbyEntry = manifest.assets.find(a => a.file === 'lobby.wav');
  assert.ok(lobbyEntry, 'manifest must contain lobby.wav entry');
  const sha256 = createHash('sha256').update(rendered).digest('hex');
  assert.equal(rendered.length, lobbyEntry.bytes, 'byte length must match manifest.bytes');
  assert.equal(sha256, lobbyEntry.sha256, 'sha256 must match manifest.sha256');

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

test('generate-bonus-coins reproduces committed bonus_coins.wav byte-for-byte matching manifest.json', async () => {
  const { render } = await import('../mobile/poker/audio/generate-bonus-coins.mjs');
  const rendered = render();
  assert.ok(Buffer.isBuffer(rendered), 'render() must return a Buffer');

  const committed = await readFile(new URL('../mobile/poker/audio/bonus_coins.wav', import.meta.url));
  assert.equal(Buffer.compare(rendered, committed), 0, 'rendered buffer must match committed bonus_coins.wav byte-for-byte');

  const manifest = JSON.parse(await readFile(new URL('../mobile/poker/audio/manifest.json', import.meta.url), 'utf8'));
  const bonusEntry = manifest.assets.find(a => a.file === 'bonus_coins.wav');
  assert.ok(bonusEntry, 'manifest must contain bonus_coins.wav entry');

  const sha256 = createHash('sha256').update(rendered).digest('hex');
  assert.equal(rendered.length, bonusEntry.bytes, 'byte length must match manifest.bytes');
  assert.equal(sha256, bonusEntry.sha256, 'sha256 must match manifest.sha256');

  // Header check: PCM, mono, 16-bit, 44100
  assert.equal(rendered.toString('utf8', 0, 4), 'RIFF');
  assert.equal(rendered.toString('utf8', 8, 12), 'WAVE');
  assert.equal(rendered.toString('utf8', 12, 16), 'fmt ');
  assert.equal(rendered.readUInt16LE(20), 1, 'AudioFormat must be 1 (PCM)');
  assert.equal(rendered.readUInt16LE(22), 1, 'NumChannels must be 1 (mono)');
  assert.equal(rendered.readUInt32LE(24), 44100, 'SampleRate must be 44100');
  assert.equal(rendered.readUInt16LE(34), 16, 'BitsPerSample must be 16');

  // Duration between 1.5 and 2.0 s (< 3 s)
  const duration = (rendered.length - 44) / (44100 * 2);
  assert.ok(duration >= 1.5 && duration <= 2.0 && duration < 3.0, `duration must be 1.5-2.0s and <3s (got ${duration.toFixed(3)}s)`);

  // Peak check <= -6 dBFS
  let maxInt = 0;
  for (let i = 44; i < rendered.length; i += 2) {
    const v = Math.abs(rendered.readInt16LE(i));
    if (v > maxInt) maxInt = v;
  }
  const peakNorm = maxInt / 32768;
  const dBFS = 20 * Math.log10(peakNorm);
  assert.ok(dBFS <= -6.0, `peak must be <= -6 dBFS (got ${dBFS.toFixed(2)} dBFS)`);

  // Last sample must be 0
  const lastSample = rendered.readInt16LE(rendered.length - 2);
  assert.equal(lastSample, 0, 'last sample must be 0');
});

test('adapter mounts exactly one toggle in avatarMenu and table panel, reflects native state, and handles change', async () => {
  const source = await readFile(new URL('../mobile/poker/audio.js', import.meta.url), 'utf8');

  function createFakeDOM(hostType) {
    const docListeners = {};
    const winListeners = {};
    const elementsById = {};

    function makeElement(tag, id = '', className = '') {
      const listeners = {};
      const children = [];
      const el = {
        tagName: tag.toUpperCase(),
        id,
        className,
        hidden: false,
        checked: false,
        parentNode: null,
        children,
        get firstChild() { return children[0] || null; },
        addEventListener(event, fn) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(fn);
        },
        dispatchEvent(event) {
          const type = typeof event === 'string' ? event : event.type;
          for (const fn of (listeners[type] || [])) fn.call(el, typeof event === 'string' ? { type: event, target: el } : event);
        },
        appendChild(child) {
          child.parentNode = el;
          children.push(child);
          if (child.id) elementsById[child.id] = child;
          return child;
        },
        insertBefore(child, ref) {
          const idx = children.indexOf(ref);
          if (idx === -1) return el.appendChild(child);
          child.parentNode = el;
          children.splice(idx, 0, child);
          if (child.id) elementsById[child.id] = child;
          return child;
        },
        querySelector(selector) {
          function match(node) {
            if (selector.startsWith('#') && node.id === selector.slice(1)) return true;
            if (selector.startsWith('.') && (node.className || '').split(/\s+/).includes(selector.slice(1))) return true;
            if (node.tagName && node.tagName.toLowerCase() === selector.toLowerCase()) return true;
            return false;
          }
          for (const child of children) {
            if (match(child)) return child;
            if (child.querySelector) {
              const res = child.querySelector(selector);
              if (res) return res;
            }
          }
          return null;
        }
      };
      if (id) elementsById[id] = el;
      return el;
    }

    const document = {
      readyState: 'complete',
      createElement: makeElement,
      createTextNode: (text) => ({ nodeType: 3, textContent: text }),
      getElementById: (id) => elementsById[id] || null,
      addEventListener(event, fn) {
        if (!docListeners[event]) docListeners[event] = [];
        docListeners[event].push(fn);
      },
      dispatchEvent(event) {
        const type = typeof event === 'string' ? event : event.type;
        for (const fn of (docListeners[type] || [])) fn(typeof event === 'string' ? { type: event } : event);
      }
    };

    const window = {
      addEventListener(event, fn) {
        if (!winListeners[event]) winListeners[event] = [];
        winListeners[event].push(fn);
      },
      dispatchEvent(event) {
        const type = typeof event === 'string' ? event : event.type;
        for (const fn of (winListeners[type] || [])) fn(typeof event === 'string' ? { type: event } : event);
      }
    };

    if (hostType === 'avatar') {
      const avatarMenu = makeElement('div', 'avatarMenu', 'avatar-menu');
      document.body = makeElement('body');
      document.body.appendChild(avatarMenu);
    } else if (hostType === 'table') {
      const panel = makeElement('section', 'pokerSocialSettingsPanel', 'poker-social-settings');
      const firstOpt = makeElement('label', 'reactionBubbles', 'poker-social-settings__option');
      panel.appendChild(firstOpt);
      document.body = makeElement('body');
      document.body.appendChild(panel);
    }

    return { window, document, elementsById };
  }

  // Host #avatarMenu: mounts exactly one toggle, initially hidden, shown with native value
  {
    const calls = [];
    let stateEnabled = true;
    const fakePlugin = {
      getState: async () => { calls.push('getState'); return { enabled: stateEnabled }; },
      setEnabled: async (opts) => { calls.push({ setEnabled: opts }); stateEnabled = opts.enabled; return { enabled: opts.enabled }; }
    };
    const { window, document, elementsById } = createFakeDOM('avatar');
    window.Capacitor = {
      getPlatform() { return 'android'; },
      Plugins: { PokerAudio: fakePlugin }
    };

    vm.runInNewContext(source, { window, document });
    const setting = elementsById.mobileSoundSetting;
    assert.ok(setting, '#mobileSoundSetting must be mounted in #avatarMenu');
    assert.equal(setting.className, 'avatar-menu__sound');
    assert.equal(elementsById.avatarMenu.children[elementsById.avatarMenu.children.length - 1], setting, 'must be last child of avatarMenu');

    // Wait for isEnabled() promise to resolve and reveal the toggle
    await new Promise(r => setTimeout(r, 10));
    assert.equal(setting.hidden, false, 'setting must be visible after isEnabled() resolves');
    const input = setting.querySelector('#mobileSoundPreference');
    assert.ok(input, 'must contain input checkbox #mobileSoundPreference');
    assert.equal(input.checked, true, 'input reflects native state (default enabled)');

    // Changing checkbox calls setEnabled once and reflects returned value
    input.checked = false;
    input.dispatchEvent('change');
    await new Promise(r => setTimeout(r, 10));
    const setEnabledCalls = calls.filter(c => c.setEnabled);
    assert.equal(setEnabledCalls.length, 1, 'setEnabled must be called once on change');
    assert.equal(setEnabledCalls[0].setEnabled.enabled, false, 'setEnabled passed {enabled: false}');
    assert.equal(input.checked, false, 'input reflects updated value');
  }

  // A failed native call is never shown as a confirmed OFF: the control re-reads, or hides
  {
    let setFails = true, readFails = false, nativeEnabled = true;
    const fakePlugin = {
      getState: async () => { if (readFails) throw new Error('read'); return { enabled: nativeEnabled }; },
      setEnabled: async (opts) => { if (setFails) throw new Error('write'); nativeEnabled = opts.enabled; return { enabled: nativeEnabled }; }
    };
    const { window, document, elementsById } = createFakeDOM('avatar');
    window.Capacitor = { getPlatform() { return 'android'; }, Plugins: { PokerAudio: fakePlugin } };
    vm.runInNewContext(source, { window, document });
    await new Promise(r => setTimeout(r, 10));
    const setting = elementsById.mobileSoundSetting;
    const input = setting.querySelector('#mobileSoundPreference');
    input.checked = false;
    input.dispatchEvent('change');
    await new Promise(r => setTimeout(r, 10));
    assert.equal(input.checked, true, 'failed write: the toggle returns to the real native value');
    assert.equal(setting.hidden, false);
    readFails = true;
    input.checked = false;
    input.dispatchEvent('change');
    await new Promise(r => setTimeout(r, 10));
    assert.equal(setting.hidden, true, 'state unknown: the control is hidden, not shown as OFF');
  }

  // Host #pokerSocialSettingsPanel: mounts directly before first .poker-social-settings__option
  {
    const calls = [];
    const fakePlugin = {
      getState: async () => { calls.push('getState'); return { enabled: true }; },
      setEnabled: async (opts) => { calls.push({ setEnabled: opts }); return { enabled: opts.enabled }; }
    };
    const { window, document, elementsById } = createFakeDOM('table');
    window.Capacitor = {
      getPlatform() { return 'android'; },
      Plugins: { PokerAudio: fakePlugin }
    };

    vm.runInNewContext(source, { window, document });
    const setting = elementsById.mobileSoundSetting;
    assert.ok(setting, '#mobileSoundSetting must be mounted in #pokerSocialSettingsPanel');
    assert.equal(setting.className, 'poker-social-settings__option');
    const panel = elementsById.pokerSocialSettingsPanel;
    assert.equal(panel.children[0], setting, 'must be inserted before first .poker-social-settings__option');
  }
});

test('bonus cue is decoded ahead of time on the Lobby only, never without the Android plugin', async () => {
  const source = await readFile(new URL('../mobile/poker/audio.js', import.meta.url), 'utf8');
  const run = (pathname, android) => {
    const preloads = [];
    const window = { location: { pathname }, addEventListener() {} };
    if (android) window.Capacitor = { getPlatform: () => 'android', Plugins: { PokerAudio: { preload: async o => { preloads.push(JSON.stringify(o.cues)); }, getState: async () => ({ enabled: true }) } } };
    vm.runInNewContext(source, { window, document: { readyState: 'loading', addEventListener() {} } });
    return preloads;
  };
  assert.deepEqual(run('/poker/index.html', true), ['["bonus_coins"]']);
  assert.deepEqual(run('/poker/', true), ['["bonus_coins"]']);
  for (const page of ['/account.html', '/poker/table-v2.html', '/poker/offline/play.html']) assert.deepEqual(run(page, true), [], page);
  assert.deepEqual(run('/poker/index.html', false), [], 'WWW/browser never calls native');
});

test('bonus hook guard on poker/poker.js source text', async () => {
  const content = await readFile(new URL('../poker/poker.js', import.meta.url), 'utf8');

  // playBonusCue() definition
  assert.match(content, /function\s+playBonusCue\s*\(\)\s*\{[^}]*window\.MobilePokerAudio\.play\('bonus_coins'\)[^}]*\}/, 'playBonusCue helper must be defined');

  // Outside its definition, playBonusCue() is called exactly twice
  const bodyWithoutDef = content.replace(/function\s+playBonusCue\s*\(\)\s*\{[^}]*\}/, '');
  const callsOutsideDef = [...bodyWithoutDef.matchAll(/\bplayBonusCue\s*\(\s*\)/g)];
  assert.equal(callsOutsideDef.length, 2, 'playBonusCue() must be called exactly twice outside definition');

  // Once in claimDailyBonus inside result.claimed === true block
  const dailySection = content.slice(content.indexOf('async function claimDailyBonus()'), content.indexOf('async function claimWelcomeBonus()'));
  assert.match(dailySection, /if \(result\.claimed\) showDailyFlyin\(result\);\s*if \(result\.claimed === true\) playBonusCue\(\);/, 'playBonusCue called in claimDailyBonus only on a confirmed new claim');

  // Once in claimWelcomeBonus right after showWelcomeFlyin(result.amount)
  const welcomeSection = content.slice(content.indexOf('async function claimWelcomeBonus()'), content.indexOf('async function claimWelcomeBonus()') + 2000);
  assert.match(welcomeSection, /if\s*\(\s*result\s*&&\s*result\.claimed\s*===\s*true\s*&&\s*Number\.isSafeInteger\(result\.amount\)[\s\S]*?showWelcomeFlyin\(result\.amount\);\s*playBonusCue\(\);/, 'playBonusCue called in claimWelcomeBonus after showWelcomeFlyin');

  // No other MobilePokerAudio references in poker/poker.js outside playBonusCue definition
  assert.doesNotMatch(bodyWithoutDef, /MobilePokerAudio/, 'no MobilePokerAudio reference anywhere else in poker/poker.js');
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
  assert.ok(!/unlock/i.test(pluginJava), 'native music start must not depend on a user gesture');
  assert.ok(pluginJava.includes('AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK'), 'cues take only brief may-duck focus');
  // Transient focus loss followed by a headset unplug (hold) must not keep the interrupted request:
  // the receiver sets hold and syncs, and sync() drops focusPaused before pauseMusic()/dropFocus() run.
  assert.match(pluginJava, /onReceive\([^)]*\) \{[^}]*hold = true;[^}]*sync\(false\);/, 'headset unplug sets hold and syncs');
  const syncBody = pluginJava.slice(pluginJava.indexOf('private void sync(boolean fade)'), pluginJava.indexOf('private void fadeTo('));
  const clear = syncBody.indexOf('if (!enabled || !resumed || hold || !musicScene) focusPaused = false;');
  assert.ok(clear !== -1 && clear < syncBody.indexOf('boolean want'), 'sync() keeps an interrupted focus request only while music would resume');
  assert.ok(pluginJava.includes('releaseCueFocus = this::stopCues'), 'the cue focus timeout stops cues before releasing focus');
  assert.match(pluginJava, /private void dropFocus\(\) \{[^}]*stopCues\(\);[^}]*abandonAudioFocus\(focus\)/, 'music focus is never abandoned under a playing cue');
});
