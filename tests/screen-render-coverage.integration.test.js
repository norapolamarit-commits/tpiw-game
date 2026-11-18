import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createEmptyGameState, getState, setState } from '../js/core/state.js';

const originalLocalStorage = globalThis.localStorage;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
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

// main.js is imported by the rebirth screen. Keep its browser boot hook dormant;
// these tests exercise screen renderers and their event-binding contracts directly.
globalThis.document = {
  readyState: 'loading',
  addEventListener() {},
  getElementById() {
    return null;
  }
};
globalThis.window = {
  addEventListener() {},
  dispatchEvent() {}
};

const [
  { renderLobbyScreen, renderRebornScreen },
  { renderTab1LifeFeed },
  { renderTab2WorkStudy },
  { renderTab3Relationships },
  { renderTab4AssetsDebt },
  { renderTab5LifestyleShop },
  { renderEndingScreen },
  { renderAnnualBreakdownRows }
] = await Promise.all([
  import('../js/ui/screen_lobby_reborn.js'),
  import('../js/ui/tab1_life_feed.js'),
  import('../js/ui/tab2_work_study.js'),
  import('../js/ui/tab3_relationships.js'),
  import('../js/ui/tab4_assets_debt.js'),
  import('../js/ui/tab5_lifestyle_shop.js'),
  import('../js/ui/modals_ending_ui.js'),
  import('../js/ui/modals_ending_ui.js')
]);

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

  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;

  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;

  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

class FakeButton {
  constructor() {
    this.listeners = new Map();
    this.style = {};
    this.value = '';
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  click() {
    this.listeners.get('click')?.({
      currentTarget: this,
      target: this
    });
  }
}

class FakeScreenRoot {
  constructor(buttons = {}) {
    this.buttons = buttons;
    this.innerHTML = '';
  }

  querySelector(selector) {
    return this.buttons[selector] || null;
  }

  querySelectorAll() {
    return [];
  }
}

function createScreenState(age = 25) {
  const state = createEmptyGameState();
  state.meta.runId = `screen-test-${age}`;
  state.meta.generationNumber = 1;
  state.profile.name = 'ผู้เล่นทดสอบ';
  state.profile.firstName = 'ผู้เล่น';
  state.profile.lastName = 'ทดสอบ';
  state.profile.nickname = 'ทดสอบ';
  state.profile.titlePrefix = 'นาย';
  state.profile.gender = 'male';
  state.profile.age = age;
  state.profile.currentYearBE = 2569;
  state.profile.birthYearBE = 2569 - age;
  state.profile.lifePhaseId = age < 18 ? 'phase_2_child' : 'phase_4_young_adult';
  state.profile.spawnClassId = 'class_3';
  state.profile.currentClassId = 'class_3';
  state.profile.currentLocationId = 'loc_bangkok';
  state.profile.isAlive = true;
  state.stats = {
    health: 70,
    happiness: 65,
    intelligence: 60,
    connections: 50,
    merit: 20,
    appearance: 55
  };
  state.finance.cash = 25000;
  state.finance.piggyBank = 500;
  state.finance.investments = {};
  state.finance.ownedAssets = [];
  state.finance.activeLoans = [];
  state.finance.installments = [];
  state.relationships.npcs = [];
  state.relationships.children = [];
  state.relationships.partner = null;
  state.turn.phase = 'FREE_ACTION';
  state.turn.areTabsLocked = false;
  state.turn.pendingEvents = [];
  state.turn.lifeFeedLog = [];
  return state;
}

test('lobby screen renders its primary entry points and binds the rebirth navigation action', () => {
  const goReborn = new FakeButton();
  let navigated = 0;
  const view = renderLobbyScreen({
    onGoReborn: () => navigated++,
    onContinueGame() {},
    onRefreshLobby() {}
  });

  assert.match(view.html, /TPIW/);
  assert.match(view.html, /btn-lobby-new-reborn/);
  assert.match(view.html, /btn-lobby-achievements/);

  view.bind(new FakeScreenRoot({
    '#btn-lobby-new-reborn': goReborn
  }));
  goReborn.click();

  assert.equal(navigated, 1);
});

test('rebirth screen mounts its setup UI and binds the return-to-lobby action', () => {
  const backButton = new FakeButton();
  const root = new FakeScreenRoot({
    '#btn-reborn-back': backButton
  });
  let returned = 0;

  const view = renderRebornScreen({
    onBackToLobby: () => returned++,
    onStartLife() {}
  });
  view.mount(root);

  assert.match(root.innerHTML, /เตรียมตัวจุติใหม่/);
  assert.match(root.innerHTML, /btn-confirm-reborn/);
  assert.match(root.innerHTML, /ข้อมูลตัวละคร/);

  backButton.click();
  assert.equal(returned, 1);
});

test('all five gameplay tab renderers return usable views and accept event-binding roots', () => {
  const state = createScreenState();
  const emptyRoot = new FakeScreenRoot();
  const renderers = [
    ['life feed', () => renderTab1LifeFeed(state, { onRefresh() {} })],
    ['work and study', () => renderTab2WorkStudy(state, { onRefresh() {} })],
    ['relationships', () => renderTab3Relationships(state, { onRefresh() {} })],
    ['assets and debt', () => renderTab4AssetsDebt(state, { onRefresh() {} })],
    ['lifestyle and shop', () => renderTab5LifestyleShop(state, { onRefresh() {} })]
  ];

  for (const [name, render] of renderers) {
    const view = render();
    assert.equal(typeof view.html, 'string', `${name} should return HTML`);
    assert.ok(view.html.length > 0, `${name} should not render an empty screen`);
    assert.equal(typeof view.bind, 'function', `${name} should expose its binding hook`);
    assert.doesNotThrow(() => view.bind(emptyRoot), `${name} should bind against an empty screen root`);
  }
});

test('ending screen renders a completed-life summary and binds the return-to-lobby action', () => {
  const state = createScreenState(100);
  state.profile.isAlive = false;
  state.turn.phase = 'ENDED';
  state.turn.endingFinalized = false;
  state.turn.finalEndingReport = null;
  const returnButton = new FakeButton();
  let returned = 0;

  const view = renderEndingScreen(state, {
    onContinueAsChild() {},
    onReturnToLobby: () => returned++
  });

  assert.match(view.html, /บันทึกชีวิตบทอวสาน/);
  assert.match(view.html, /ฉากจบระดับ/);
  assert.match(view.html, /กลับสู่วังวนจุติใหม่/);

  view.bind(new FakeScreenRoot({
    '#btn-end-to-lobby': returnButton
  }));
  returnButton.click();

  assert.equal(returned, 1);
});

test('annual slip breakdown renderer labels and formats category totals', () => {
  const html = renderAnnualBreakdownRows({ employment: 120000, investment: 2500, other: 0 }, { employment: 'เงินเดือนและงานเสริม', investment: 'ดอกเบี้ยและเงินปันผล', other: 'รายรับอื่น' }, 'amt-pos');
  assert.match(html, /เงินเดือนและงานเสริม/);
  assert.match(html, /ดอกเบี้ยและเงินปันผล/);
  assert.doesNotMatch(html, /รายรับอื่น/);
  assert.match(html, /amt-pos/);
  assert.match(html, /120,000/);
});
