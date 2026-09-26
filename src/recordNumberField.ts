export const RECORD_NUMBER_LABEL = "Record Number";

export type RecordNumberInspection =
  | { status: "missing"; value: null; occurrences: 0 }
  | { status: "valid"; value: number; occurrences: 1 }
  | { status: "malformed"; value: null; occurrences: number };

const recordNumberLine = /^\s*Record Number\s*:\s*(.*?)\s*$/i;

export function inspectRecordNumber(extra: string): RecordNumberInspection {
  const values: string[] = [];
  for (const line of splitLines(extra)) {
    const match = line.match(recordNumberLine);
    if (match) values.push(match[1]);
  }

  if (values.length === 0) {
    return { status: "missing", value: null, occurrences: 0 };
  }

  if (values.length !== 1 || !/^\d+$/.test(values[0])) {
    return {
      status: "malformed",
      value: null,
      occurrences: values.length,
    };
  }

  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value < 1) {
    return { status: "malformed", value: null, occurrences: 1 };
  }

  return { status: "valid", value, occurrences: 1 };
}

export function withRecordNumber(extra: string, value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("Record Number must be a positive safe integer");
  }

  const newline = extra.includes("\r\n") ? "\r\n" : "\n";
  const keptLines = splitLines(extra).filter(
    (line) => !recordNumberLine.test(line),
  );

  while (keptLines.length && keptLines[keptLines.length - 1] === "") {
    keptLines.pop();
  }
  keptLines.push(`${RECORD_NUMBER_LABEL}: ${value}`);
  return keptLines.join(newline);
}

export function recordNumberSortKey(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) return "";
  return String(value).padStart(16, "0");
}

function splitLines(value: string): string[] {
  return value === "" ? [] : value.split(/\r?\n/);
}
