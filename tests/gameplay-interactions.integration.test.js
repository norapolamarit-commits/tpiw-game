import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createEmptyGameState } from '../js/core/state.js';
import { renderTab2WorkStudy } from '../js/ui/tab2_work_study.js';
import { renderTab3Relationships } from '../js/ui/tab3_relationships.js';
import { renderTab4AssetsDebt } from '../js/ui/tab4_assets_debt.js';
import { renderTab5LifestyleShop } from '../js/ui/tab5_lifestyle_shop.js';

const originalLocalStorage = globalThis.localStorage;
const originalDocument = globalThis.document;
const originalDbRaw = db.raw;
const originalDbIsLoaded = db.isLoaded;
const originalIndexEntries = Object.fromEntries(
  Object.entries(db.indexes).map(([key, map]) => [key, new Map(map)])
);
const storage = new Map();
let runCounter = 0;

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

// UI notifications are outside the interaction contract under test.
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

  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;

  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

class FakeButton {
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
  constructor({ selectors = {}, lists = {} } = {}) {
    this.selectors = selectors;
    this.lists = lists;
  }

  querySelector(selector) {
    return this.selectors[selector] || null;
  }

  querySelectorAll(selector) {
    return this.lists[selector] || [];
  }
}

function createInteractionState(age = 25) {
  const state = createEmptyGameState();
  state.meta.runId = `phase-4m-${age}-${++runCounter}`;
  state.profile.name = 'ผู้เล่นทดสอบ';
  state.profile.firstName = 'ผู้เล่น';
  state.profile.lastName = 'ทดสอบ';
  state.profile.nickname = 'ทดสอบ';
  state.profile.titlePrefix = 'นาย';
  state.profile.gender = 'male';
  state.profile.age = age;
  state.profile.currentYearBE = 2569;
  state.profile.birthYearBE = 2569 - age;
  state.profile.lifePhaseId = age < 18 ? 'phase_3_teen' : 'phase_4_young_adult';
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
  state.finance.cash = 25_000;
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
  state.turn.freeActionPoints = 3;
  state.turn.maxFreeActionPoints = 3;
  state.turn.pendingEvents = [];
  state.turn.lifeFeedLog = [];
  return state;
}

test('work and study activity button applies the selected annual activity through its UI handler', () => {
  const state = createInteractionState(16);
  let refreshCalls = 0;
  const view = renderTab2WorkStudy(state, {
    onRefresh: () => refreshCalls++
  });

  assert.match(view.html, /data-select-activity="act_school_study_hard"/);

  const selectButton = new FakeButton({
    'data-select-activity': 'act_school_study_hard'
  });
  view.bind(new FakeContainer({
    lists: { '[data-select-activity]': [selectButton] }
  }));
  selectButton.click();

  assert.equal(state.careerAndEdu.currentActivityId, 'act_school_study_hard');
  assert.ok(state.talentTags.includes('tag_bookworm'));
  assert.equal(refreshCalls, 1);
  assert.ok(storage.size > 0, 'the UI action should persist the updated game state');
});

test('relationships action button applies the parent interaction and refreshes the view', () => {
  const state = createInteractionState(25);
  state.relationships.npcs.push({
    id: 'father_ui_test',
    archetypeId: 'npc_arch_father',
    name: 'คุณพ่อทดสอบ',
    shortName: 'พ่อ',
    roleTitle: 'คุณพ่อ',
    relationship: 70,
    isAlive: true
  });
  let refreshCalls = 0;
  const view = renderTab3Relationships(state, {
    onRefresh: () => refreshCalls++
  });

  assert.match(view.html, /data-rel-action="rel_act_talk_parents"/);
  const actionButton = new FakeButton({
    'data-rel-action': 'rel_act_talk_parents',
    'data-rel-target': ''
  });
  view.bind(new FakeContainer({
    lists: { '[data-rel-action]': [actionButton] }
  }));
  actionButton.click();

  assert.equal(state.relationships.npcs[0].relationship, 75);
  assert.equal(state.turn.freeActionPoints, 2);
  assert.equal(refreshCalls, 1);
  assert.ok(storage.size > 0, 'the relationship action should persist the updated game state');
});

test('shop purchase button buys the selected item and updates cash, ownership flags, and UI refresh', () => {
  const state = createInteractionState(25);
  let refreshCalls = 0;
  const view = renderTab5LifestyleShop(state, {
    onRefresh: () => refreshCalls++
  });

  assert.match(view.html, /data-buy-item="item_budget_smartphone"/);
  const buyButton = new FakeButton({
    'data-buy-item': 'item_budget_smartphone',
    'data-pay-mode': 'cash'
  });
  view.bind(new FakeContainer({
    lists: { '[data-buy-item]': [buyButton] }
  }));
  buyButton.click();

  assert.equal(state.finance.cash, 20_500);
  assert.ok(state.flags.includes('flag_smartphone'));
  assert.ok(state.finance.purchasedOneTimeItems.includes('item_budget_smartphone'));
  assert.equal(refreshCalls, 1);
  assert.ok(storage.size > 0, 'the shop purchase should persist the updated game state');
});

test('shop relocation tab routes a destination click into the relocation engine action', () => {
  const state = createInteractionState(25);
  let refreshCalls = 0;

  const firstView = renderTab5LifestyleShop(state, {
    onRefresh: () => refreshCalls++
  });
  const relocateTab = new FakeButton({ 'data-shop-subtab': 'relocate' });
  firstView.bind(new FakeContainer({
    lists: { '[data-shop-subtab]': [relocateTab] }
  }));
  relocateTab.click();
  assert.equal(refreshCalls, 1);

  const relocationView = renderTab5LifestyleShop(state, {
    onRefresh: () => refreshCalls++
  });
  assert.match(relocationView.html, /data-relocate-id="loc_nonthaburi"/);

  const destinationButton = new FakeButton({
    'data-relocate-id': 'loc_nonthaburi'
  });
  relocationView.bind(new FakeContainer({
    lists: { '[data-relocate-id]': [destinationButton] }
  }));
  destinationButton.click();

  assert.equal(state.profile.currentLocationId, 'loc_nonthaburi');
  assert.equal(state.finance.cash, 21_000);
  assert.equal(refreshCalls, 2);
  assert.ok(storage.size > 0, 'the relocation should persist the updated game state');
});

test('assets and debt subtab button switches to owned assets and requests a refresh', () => {
  const state = createInteractionState(25);
  let refreshCalls = 0;
  const view = renderTab4AssetsDebt(state, {
    onRefresh: () => refreshCalls++
  });
  const ownedTab = new FakeButton({
    'data-asset-subtab': 'owned'
  });

  view.bind(new FakeContainer({
    lists: { '[data-asset-subtab]': [ownedTab] }
  }));
  ownedTab.click();

  assert.equal(refreshCalls, 1);
  const ownedView = renderTab4AssetsDebt(state, {
    onRefresh: () => refreshCalls++
  });
  assert.match(ownedView.html, /data-asset-subtab="owned"/);
  assert.match(ownedView.html, /class="subtab-pill is-active" data-asset-subtab="owned"/);
});
