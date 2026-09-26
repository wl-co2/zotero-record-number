/* global Zotero, Services, APP_SHUTDOWN */

var PLUGIN_ID = "zotero-record-number@wl-co2.github.io";
var PREF_AUTO_ENABLED = "record-number.autoEnabled";
var PREF_HIGH_WATER = "record-number.highWater";
var MENU_ID = "zotero-record-number-menu";
var MENU_SEPARATOR_ID = "zotero-record-number-separator";
var AUTO_MENU_ID = "zotero-record-number-auto";

var RecordNumberCore;
var registeredColumnKey = null;
var notifierID = null;
var operationQueue = Promise.resolve();
var stopping = false;

function install() {}

async function startup({ rootURI, resourceURI }) {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  var coreScope = {};
  Services.scriptloader.loadSubScript(
    rootURI + "record-number-core.js",
    coreScope,
  );
  RecordNumberCore = coreScope.RecordNumberCore;
  if (!RecordNumberCore) {
    throw new Error("Record Number core failed to load");
  }

  registeredColumnKey = await Zotero.ItemTreeManager.registerColumn({
    dataKey: "recordNumber",
    label: "Record Number",
    pluginID: PLUGIN_ID,
    enabledTreeIDs: ["main"],
    showInColumnPicker: true,
    width: "92",
    zoteroPersist: ["width", "hidden", "sortDirection"],
    dataProvider: function (item) {
      return getItemRecordNumber(item);
    },
  });

  notifierID = Zotero.Notifier.registerObserver(
    { notify: onNotify },
    ["item"],
    "zotero-record-number",
  );

  var windows = Zotero.getMainWindows();
  for (var i = 0; i < windows.length; i += 1) {
    addMenu(windows[i]);
  }

  await synchronizeHighWaterMark();
  if (isAutomaticNumberingEnabled()) {
    enqueueOperation(function () {
      return assignNumbers();
    });
  }
}

function shutdown(data, reason) {
  stopping = true;

  if (reason === APP_SHUTDOWN) {
    return;
  }

  if (notifierID) {
    Zotero.Notifier.unregisterObserver(notifierID);
    notifierID = null;
  }

  if (registeredColumnKey) {
    Zotero.ItemTreeManager.unregisterColumn(registeredColumnKey);
    registeredColumnKey = null;
  }

  var windows = Zotero.getMainWindows();
  for (var i = 0; i < windows.length; i += 1) {
    removeMenu(windows[i]);
  }
}

function uninstall() {}

function onMainWindowLoad({ window }) {
  addMenu(window);
}

function onMainWindowUnload({ window }) {
  removeMenu(window);
}

function getItemRecordNumber(item) {
  try {
    if (
      !item ||
      !item.isRegularItem() ||
      item.libraryID !== Zotero.Libraries.userLibraryID
    ) {
      return "";
    }

    var state = RecordNumberCore.parseRecordNumber(item.getField("extra"));
    return state.status === "valid" ? String(state.value) : "";
  } catch (error) {
    Zotero.logError(error);
    return "";
  }
}

async function onNotify(event, type, ids) {
  if (
    stopping ||
    event !== "add" ||
    type !== "item" ||
    !isAutomaticNumberingEnabled()
  ) {
    return;
  }

  var numericIDs = ids
    .map(function (id) {
      return Number(id);
    })
    .filter(Number.isSafeInteger);

  await enqueueOperation(function () {
    return assignNumbers(numericIDs);
  });
}

function enqueueOperation(operation) {
  var result = operationQueue.then(operation, operation);
  operationQueue = result.catch(function (error) {
    Zotero.logError(error);
  });
  return result;
}

async function getUserLibraryItems() {
  var items = await Zotero.Items.getAll(
    Zotero.Libraries.userLibraryID,
    true,
    false,
  );
  return items.filter(function (item) {
    return item.isRegularItem() && !item.deleted;
  });
}

function toAnalysisRecords(items) {
  return items.map(function (item) {
    return {
      id: item.id,
      title: item.getField("title") || "Untitled item " + item.id,
      extra: item.getField("extra") || "",
    };
  });
}

async function synchronizeHighWaterMark() {
  var items = await getUserLibraryItems();
  var analysis = RecordNumberCore.analyzeRecords(toAnalysisRecords(items));
  var highWater = Math.max(getHighWaterMark(), analysis.max);
  setHighWaterMark(highWater);
  return { items: items, analysis: analysis, highWater: highWater };
}

