import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import {
  SAVE_STORAGE_KEY,
  createEmptyGameState,
  getState,
  loadGame,
  setState
} from '../js/core/state.js';
import { selectCurrentEventChoice } from '../js/engine/turn_manager.js';
import { renderTab1LifeFeed } from '../js/ui/tab1_life_feed.js';
import {
  bindHeaderFooterEvents,
  renderBottomDockHtml
} from '../js/ui/header_footer_ui.js';

const originalLocalStorage = globalThis.localStorage;
const originalDocument = globalThis.document;
const originalDbRaw = db.raw;
const originalDbIsLoaded = db.isLoaded;
const originalIndexEntries = Object.fromEntries(
  Object.entries(db.indexes).map(([key, map]) => [key, new Map(map)])
);
const originalState = getState();
const storage = new Map();

globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  }
};

// The UI may request a toast for a blocked tab. Returning no toast root keeps
// this test focused on the UI contract without implementing toast rendering.
globalThis.document = {
  getElementById() {
    return null;
  }
};

const fixtureData = {};
for (const [key, filename] of Object.entries(DATA_MANIFEST)) {
  const filePath = fileURLToPath(new URL(`../data/${filename}`, import.meta.url));
  fixtureData[key] = JSON.parse(await readFile(filePath, 'utf8'));
}

test.beforeEach(() => {
  storage.clear();
  db.raw = structuredClone(fixtureData);
  db.buildIndexes();
  db.isLoaded = true;
  setState(null);
});

test.after(() => {
  db.raw = originalDbRaw;
  db.isLoaded = originalDbIsLoaded;
  for (const [key, map] of Object.entries(db.indexes)) {
    map.clear();
    for (const [entryKey, value] of originalIndexEntries[key]) {
      map.set(entryKey, value);
    }
  }
  setState(originalState);

  if (originalLocalStorage === undefined) {
    delete globalThis.localStorage;
  } else {
    globalThis.localStorage = originalLocalStorage;
  }

  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
});

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = { ...attributes };
    this.listeners = new Map();
    this.disabled = Boolean(attributes.disabled);
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  click() {
    if (this.disabled) return;
    this.listeners.get('click')?.({
      currentTarget: this,
      target: this
    });
  }
}

class FakeContainer {
  constructor(choiceButtons = []) {
    this.choiceButtons = choiceButtons;
  }

  querySelector() {
    return null;
  }

  querySelectorAll(selector) {
    return selector === '[data-choice-id]' ? this.choiceButtons : [];
  }
}

class FakeRoot {
  constructor({ primaryButton = null, navButtons = [] } = {}) {
    this.primaryButton = primaryButton;
    this.navButtons = navButtons;
  }

  querySelector(selector) {
    if (selector === '#btn-primary-turn-action') return this.primaryButton;
    return null;
  }

  querySelectorAll(selector) {
    return selector === '[data-nav-tab]' ? this.navButtons : [];
  }
}

