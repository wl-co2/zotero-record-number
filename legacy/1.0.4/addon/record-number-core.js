(function (root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.RecordNumberCore = api;
  }
})(this, function () {
  "use strict";

  var FIELD_PATTERN = /^\s*Record Number\s*:\s*(.*?)\s*$/i;

  function parseRecordNumber(extra) {
    var lines = String(extra || "").split(/\r?\n/);
    var values = [];

    for (var i = 0; i < lines.length; i += 1) {
      var match = FIELD_PATTERN.exec(lines[i]);
      if (match) {
        values.push(match[1]);
      }
    }

    if (values.length === 0) {
      return { status: "missing" };
    }

    if (values.length !== 1 || !/^\d+$/.test(values[0])) {
      return { status: "invalid", values: values };
    }

    var value = Number(values[0]);
    if (!Number.isSafeInteger(value) || value < 1) {
      return { status: "invalid", values: values };
    }

    return { status: "valid", value: value };
  }

  function appendRecordNumber(extra, value) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("Record Number must be a positive safe integer");
    }

    var state = parseRecordNumber(extra);
    if (state.status !== "missing") {
      throw new Error("Record Number field already exists");
    }

    var text = String(extra || "");
    if (!text) {
      return "Record Number: " + value;
    }

    var newline = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
    var separator = /\r?\n$/.test(text) ? "" : newline;
    return text + separator + "Record Number: " + value;
  }

  function analyzeRecords(records) {
    var missing = [];
    var invalid = [];
    var numbered = [];
    var byNumber = new Map();
    var max = 0;

    for (var i = 0; i < records.length; i += 1) {
      var record = records[i];
      var state = parseRecordNumber(record.extra);
      var entry = {
        id: record.id,
        title: record.title || "",
        state: state,
      };

      if (state.status === "missing") {
        missing.push(entry);
      } else if (state.status === "invalid") {
        invalid.push(entry);
      } else {
        numbered.push(entry);
        max = Math.max(max, state.value);
        if (!byNumber.has(state.value)) {
          byNumber.set(state.value, []);
        }
        byNumber.get(state.value).push(entry);
      }
    }

    var duplicates = [];
    byNumber.forEach(function (entries, value) {
      if (entries.length > 1) {
        duplicates.push({ value: value, entries: entries });
      }
    });
    duplicates.sort(function (a, b) {
      return a.value - b.value;
    });

    return {
      total: records.length,
      numbered: numbered,
      missing: missing,
      invalid: invalid,
      duplicates: duplicates,
      max: max,
    };
  }

  return {
    parseRecordNumber: parseRecordNumber,
    appendRecordNumber: appendRecordNumber,
    analyzeRecords: analyzeRecords,
  };
});