async function assignNumbers(onlyIDs, onProgress) {
  var scan = await synchronizeHighWaterMark();
  var allowedIDs = onlyIDs ? new Set(onlyIDs) : null;
  var candidates = scan.items.filter(function (item) {
    if (allowedIDs && !allowedIDs.has(item.id)) {
      return false;
    }
    return (
      RecordNumberCore.parseRecordNumber(item.getField("extra")).status ===
      "missing"
    );
  });

  candidates.sort(function (a, b) {
    var dateComparison = String(a.dateAdded || "").localeCompare(
      String(b.dateAdded || ""),
    );
    return dateComparison || a.id - b.id;
  });

  var highWater = scan.highWater;
  var assigned = [];
  var failed = [];

  reportAssignmentProgress(onProgress, 0, candidates.length);

  for (var i = 0; i < candidates.length; i += 1) {
    var item = candidates[i];
    try {
      var currentExtra = item.getField("extra") || "";
      if (
        RecordNumberCore.parseRecordNumber(currentExtra).status !== "missing"
      ) {
        continue;
      }

      if (highWater >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Record Number limit reached");
      }

      highWater += 1;
      setHighWaterMark(highWater);
      item.setField(
        "extra",
        RecordNumberCore.appendRecordNumber(currentExtra, highWater),
      );
      await item.saveTx({ skipDateModifiedUpdate: true });
      assigned.push({ id: item.id, value: highWater });
    } catch (error) {
      failed.push({ id: item.id, error: String(error) });
      Zotero.logError(error);
    } finally {
      reportAssignmentProgress(onProgress, i + 1, candidates.length);
    }
  }

  refreshItemTrees();
  return { assigned: assigned, failed: failed };
}

function reportAssignmentProgress(onProgress, processed, total) {
  if (typeof onProgress !== "function") {
    return;
  }

  try {
    onProgress({ processed: processed, total: total });
  } catch (error) {
    Zotero.logError(error);
  }
}

function createAssignmentProgress(window) {
  var progressWindow = new Zotero.ProgressWindow({
    window: window,
    closeOnClick: false,
  });
  progressWindow.changeHeadline("正在分配 Record Number");
  var progressItem = new progressWindow.ItemProgress(
    null,
    "正在扫描“我的文库”…",
  );
  progressItem.setItemTypeAndIcon(null, "unfiled");
  progressWindow.show();

  return {
    update: function (state) {
      var percent = state.total
        ? Math.round((state.processed / state.total) * 100)
        : 100;
      progressItem.setProgress(percent);
      progressItem.setText(
        state.total
          ? "已处理 " +
              state.processed +
              " / " +
              state.total +
              "（" +
              percent +
              "%）"
          : "没有缺失编号的条目",
      );
    },
    close: function () {
      progressWindow.close();
    },
  };
}

