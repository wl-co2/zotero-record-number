import { config } from "../package.json";
import {
  inspectRecordNumber,
  recordNumberSortKey,
  withRecordNumber,
} from "./recordNumberField";

const AUTO_ASSIGN_PREF = `${config.prefsPrefix}.autoAssign`;
const LAST_NUMBER_PREF = `${config.prefsPrefix}.lastNumber`;
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

export class RecordNumberManager {
  private observerID?: string;
  private registeredColumnKey?: string;
  private cachedHighWater?: number;
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

  async refreshHighWaterMark(): Promise<number> {
    this.cachedHighWater = undefined;
    return this.getHighWaterMark();
  }

  async getValidationReport(): Promise<ValidationReport> {
    const items = await this.getPersonalLibraryItems(false);
    return this.analyze(items);
  }

  async getInitializationPreview(): Promise<InitializationPreview> {
    const report = await this.getValidationReport();
    const highWater = await this.getHighWaterMark();
    return { report, nextNumber: highWater + 1 };
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

    let nextNumber = (await this.getHighWaterMark()) + 1;
    const firstNumber = nextNumber;
    let assigned = 0;

    for (let offset = 0; offset < items.length; offset += SAVE_BATCH_SIZE) {
      const batch = items.slice(offset, offset + SAVE_BATCH_SIZE);
      let batchLastNumber = nextNumber - 1;

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
          batchLastNumber = nextNumber;
          nextNumber += 1;
          assigned += 1;
        }
      });

      if (batchLastNumber >= firstNumber) {
        this.rememberHighWaterMark(batchLastNumber);
      }
      await Zotero.Promise.delay(0);
    }

    Zotero.ItemTreeManager.refreshColumns();
    return {
      assigned,
      firstNumber: assigned ? firstNumber : null,
      lastNumber: assigned ? nextNumber - 1 : null,
    };
  }

  private async getHighWaterMark(): Promise<number> {
    if (this.cachedHighWater !== undefined) return this.cachedHighWater;

    const localValue = Number(Zotero.Prefs.get(LAST_NUMBER_PREF, true) || 0);
    const safeLocalValue =
      Number.isSafeInteger(localValue) && localValue > 0 ? localValue : 0;
    const itemsIncludingTrash = await this.getPersonalLibraryItems(true);
    const scannedMaximum = this.analyze(itemsIncludingTrash).maximum;
    this.cachedHighWater = Math.max(safeLocalValue, scannedMaximum);
    this.rememberHighWaterMark(this.cachedHighWater);
    return this.cachedHighWater;
  }

  private rememberHighWaterMark(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) return;
    this.cachedHighWater = Math.max(this.cachedHighWater || 0, value);
    Zotero.Prefs.set(LAST_NUMBER_PREF, this.cachedHighWater, true);
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