function createUiEventState() {
  const state = createEmptyGameState();
  state.profile.age = 25;
  state.profile.isAlive = true;
  state.profile.currentClassId = 'class_3';
  state.profile.spawnClassId = 'class_3';
  state.profile.currentLocationId = 'loc_bangkok';
  state.stats = {
    health: 70,
    happiness: 60,
    intelligence: 55,
    connections: 50,
    merit: 20,
    appearance: 55
  };
  state.finance.cash = 1000;
  state.finance.piggyBank = 300;
  state.turn.phase = 'EVENT_QUEUE';
  state.turn.areTabsLocked = true;
  state.turn.pendingEvents = [{
    event_id: 'evt_ui_contract',
    source_type: 'pool_event',
    category: 'general',
    min_age: 0,
    max_age: 100,
    title_th: 'เหตุการณ์จากหน้าจอ',
    description_th: 'ใช้ตรวจสอบการเชื่อมต่อระหว่างหน้าจอกับระบบเกม',
    monthNum: 1,
    monthTh: 'มกราคม',
    req_flags: [],
    forbidden_flags: [],
    choices: [{
      choice_id: 'choice_ui_yes',
      label_th: 'เลือกช่วยเหลือ',
      req_stats: {},
      req_flags: [],
      stat_effects: { happiness: 8 },
      grants_flags: [],
      removes_flags: []
    }]
  }, {
    event_id: 'evt_ui_contract_second',
    source_type: 'pool_event',
    category: 'general',
    min_age: 0,
    max_age: 100,
    title_th: 'เหตุการณ์ใบที่สอง',
    description_th: 'ใช้ตรวจสอบการแสดงเหตุการณ์ถัดไป',
    monthNum: 2,
    monthTh: 'กุมภาพันธ์',
    req_flags: [],
    forbidden_flags: [],
    choices: [{
      choice_id: 'choice_ui_second',
      label_th: 'ดำเนินการต่อ',
      req_stats: {},
      req_flags: [],
      stat_effects: { intelligence: 1 },
      grants_flags: [],
      removes_flags: []
    }]
  }];
  state.turn.currentEventIndex = 0;
  state.turn.awaitingEventAdvance = false;
  state.turn.lastChoiceOutcome = null;
  state.turn.triggeredEventIdsThisLife = [];
  state.turn.lifeFeedLog = [];
  return state;
}

test('event card renders the current event and binds a choice click to the game engine', () => {
  const state = createUiEventState();
  const refreshCalls = [];
  const view = renderTab1LifeFeed(state, {
    onRefresh: () => refreshCalls.push('refresh')
  });

  assert.match(view.html, /เหตุการณ์จากหน้าจอ/);
  assert.match(view.html, /data-choice-id="choice_ui_yes"/);
  assert.match(view.html, /เลือกช่วยเหลือ/);
  assert.match(view.html, /ช่วยเพิ่มความสบายใจและความสุข/);
  assert.doesNotMatch(view.html, /\\+8|ความสุข\\s*8/);

  const choiceButton = new FakeElement({ 'data-choice-id': 'choice_ui_yes' });
  view.bind(new FakeContainer([choiceButton]));
  choiceButton.click();

  assert.equal(state.stats.happiness, 63);
  assert.equal(state.turn.awaitingEventAdvance, true);
  assert.equal(state.turn.lastChoiceOutcome?.success, true);
  assert.deepEqual(refreshCalls, ['refresh']);

  const resultView = renderTab1LifeFeed(state, { onRefresh() {} });
  assert.match(resultView.html, /เรื่องราวหลังการตัดสินใจ/);
  assert.ok(resultView.html.includes(state.turn.lastChoiceOutcome.outcomeTextTh));
  assert.match(state.turn.lastChoiceOutcome.outcomeTextTh, /หลังจากคุณเลือก/);
  assert.match(state.turn.lastChoiceOutcome.outcomeTextTh, /ทางเลือกนี้ส่งผลในด้านที่เป็นประโยชน์/);
});

