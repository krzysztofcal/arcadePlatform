import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

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

test('licensed lobby music: committed only encrypted, decrypts to the manifest checksum, fails closed otherwise', async () => {
  const { parseKey, encryptAsset, decryptAsset, assertLobbyPackaged, lobbyEntry } = await import('../mobile/poker/licensed-audio.mjs');
  const entry = await lobbyEntry();
  assert.equal(entry.cue, 'lobby');
  assert.equal(entry.file, 'lobby.mp3');
  assert.equal(entry.sha256, '277f149f3d4fe8e6ddd76b38019fdc6e8ca2f8b50a65eb5609f06af19fdf5556');
  assert.equal(entry.author, 'snoozybeats');
  assert.match(entry.license, /^Pixabay Content License/);
  assert.match(entry.license, /not CC0, not MIT/, 'third-party licence is never labelled CC0 or MIT');
  assert.doesNotMatch(JSON.stringify(entry), /project-owned|procedurally/i);
  // No plaintext lobby audio is tracked: only the encrypted file.
  const tracked = execFileSync('git', ['ls-files', 'mobile/poker/audio'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual(tracked.filter(name => /\/lobby\./.test(name)), ['mobile/poker/audio/lobby.mp3.enc']);
  const blob = await readFile(new URL('../mobile/poker/audio/lobby.mp3.enc', import.meta.url));
  assert.ok(blob.length > entry.bytes, 'committed file is the encrypted container');
  assert.notEqual(createHash('sha256').update(blob).digest('hex'), entry.sha256);

  // Synthetic fixture only: the real key never exists in tests.
  const key = Buffer.alloc(32, 7), plain = Buffer.from('synthetic lobby fixture');
  const sum = createHash('sha256').update(plain).digest('hex');
  const sealed = encryptAsset(plain, key, 'lobby.mp3');
  assert.equal(Buffer.compare(decryptAsset(sealed, key, 'lobby.mp3', sum), plain), 0);
  assert.throws(() => decryptAsset(sealed, Buffer.alloc(32, 8), 'lobby.mp3', sum), /authentication/);
  const altered = Buffer.from(sealed); altered[altered.length - 1] ^= 1;
  assert.throws(() => decryptAsset(altered, key, 'lobby.mp3', sum), /authentication/);
  assert.throws(() => decryptAsset(sealed, key, 'other.mp3', sum), /authentication/);
  assert.throws(() => decryptAsset(sealed, key, 'lobby.mp3', '0'.repeat(64)), /checksum/);
  for (const bad of [undefined, '', 'short', Buffer.alloc(16).toString('base64')]) assert.throws(() => parseKey(bad), /MOBILE_LOBBY_MUSIC_KEY/);
  assert.equal(parseKey(key.toString('base64')).length, 32);
  // Official packaging refuses a missing or altered lobby track.
  assert.throws(() => assertLobbyPackaged([{ name: 'bonus_coins.mp3', sha256: 'x' }], entry), /refusing/);
  assert.throws(() => assertLobbyPackaged([{ name: 'lobby.mp3', sha256: '0'.repeat(64) }], entry), /refusing/);
  assert.throws(() => assertLobbyPackaged([{ name: 'lobby.wav', sha256: 'x' }, { name: 'lobby.mp3', sha256: entry.sha256 }], entry), /refusing/, 'a second lobby file is refused');
  assert.doesNotThrow(() => assertLobbyPackaged([{ name: 'lobby.mp3', sha256: entry.sha256 }], entry));
});

test('bonus cue is the bundled CC0 CapsLok preview, unchanged, recorded in the manifest and under the native cue limit', async () => {
  const committed = await readFile(new URL('../mobile/poker/audio/bonus_coins.mp3', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../mobile/poker/audio/manifest.json', import.meta.url), 'utf8'));
  const bonusEntries = manifest.assets.filter(a => a.cue === 'bonus_coins');
  assert.equal(bonusEntries.length, 1, 'exactly one bonus_coins asset');
  const entry = bonusEntries[0];
  assert.equal(entry.file, 'bonus_coins.mp3');
  assert.equal(committed.length, entry.bytes);
  assert.equal(createHash('sha256').update(committed).digest('hex'), entry.sha256);
  // MPEG-1 Layer III frame header, 44.1 kHz: a format SoundPool decodes natively.
  const header = committed.readUInt32BE(0);
  assert.equal(header >>> 21, 0x7ff, 'MP3 frame sync');
  assert.equal((header >>> 19) & 3, 3, 'MPEG-1');
  assert.equal((header >>> 17) & 3, 1, 'Layer III');
  assert.equal((header >>> 10) & 3, 0, '44100 Hz');
  assert.ok(entry.durationSeconds > 0 && entry.durationSeconds < 3, 'below the native 3 s cue limit');
  assert.equal(entry.author, 'CapsLok');
  assert.equal(entry.sourceUrl, 'https://freesound.org/people/CapsLok/sounds/184438/');
  assert.match(entry.license, /^CC0 1\.0/);
  assert.doesNotMatch(JSON.stringify(entry), /\bMIT\b|project-owned|procedurally/i, 'third-party audio is not labelled project work');
  // One file per cue: a second bonus_coins.* would make the native base-name lookup ambiguous.
  const files = (await readdir(new URL('../mobile/poker/audio/', import.meta.url))).filter(name => name.startsWith('bonus_coins.'));
  assert.deepEqual(files, ['bonus_coins.mp3']);
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

test('table cues: every cue named in poker-v2.js is a bundled WAV under the native 3 s limit with recorded provenance; WWW never reaches native', async () => {
  const source = await readFile(new URL('../poker/poker-v2.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('var TABLE_CUES = {'), source.indexOf('var tableCueAt'));
  const cues = [...new Set([...block.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]))];
  assert.equal(cues.length, 19, 'thirteen Kenney table cues and six dealer lines');
  const manifest = JSON.parse(await readFile(new URL('../mobile/poker/audio/manifest.json', import.meta.url), 'utf8'));
  for (const cue of cues) {
    const entries = manifest.assets.filter(a => a.cue === cue);
    assert.equal(entries.length, 1, cue);
    const [entry] = entries;
    const file = await readFile(new URL('../mobile/poker/audio/' + entry.file, import.meta.url));
    assert.equal(createHash('sha256').update(file).digest('hex'), entry.sha256, cue);
    assert.equal(file.length, entry.bytes, cue);
    assert.equal(file.toString('ascii', 0, 4) + file.toString('ascii', 8, 12), 'RIFFWAVE', cue);
    assert.equal(file.readUInt16LE(20), 1, cue + ' PCM');
    const seconds = file.readUInt32LE(40) / file.readUInt32LE(28);
    assert.ok(seconds > 0 && seconds < 3, cue + ' below the native cue limit');
    if (cue.startsWith('dealer_')) {
      // #1146 PR4: project-generated voice; the pinned open-weight model is recorded, never bundled.
      assert.equal(entry.channel, 'voice', cue);
      assert.match(entry.creationMethod, /Kokoro-82M-v1\.0-ONNX revision 1939ad2a8e416c0acfeecc08a694d14ef25f2231/);
      assert.match(entry.license, /Apache-2\.0/);
      continue;
    }
    assert.match(entry.license, /^CC0 1\.0/);
    assert.equal(entry.sourceUrl, 'https://kenney.nl/assets/casino-audio');
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/);
  }
  // Only the guarded helper touches the adapter, which exists solely in the Android APK.
  assert.equal(source.match(/window\.MobilePokerAudio\b(?!\s+exists)/g).length, 1, 'one code reference, inside tableAudio()');
  assert.match(source, /function tableAudio\(\)\{\s*var audio = window\.MobilePokerAudio;\s*return audio && typeof audio\.play === 'function' \? audio : null;/);
});

