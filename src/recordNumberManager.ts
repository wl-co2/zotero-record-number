import { config } from "../package.json";
import {
  inspectRecordNumber,
  recordNumberSortKey,
  smallestAvailableRecordNumber,
  withRecordNumber,
} from "./recordNumberField";

const AUTO_ASSIGN_PREF = `${config.prefsPrefix}.autoAssign`;
const SAVE_BATCH_SIZE = 250;

export interface DuplicateRecordNumber {
  number: number;
  items: Zotero.Item[];
}

export interface ValidationReport {
  total: number;
  numbered: number;
  missing: Zotero.Item[];
  malformed: Zotero.Item[];
  duplicates: DuplicateRecordNumber[];
  maximum: number;
}

export interface InitializationPreview {
  report: ValidationReport;
  nextNumber: number;
}

export interface AssignmentResult {
  assigned: number;
  firstNumber: number | null;
  lastNumber: number | null;
}

export interface RenumberPreview {
  total: number;
  changed: number;
  trashCount: number;
}

export interface RenumberResult {
  total: number;
  changed: number;
}

export class RecordNumberManager {
  private observerID?: string;
  private registeredColumnKey?: string;
  private workQueue: Promise<unknown> = Promise.resolve();

  async start(): Promise<void> {
    this.registerColumn();
    this.observerID = Zotero.Notifier.registerObserver(
      {
        notify: async (event, type, ids) => {
          if (event !== "add" || type !== "item") return;
          if (!this.isAutoAssignEnabled()) return;

          try {
            await this.enqueue(() => this.assignNewItems(ids));
          } catch (error) {
            Zotero.logError(error as Error);
          }
        },
      },
      ["item"],
      config.addonRef,
    );
  }

  stop(): void {
    if (this.observerID) {
      Zotero.Notifier.unregisterObserver(this.observerID);
      this.observerID = undefined;
    }
    if (this.registeredColumnKey) {
      Zotero.ItemTreeManager.unregisterColumn(this.registeredColumnKey);
      this.registeredColumnKey = undefined;
    }
  }

  isAutoAssignEnabled(): boolean {
    return Zotero.Prefs.get(AUTO_ASSIGN_PREF, true) === true;
  }

  setAutoAssignEnabled(enabled: boolean): void {
    Zotero.Prefs.set(AUTO_ASSIGN_PREF, enabled, true);
  }

  async getValidationReport(): Promise<ValidationReport> {
    const items = await this.getPersonalLibraryItems(false);
    return this.analyze(items);
  }

  async getInitializationPreview(): Promise<InitializationPreview> {
    const report = await this.getValidationReport();
    const usedNumbers = await this.getUsedRecordNumbers(true);
    return {
      report,
      nextNumber: smallestAvailableRecordNumber(usedNumbers),
    };
  }

  async initializeMissingNumbers(): Promise<AssignmentResult> {
    return this.enqueue(async () => {
      const items = await this.getPersonalLibraryItems(false);
      const missing = items
        .filter(
          (item) =>
            inspectRecordNumber(item.getField("extra")).status === "missing",
        )
        .sort(compareByDateAddedThenID);
      return this.assignItems(missing);
    });
  }

  async getRenumberPreview(): Promise<RenumberPreview> {
    const allItems = await this.getPersonalLibraryItems(true);
    const trashCount = allItems.filter((item) => item.deleted).length;
    const activeItems = allItems
      .filter((item) => !item.deleted)
      .sort(compareForRenumbering);
    return {
      total: activeItems.length,
      changed: countRenumberChanges(activeItems),
      trashCount,
    };
  }

  async renumberAllItems(): Promise<RenumberResult> {
    return this.enqueue(async () => {
      const allItems = await this.getPersonalLibraryItems(true);
      const trashCount = allItems.filter((item) => item.deleted).length;
      if (trashCount) {
        throw new Error("Empty the Zotero trash before renumbering");
      }

      const items = allItems.sort(compareForRenumbering);
      let changed = 0;

      for (let offset = 0; offset < items.length; offset += SAVE_BATCH_SIZE) {
        const batch = items.slice(offset, offset + SAVE_BATCH_SIZE);
        await Zotero.DB.executeTransaction(async () => {
          for (let index = 0; index < batch.length; index += 1) {
            const item = batch[index];
            const targetNumber = offset + index + 1;
            const inspection = inspectRecordNumber(item.getField("extra"));
            if (
              inspection.status === "valid" &&
              inspection.value === targetNumber
            ) {
              continue;
            }

            item.setField(
              "extra",
              withRecordNumber(item.getField("extra"), targetNumber),
            );
            await item.save({ skipDateModifiedUpdate: true });
            changed += 1;
          }
        });
        await Zotero.Promise.delay(0);
      }

      Zotero.ItemTreeManager.refreshColumns();
      return { total: items.length, changed };
    });
  }

  private registerColumn(): void {
    const registered = Zotero.ItemTreeManager.registerColumn({
      dataKey: "recordNumber",
      label: "Record Number",
      pluginID: config.addonID,
      enabledTreeIDs: ["main"],
      width: "92",
      minWidth: 64,
      flex: 0,
      sortReverse: true,
      showInColumnPicker: true,
      zoteroPersist: ["width", "hidden", "sortDirection"],
      dataProvider: (item) => this.getColumnSortValue(item),
      renderCell: (_index, data, column, _isFirstColumn, doc) => {
        const cell = doc.createElement("span");
        cell.className = `cell ${column.className}`;
        cell.textContent = data ? String(Number(data)) : "";
        cell.style.textAlign = "right";
        return cell;
      },
    });
    if (registered) this.registeredColumnKey = registered;
  }