test('sticky primary action advances through the second event before free action', () => {
  const state = createUiEventState();
  const choiceResult = selectCurrentEventChoice('choice_ui_yes', state);
  assert.equal(choiceResult.success, true);

  const dockBeforeAdvance = renderBottomDockHtml(state, 'tab1');
  assert.match(dockBeforeAdvance, /เหตุการณ์ถัดไป/);
  assert.match(dockBeforeAdvance, /id="btn-primary-turn-action"/);

  const primaryButton = new FakeElement();
  const root = new FakeRoot({ primaryButton });
  const actionResults = [];

  bindHeaderFooterEvents(root, state, {
    onTabChange() {},
    onAfterPrimaryAction: (result) => actionResults.push(result),
    onReturnToLobby() {}
  });
  primaryButton.click();

  assert.equal(state.turn.phase, 'EVENT_QUEUE');
  assert.equal(state.turn.currentEventIndex, 1);
  assert.equal(state.turn.awaitingEventAdvance, false);
  assert.equal(actionResults.length, 1);
  assert.equal(actionResults[0].completedQueue, false);

  const secondEventView = renderTab1LifeFeed(state, { onRefresh() {} });
  assert.match(secondEventView.html, /เหตุการณ์ใบที่สอง/);

  const secondChoice = selectCurrentEventChoice('choice_ui_second', state);
  assert.equal(secondChoice.success, true);
  const dockBeforeUnlock = renderBottomDockHtml(state, 'tab1');
  assert.match(dockBeforeUnlock, /เข้าสู่ช่วงอิสระท้ายปี/);
  primaryButton.click();

  assert.equal(state.turn.phase, 'FREE_ACTION');
  assert.equal(state.turn.areTabsLocked, false);
  assert.equal(state.turn.awaitingEventAdvance, false);
  assert.equal(actionResults.length, 2);
  assert.equal(actionResults[1].completedQueue, true);

  const dockAfterAdvance = renderBottomDockHtml(state, 'tab1');
  assert.match(dockAfterAdvance, /ปีถัดไป \(\+1 ปี\)/);
});

test('save and reload preserve the event outcome required to render the same result screen', () => {
  const state = createUiEventState();
  const result = selectCurrentEventChoice('choice_ui_yes', state);
  assert.equal(result.success, true);

  const savedText = storage.get(SAVE_STORAGE_KEY);
  assert.ok(savedText);
  assert.equal(JSON.parse(savedText).turn.awaitingEventAdvance, true);

  setState(null);
  const restoredState = loadGame();

  assert.ok(restoredState);
  assert.equal(restoredState.turn.awaitingEventAdvance, true);
  assert.equal(restoredState.turn.lastChoiceOutcome.outcomeTextTh, result.outcomeTextTh);

  const restoredView = renderTab1LifeFeed(restoredState, { onRefresh() {} });
  assert.match(restoredView.html, /เรื่องราวหลังการตัดสินใจ/);
  assert.ok(restoredView.html.includes(result.outcomeTextTh));

  const restoredDock = renderBottomDockHtml(restoredState, 'tab1');
  assert.match(restoredDock, /เหตุการณ์ถัดไป/);
});

test('bottom navigation honors the tab lock and allows navigation after the lock is lifted', () => {
  const state = createUiEventState();
  const lockedTab = new FakeElement({
    'data-nav-tab': 'tab2',
    'data-tab-locked': '1'
  });
  const primaryButton = new FakeElement();
  const lockedRoot = new FakeRoot({
    primaryButton,
    navButtons: [lockedTab]
  });
  const selectedTabs = [];

  assert.match(renderBottomDockHtml(state, 'tab1'), /data-nav-tab="tab2"[\s\S]*?data-tab-locked="1"/);

  bindHeaderFooterEvents(lockedRoot, state, {
    onTabChange: (tabId) => selectedTabs.push(tabId),
    onAfterPrimaryAction() {},
    onReturnToLobby() {}
  });
  lockedTab.click();
  assert.deepEqual(selectedTabs, []);

  state.turn.areTabsLocked = false;
  const unlockedTab = new FakeElement({
    'data-nav-tab': 'tab2',
    'data-tab-locked': '0'
  });
  const unlockedRoot = new FakeRoot({
    primaryButton: new FakeElement(),
    navButtons: [unlockedTab]
  });

  bindHeaderFooterEvents(unlockedRoot, state, {
    onTabChange: (tabId) => selectedTabs.push(tabId),
    onAfterPrimaryAction() {},
    onReturnToLobby() {}
  });
  unlockedTab.click();

  assert.deepEqual(selectedTabs, ['tab2']);
  assert.match(renderBottomDockHtml(state, 'tab2'), /class="nav-tab-btn is-active "/);
});
