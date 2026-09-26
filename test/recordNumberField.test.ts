import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectRecordNumber,
  recordNumberSortKey,
  withRecordNumber,
} from "../src/recordNumberField.js";

test("missing record number", () => {
  assert.deepEqual(inspectRecordNumber("DOI: 10.1000/example"), {
    status: "missing",
    value: null,
    occurrences: 0,
  });
});

test("valid record number is read case-insensitively", () => {
  assert.deepEqual(inspectRecordNumber("record number: 31"), {
    status: "valid",
    value: 31,
    occurrences: 1,
  });
});

test("zero, non-numeric and duplicate lines are malformed", () => {
  assert.equal(inspectRecordNumber("Record Number: 0").status, "malformed");
  assert.equal(
    inspectRecordNumber("Record Number: abc").status,
    "malformed",
  );
  assert.equal(
    inspectRecordNumber("Record Number: 1\nRecord Number: 2").status,
    "malformed",
  );
});

test("writing a number preserves unrelated Extra content", () => {
  assert.equal(
    withRecordNumber("DOI: 10.1000/example\nPMID: 123", 42),
    "DOI: 10.1000/example\nPMID: 123\nRecord Number: 42",
  );
});

test("writing replaces an existing or malformed line", () => {
  assert.equal(
    withRecordNumber("Record Number: abc\nNote for myself", 7),
    "Note for myself\nRecord Number: 7",
  );
});

test("sort keys preserve numeric order", () => {
  const values = [100, 2, 11, 1];
  assert.deepEqual(
    values.sort((a, b) =>
      recordNumberSortKey(a).localeCompare(recordNumberSortKey(b)),
    ),
    [1, 2, 11, 100],
  );
});
