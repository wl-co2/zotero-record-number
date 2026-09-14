"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceRoot = path.resolve(__dirname, "..");
const addonRoot = path.join(sourceRoot, "addon");
const prefs = new Map([
  ["record-number.autoEnabled", false],
  ["record-number.highWater", "10"],
]);
const loggedErrors = [];
let registeredColumn;
let registeredObserver;
let progressState;

function makeItem(id, extra, options = {}) {
  const fields = {
    title: options.title || `Item ${id}`,
    extra: extra || "",
  };
  return {
    id,
    libraryID: options.libraryID || 1,
    dateAdded: options.dateAdded || `2026-01-${String(id).padStart(2, "0")}`,
    deleted: false,
    isRegularItem: () => options.regular !== false,
    getField: (name) => fields[name] || "",
    setField: (name, value) => {
      fields[name] = String(value);
    },
    saveTx: async () => true,
    fields,
  };
}

const item1 = makeItem(1, "Record Number: 5");
const item2 = makeItem(2, "DOI: 10.1000/test");
const item3 = makeItem(3, "Record Number: invalid");
const attachment = makeItem(4, "", { regular: false });
let items = [item1, item2, item3, attachment];

const context = vm.createContext({
  console,
  APP_SHUTDOWN: 1,
  Zotero: {
    initializationPromise: Promise.resolve(),
    unlockPromise: Promise.resolve(),
    uiReadyPromise: Promise.resolve(),
    Libraries: { userLibraryID: 1 },
    Items: { getAll: async () => items },
    ItemTreeManager: {
      registerColumn: async (column) => {
        registeredColumn = column;
        return "zotero-record-number@wl-co2.github.io-recordNumber";
      },
      unregisterColumn: () => true,
      refreshColumns: () => {},
    },
    Notifier: {
      registerObserver: (observer) => {
        registeredObserver = observer;
        return "observer-id";
      },
      unregisterObserver: () => {},
    },
    Prefs: {
      get: (name) => prefs.get(name),
      set: (name, value) => prefs.set(name, value),
    },
    ProgressWindow: function (options) {
      progressState = { options, shown: false, closed: false };
      this.changeHeadline = (text) => {
        progressState.headline = text;
      };
      this.ItemProgress = function (itemType, text) {
        progressState.itemType = itemType;
        progressState.text = text;
        this.setItemTypeAndIcon = (_type, icon) => {
          progressState.icon = icon;
        };
        this.setProgress = (percent) => {
          progressState.percent = percent;
        };
        this.setText = (textValue) => {
          progressState.text = textValue;
        };
      };
      this.show = () => {
        progressState.shown = true;
      };
      this.close = () => {
        progressState.closed = true;
      };
    },
    getMainWindows: () => [],
    logError: (error) => loggedErrors.push(error),
    debug: () => {},
  },
  Services: {
    scriptloader: {
      loadSubScript: (_uri, scope) => {
        const coreContext = vm.createContext(scope);
        vm.runInContext(
          fs.readFileSync(path.join(addonRoot, "record-number-core.js"), "utf8"),
          coreContext,
        );
      },
    },
  },
});

vm.runInContext(
  fs.readFileSync(path.join(addonRoot, "bootstrap.js"), "utf8"),
  context,
);

(async () => {
  await context.startup({ rootURI: "file:///mock/" });
  assert.equal(registeredColumn.label, "Record Number");
  assert.equal(registeredColumn.dataProvider(item1), "5");
  assert.equal(
    registeredColumn.dataProvider(makeItem(20, "Record Number: 20", { libraryID: 2 })),
    "",
  );
  assert.ok(registeredObserver);

  const progressEvents = [];
  let result = await context.assignNumbers(null, (state) => {
    progressEvents.push({ processed: state.processed, total: state.total });
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.assigned)),
    [{ id: 2, value: 11 }],
  );
  assert.deepEqual(progressEvents, [
    { processed: 0, total: 1 },
    { processed: 1, total: 1 },
  ]);
  assert.match(item2.fields.extra, /Record Number: 11$/);
  assert.equal(item3.fields.extra, "Record Number: invalid");
  assert.equal(prefs.get("record-number.highWater"), "11");

  const item5 = makeItem(5, "");
  items.push(item5);
  result = await context.assignNumbers([5]);
  assert.equal(result.assigned[0].value, 12);

  items = items.filter((item) => item.id !== 5);
  const item6 = makeItem(6, "");
  items.push(item6);
  result = await context.assignNumbers([6]);
  assert.equal(result.assigned[0].value, 13);
  assert.equal(prefs.get("record-number.highWater"), "13");

  const progress = context.createAssignmentProgress({ name: "main-window" });
  progress.update({ processed: 2, total: 4 });
  assert.equal(progressState.options.closeOnClick, false);
  assert.equal(progressState.shown, true);
  assert.equal(progressState.headline, "正在分配 Record Number");
  assert.equal(progressState.icon, "unfiled");
  assert.equal(progressState.percent, 50);
  assert.equal(progressState.text, "已处理 2 / 4（50%）");
  progress.close();
  assert.equal(progressState.closed, true);
  assert.equal(loggedErrors.length, 0);

  console.log("All Record Number bootstrap tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
