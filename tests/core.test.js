"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../addon/record-number-core.js");

const coreSource = fs.readFileSync(
  path.resolve(__dirname, "../addon/record-number-core.js"),
  "utf8",
);
const targetScope = {};
vm.runInNewContext(`(function () {\n${coreSource}\n}).call(targetScope);`, {
  targetScope,
});
assert.equal(typeof targetScope.RecordNumberCore?.analyzeRecords, "function");

assert.deepEqual(core.parseRecordNumber(""), { status: "missing" });
assert.deepEqual(core.parseRecordNumber("DOI: 10.1000/test"), {
  status: "missing",
});
assert.deepEqual(core.parseRecordNumber("Record Number: 31"), {
  status: "valid",
  value: 31,
});
assert.deepEqual(core.parseRecordNumber("  record number : 0007  "), {
  status: "valid",
  value: 7,
});
assert.equal(core.parseRecordNumber("Record Number: 0").status, "invalid");
assert.equal(core.parseRecordNumber("Record Number: -1").status, "invalid");
assert.equal(core.parseRecordNumber("Record Number: 1.5").status, "invalid");
assert.equal(
  core.parseRecordNumber("Record Number: 1\nRecord Number: 2").status,
  "invalid",
);

assert.equal(core.appendRecordNumber("", 4), "Record Number: 4");
assert.equal(
  core.appendRecordNumber("DOI: 10.1000/test", 4),
  "DOI: 10.1000/test\nRecord Number: 4",
);
assert.equal(
  core.appendRecordNumber("DOI: 10.1000/test\r\n", 4),
  "DOI: 10.1000/test\r\nRecord Number: 4",
);
assert.throws(
  () => core.appendRecordNumber("Record Number: 2", 4),
  /already exists/,
);

const report = core.analyzeRecords([
  { id: 1, title: "A", extra: "Record Number: 3" },
  { id: 2, title: "B", extra: "Record Number: 3" },
  { id: 3, title: "C", extra: "" },
  { id: 4, title: "D", extra: "Record Number: no" },
  { id: 5, title: "E", extra: "Record Number: 9" },
]);

assert.equal(report.total, 5);
assert.equal(report.numbered.length, 3);
assert.equal(report.missing.length, 1);
assert.equal(report.invalid.length, 1);
assert.equal(report.duplicates.length, 1);
assert.equal(report.duplicates[0].value, 3);
assert.equal(report.max, 9);

console.log("All Record Number core tests passed.");