  private getColumnSortValue(item: Zotero.Item): string {
    if (!this.isEligible(item)) return "";
    const inspection = inspectRecordNumber(item.getField("extra"));
    return inspection.status === "valid"
      ? recordNumberSortKey(inspection.value)
      : "";
  }

  private async assignNewItems(ids: Array<string | number>): Promise<void> {
    const numericIDs = ids
      .map((id) => (typeof id === "number" ? id : Number(id)))
      .filter((id) => Number.isSafeInteger(id));
    if (!numericIDs.length) return;

    const items = await Zotero.Items.getAsync(numericIDs);
    const missing = items
      .filter((item) => this.isEligible(item))
      .filter(
        (item) =>
          inspectRecordNumber(item.getField("extra")).status === "missing",
      )
      .sort(compareByDateAddedThenID);
    if (!missing.length) return;

    await this.assignItems(missing);
  }

  private async assignItems(items: Zotero.Item[]): Promise<AssignmentResult> {
    if (!items.length) {
      return { assigned: 0, firstNumber: null, lastNumber: null };
    }

    const usedNumbers = await this.getUsedRecordNumbers(true);
    let nextNumber = smallestAvailableRecordNumber(usedNumbers);
    let firstNumber: number | null = null;
    let lastNumber: number | null = null;
    let assigned = 0;

    for (let offset = 0; offset < items.length; offset += SAVE_BATCH_SIZE) {
      const batch = items.slice(offset, offset + SAVE_BATCH_SIZE);
      await Zotero.DB.executeTransaction(async () => {
        for (const item of batch) {
          if (!this.isEligible(item)) continue;
          const inspection = inspectRecordNumber(item.getField("extra"));
          if (inspection.status !== "missing") continue;

          item.setField(
            "extra",
            withRecordNumber(item.getField("extra"), nextNumber),
          );
          await item.save({ skipDateModifiedUpdate: true });
          firstNumber ??= nextNumber;
          lastNumber = nextNumber;
          usedNumbers.add(nextNumber);
          nextNumber += 1;
          while (usedNumbers.has(nextNumber)) nextNumber += 1;
          assigned += 1;
        }
      });
      await Zotero.Promise.delay(0);
    }

    Zotero.ItemTreeManager.refreshColumns();
    return {
      assigned,
      firstNumber,
      lastNumber,
    };
  }

  private async getUsedRecordNumbers(
    includeDeleted: boolean,
  ): Promise<Set<number>> {
    const items = await this.getPersonalLibraryItems(includeDeleted);
    const used = new Set<number>();
    for (const item of items) {
      const inspection = inspectRecordNumber(item.getField("extra"));
      if (inspection.status === "valid") used.add(inspection.value);
    }
    return used;
  }

  private async getPersonalLibraryItems(
    includeDeleted: boolean,
  ): Promise<Zotero.Item[]> {
    const items = await Zotero.Items.getAll(
      Zotero.Libraries.userLibraryID,
      true,
      includeDeleted,
    );
    return items.filter((item) => this.isEligible(item));
  }

  private isEligible(item: Zotero.Item): boolean {
    return (
      item.libraryID === Zotero.Libraries.userLibraryID &&
      item.isRegularItem()
    );
  }

  private analyze(items: Zotero.Item[]): ValidationReport {
    const byNumber = new Map<number, Zotero.Item[]>();
    const missing: Zotero.Item[] = [];
    const malformed: Zotero.Item[] = [];
    let numbered = 0;
    let maximum = 0;

    for (const item of items) {
      const inspection = inspectRecordNumber(item.getField("extra"));
      if (inspection.status === "missing") {
        missing.push(item);
        continue;
      }
      if (inspection.status === "malformed") {
        malformed.push(item);
        continue;
      }

      numbered += 1;
      maximum = Math.max(maximum, inspection.value);
      const entries = byNumber.get(inspection.value) || [];
      entries.push(item);
      byNumber.set(inspection.value, entries);
    }

    const duplicates = [...byNumber.entries()]
      .filter(([, duplicateItems]) => duplicateItems.length > 1)
      .map(([number, duplicateItems]) => ({
        number,
        items: duplicateItems,
      }))
      .sort((a, b) => a.number - b.number);

    return {
      total: items.length,
      numbered,
      missing,
      malformed,
      duplicates,
      maximum,
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.workQueue.then(operation, operation);
    this.workQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function compareByDateAddedThenID(a: Zotero.Item, b: Zotero.Item): number {
  const byDate = a.dateAdded.localeCompare(b.dateAdded);
  return byDate || a.id - b.id;
}

function compareForRenumbering(a: Zotero.Item, b: Zotero.Item): number {
  const aNumber = inspectRecordNumber(a.getField("extra"));
  const bNumber = inspectRecordNumber(b.getField("extra"));
  if (aNumber.status === "valid" && bNumber.status === "valid") {
    return (
      aNumber.value - bNumber.value || compareByDateAddedThenID(a, b)
    );
  }
  if (aNumber.status === "valid") return -1;
  if (bNumber.status === "valid") return 1;
  return compareByDateAddedThenID(a, b);
}

function countRenumberChanges(items: Zotero.Item[]): number {
  return items.reduce((count, item, index) => {
    const inspection = inspectRecordNumber(item.getField("extra"));
    return count +
      (inspection.status !== "valid" || inspection.value !== index + 1
        ? 1
        : 0);
  }, 0);
}