function getHighWaterMark() {
  var value = Number(Zotero.Prefs.get(PREF_HIGH_WATER));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function setHighWaterMark(value) {
  Zotero.Prefs.set(PREF_HIGH_WATER, String(value));
}

function isAutomaticNumberingEnabled() {
  return Zotero.Prefs.get(PREF_AUTO_ENABLED) === true;
}

function setAutomaticNumberingEnabled(enabled) {
  Zotero.Prefs.set(PREF_AUTO_ENABLED, enabled);
  updateAutomaticMenuChecks();
}

function refreshItemTrees() {
  try {
    Zotero.ItemTreeManager.refreshColumns();
  } catch (error) {
    Zotero.logError(error);
  }

  var windows = Zotero.getMainWindows();
  for (var i = 0; i < windows.length; i += 1) {
    var view = windows[i].ZoteroPane && windows[i].ZoteroPane.itemsView;
    if (view && typeof view.refresh === "function") {
      view.refresh();
    }
  }
}

function createXULElement(document, name) {
  return document.createXULElement
    ? document.createXULElement(name)
    : document.createElement(name);
}

function addMenu(window) {
  var document = window.document;
  if (document.getElementById(MENU_ID)) {
    return;
  }

  var toolsPopup = document.getElementById("menu_ToolsPopup");
  if (!toolsPopup) {
    Zotero.debug("Zotero Record Number: Tools menu was not found");
    return;
  }

  var separator = createXULElement(document, "menuseparator");
  separator.id = MENU_SEPARATOR_ID;

  var menu = createXULElement(document, "menu");
  menu.id = MENU_ID;
  menu.setAttribute("label", "Record Number 编号");

  var popup = createXULElement(document, "menupopup");

  var autoItem = createXULElement(document, "menuitem");
  autoItem.id = AUTO_MENU_ID;
  autoItem.setAttribute("type", "checkbox");
  autoItem.setAttribute("label", "在本机自动发号（仅主电脑启用）");
  autoItem.addEventListener("command", function () {
    toggleAutomaticNumbering(window).catch(function (error) {
      showError(window, error);
    });
  });

  var assignItem = createXULElement(document, "menuitem");
  assignItem.setAttribute("label", "为缺失条目分配编号…");
  assignItem.addEventListener("command", function () {
    assignMissingFromMenu(window).catch(function (error) {
      showError(window, error);
    });
  });

  var checkItem = createXULElement(document, "menuitem");
  checkItem.setAttribute("label", "检查编号…");
  checkItem.addEventListener("command", function () {
    checkNumbersFromMenu(window).catch(function (error) {
      showError(window, error);
    });
  });

  popup.appendChild(autoItem);
  popup.appendChild(assignItem);
  popup.appendChild(checkItem);
  menu.appendChild(popup);
  toolsPopup.appendChild(separator);
  toolsPopup.appendChild(menu);
  updateAutomaticMenuChecks();
}

function removeMenu(window) {
  var document = window.document;
  var menu = document.getElementById(MENU_ID);
  var separator = document.getElementById(MENU_SEPARATOR_ID);
  if (menu) {
    menu.remove();
  }
  if (separator) {
    separator.remove();
  }
}

function updateAutomaticMenuChecks() {
  var checked = isAutomaticNumberingEnabled() ? "true" : "false";
  var windows = Zotero.getMainWindows();
  for (var i = 0; i < windows.length; i += 1) {
    var item = windows[i].document.getElementById(AUTO_MENU_ID);
    if (item) {
      item.setAttribute("checked", checked);
    }
  }
}

async function toggleAutomaticNumbering(window) {
  if (isAutomaticNumberingEnabled()) {
    setAutomaticNumberingEnabled(false);
    return;
  }

  var confirmed = window.confirm(
    "只能在一台主电脑上启用自动发号。\n\n" +
      "启用后，插件会为“我的文库”中尚无 Record Number 的普通文献分配编号，并将编号写入 Extra。是否继续？",
  );
  if (!confirmed) {
    updateAutomaticMenuChecks();
    return;
  }

  setAutomaticNumberingEnabled(true);
  var progress = createAssignmentProgress(window);
  var result;
  try {
    result = await enqueueOperation(function () {
      return assignNumbers(null, progress.update);
    });
  } finally {
    progress.close();
  }
  window.alert(formatAssignmentResult(result));
}

async function assignMissingFromMenu(window) {
  var confirmed = window.confirm(
    "将为“我的文库”中缺失编号的普通文献分配新号码。\n" +
      "已有编号不会修改，删除留下的空号不会补用。是否继续？",
  );
  if (!confirmed) {
    return;
  }

  var progress = createAssignmentProgress(window);
  var result;
  try {
    result = await enqueueOperation(function () {
      return assignNumbers(null, progress.update);
    });
  } finally {
    progress.close();
  }
  window.alert(formatAssignmentResult(result));
}

async function checkNumbersFromMenu(window) {
  var scan = await synchronizeHighWaterMark();
  window.alert(formatCheckReport(scan.analysis, scan.highWater));
}

function formatAssignmentResult(result) {
  return (
    "Record Number 处理完成。\n\n" +
    "新分配：" +
    result.assigned.length +
    "\n失败：" +
    result.failed.length +
    (result.failed.length
      ? "\n\n失败条目 ID：" +
        result.failed
          .slice(0, 20)
          .map(function (entry) {
            return entry.id;
          })
          .join(", ")
      : "")
  );
}

function formatCheckReport(analysis, highWater) {
  var lines = [
    "Record Number 检查结果",
    "",
    "普通文献总数：" + analysis.total,
    "有效编号：" + analysis.numbered.length,
    "缺失编号：" + analysis.missing.length,
    "无效编号行：" + analysis.invalid.length,
    "重复号码：" + analysis.duplicates.length,
    "当前最大有效编号：" + analysis.max,
    "本机发号上限：" + highWater,
    "",
    "删除造成的空号属于正常情况，不会被补用。",
  ];

  if (analysis.duplicates.length) {
    lines.push("", "重复详情（最多 10 组）：");
    analysis.duplicates.slice(0, 10).forEach(function (duplicate) {
      lines.push(
        duplicate.value +
          "：" +
          duplicate.entries
            .map(function (entry) {
              return entry.title + " [" + entry.id + "]";
            })
            .join("；"),
      );
    });
  }

  if (analysis.invalid.length) {
    lines.push("", "无效编号条目（最多 10 条）：");
    analysis.invalid.slice(0, 10).forEach(function (entry) {
      lines.push(entry.title + " [" + entry.id + "]");
    });
  }

  return lines.join("\n");
}

function showError(window, error) {
  Zotero.logError(error);
  window.alert("Record Number 操作失败：\n" + String(error));
  updateAutomaticMenuChecks();
}
