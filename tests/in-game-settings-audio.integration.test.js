import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
let failStorageWrites = false;
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) {
    if (failStorageWrites) throw new Error('storage unavailable');
    storage.set(key, String(value));
  },
  removeItem(key) { storage.delete(key); }
};

class FakeAudioParam {
  constructor() { this.events = []; }
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); }
  exponentialRampToValueAtTime(value, time) { this.events.push({ type: 'exponential', value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'linear', value, time }); }
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 1;
    this.destination = {};
    this.oscillators = [];
    this.gains = [];
  }
  createOscillator() {
    const oscillator = {
      type: '',
      frequency: new FakeAudioParam(),
      connect() {},
      start(time) { this.startedAt = time; },
      stop(time) { this.stoppedAt = time; }
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    const gain = { gain: new FakeAudioParam(), connect() {} };
    this.gains.push(gain);
    return gain;
  }
  resume() { return Promise.resolve(); }
}

globalThis.window = {
  AudioContext: class extends FakeAudioContext {
    constructor() {
      super();
      Object.assign(audioContextForTest, this);
      return audioContextForTest;
    }
  }
};

class FakeElement {
  constructor(value = '') {
    this.value = value;
    this.listeners = new Map();
    this.attributes = {};
    this.textContent = '';
    this.innerHTML = '';
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  setAttribute(name, value) { this.attributes[name] = value; }
  click() { this.listeners.get('click')?.({ currentTarget: this, target: this }); }
  input(value) {
    this.value = value;
    this.listeners.get('input')?.({ currentTarget: this, target: this });
  }
}

class FakeModalRoot {
  constructor() {
    this.innerHTML = '';
    this.attributes = {};
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name)
    };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelectorAll() { return []; }
}

const audioContextForTest = new FakeAudioContext();
const modalRoot = new FakeModalRoot();
const nodes = {
  'modal-root': modalRoot,
  'game-bgm-volume': new FakeElement('35'),
  'game-bgm-volume-value': new FakeElement(),
  'game-sfx-volume': new FakeElement('80'),
  'game-sfx-volume-value': new FakeElement(),
  'btn-game-toggle-bgm': new FakeElement(),
  'btn-game-toggle-sfx': new FakeElement(),
  'btn-game-return-lobby': new FakeElement()
};
globalThis.document = {
  getElementById(id) { return nodes[id] || null; }
};

const [
  { createEmptyGameState, SAVE_STORAGE_KEY },
  { renderTopHeaderHtml, bindHeaderFooterEvents },
  audio
] = await Promise.all([
  import('../js/core/state.js'),
  import('../js/ui/header_footer_ui.js'),
  import('../js/ui/audio.js')
]);

test('in-game header exposes a clear, accessible settings gear separate from the profile button', () => {
  const html = renderTopHeaderHtml(createEmptyGameState());
  assert.match(html, /id="btn-open-settings-modal"/);
  assert.match(html, /aria-label="เปิดการตั้งค่าเกม"/);
  assert.match(html, /id="btn-open-profile-modal"/);
});

test('settings gear opens audio controls, saves slider changes, and returns to the lobby', () => {
  storage.clear();
  const state = createEmptyGameState();
  const gearButton = new FakeElement();
  const root = {
    querySelector(selector) {
      return selector === '#btn-open-settings-modal' ? gearButton : null;
    },
    querySelectorAll() { return []; }
  };
  let lobbyReturnCount = 0;

  bindHeaderFooterEvents(root, state, {
    onReturnToLobby() { lobbyReturnCount += 1; }
  });
  gearButton.click();

  assert.ok(modalRoot.classes.has('is-open'));
  assert.match(modalRoot.innerHTML, /การตั้งค่าเกม/);
  assert.match(modalRoot.innerHTML, /ระดับเสียงเพลง/);
  assert.match(modalRoot.innerHTML, /ระดับเสียงปุ่มกด/);
  assert.match(modalRoot.innerHTML, /บันทึกและออกไปหน้าล็อบบี้/);

  nodes['game-bgm-volume'].input('25');
  nodes['game-sfx-volume'].input('65');
  assert.equal(nodes['game-bgm-volume-value'].textContent, '25%');
  assert.equal(nodes['game-sfx-volume-value'].textContent, '65%');
  assert.equal(audio.getAudioPrefs().bgmVolume, 0.25);
  assert.equal(audio.getAudioPrefs().sfxVolume, 0.65);

  nodes['btn-game-return-lobby'].click();
  assert.equal(lobbyReturnCount, 1);
  assert.equal(modalRoot.classes.has('is-open'), false);
  assert.ok(storage.has(SAVE_STORAGE_KEY), 'leaving the game should save the current life');
});

test('failed save keeps the settings modal open and does not navigate away', () => {
  const state = createEmptyGameState();
  const gearButton = new FakeElement();
  const root = {
    querySelector(selector) {
      return selector === '#btn-open-settings-modal' ? gearButton : null;
    },
    querySelectorAll() { return []; }
  };
  let lobbyReturnCount = 0;

  bindHeaderFooterEvents(root, state, {
    onReturnToLobby() { lobbyReturnCount += 1; }
  });
  gearButton.click();
  failStorageWrites = true;
  nodes['btn-game-return-lobby'].click();
  failStorageWrites = false;

  assert.equal(lobbyReturnCount, 0);
  assert.ok(modalRoot.classes.has('is-open'));
  assert.match(modalRoot.innerHTML, /บันทึกและออกไปหน้าล็อบบี้/);
});

test('audio volumes are clamped, saved, and applied independently', () => {
  audio.setBgmVolume(1.4);
  audio.setSfxVolume(-0.2);
  assert.equal(audio.getAudioPrefs().bgmVolume, 1);
  assert.equal(audio.getAudioPrefs().sfxVolume, 0);
  audio.setBgmVolume(0.4);
  audio.setSfxVolume(0.7);

  const savedPrefs = JSON.parse(storage.get('thai_life_sim_audio_v1'));
  assert.equal(savedPrefs.bgmVolume, 0.4);
  assert.equal(savedPrefs.sfxVolume, 0.7);
});

test('click SFX uses a more audible, short triangle chime scaled by its own volume', () => {
  audio.setSfxVolume(0.6);
  audio.playSfx('click');

  // The shared AudioContext is lazily created when the first SFX is requested.
  const context = audioContextForTest;
  assert.equal(context.oscillators.length, 1);
  assert.equal(context.oscillators[0].type, 'triangle');
  assert.ok(context.oscillators[0].stoppedAt - context.oscillators[0].startedAt <= 0.2);
  const peak = context.gains[0].gain.events.find((event) => event.type === 'exponential' && event.value > 0.001);
  assert.ok(peak);
  assert.ok(Math.abs(peak.value - 0.066) < 0.000001, 'click tone should be audible at the configured SFX level');
});

test('muting SFX prevents audio nodes from being created', () => {
  audio.setSfxVolume(0);
  audio.playSfx('click');
  assert.equal(audioContextForTest.oscillators.length, 1);
});
