import { RecordNumberManager, ValidationReport } from "./recordNumberManager";

const MENU_ID = "zotero-record-number-tools-menu";
const AUTO_ITEM_ID = "zotero-record-number-auto-assign";

export class RecordNumberUI {
  constructor(private readonly manager: RecordNumberManager) {}

  addToWindow(win: _ZoteroTypes.MainWindow): void {
    const doc = win.document;
    if (doc.getElementById(MENU_ID)) return;

    const toolsPopup = doc.getElementById("menu_ToolsPopup");
    if (!toolsPopup) return;

    const menu = this.createXULElement(doc, "menu");
    menu.id = MENU_ID;
    menu.setAttribute("label", this.text("记录编号", "Record Number"));

    const popup = this.createXULElement(doc, "menupopup");
    menu.appendChild(popup);

    const autoItem = this.createMenuItem(
      doc,
      this.text(
        "由这台电脑自动分配新编号",
        "Automatically assign new numbers on this computer",
      ),
      () => void this.toggleAutomaticAssignment(win),
    );
    autoItem.id = AUTO_ITEM_ID;
    autoItem.setAttribute("type", "checkbox");
    this.updateAutoItem(autoItem);
    popup.appendChild(autoItem);

    popup.appendChild(this.createXULElement(doc, "menuseparator"));
    popup.appendChild(
      this.createMenuItem(
        doc,
        this.text(
          "为现有未编号文献分配编号…",
          "Assign numbers to existing unnumbered items…",
        ),
        () => void this.initializeNumbers(win),
      ),
    );
    popup.appendChild(
      this.createMenuItem(
        doc,
        this.text(
          "将全部文献重新连续编号…",
          "Renumber all items consecutively…",
        ),
        () => void this.renumberAllItems(win),
      ),
    );
    popup.appendChild(
      this.createMenuItem(
        doc,
        this.text("检查编号…", "Check record numbers…"),
        () => void this.validateNumbers(win),
      ),
    );

    popup.appendChild(this.createXULElement(doc, "menuseparator"));
    popup.appendChild(
      this.createMenuItem(
        doc,
        this.text("隐私说明…", "Privacy information…"),
        () => this.showPrivacyInformation(win),
      ),
    );

    toolsPopup.appendChild(menu);
  }

  removeFromWindow(win: _ZoteroTypes.MainWindow): void {
    win.document.getElementById(MENU_ID)?.remove();
  }

  private async toggleAutomaticAssignment(
    win: _ZoteroTypes.MainWindow,
  ): Promise<void> {
    const currentlyEnabled = this.manager.isAutoAssignEnabled();
    if (!currentlyEnabled) {
      const confirmed = Services.prompt.confirm(
        win as unknown as mozIDOMWindowProxy,
        this.text("启用自动编号", "Enable automatic numbering"),
        this.text(
          "只应在一台主要电脑上启用自动编号。其他同步电脑可以安装本插件来显示编号，但请保持此选项关闭。\n\n是否将本机设为自动发号电脑？",
          "Enable automatic numbering on only one primary computer. Other synced computers may install this plugin to display numbers, but should keep this option off.\n\nMake this computer the numbering computer?",
        ),
      );
      if (!confirmed) {
        this.refreshAutoItem(win);
        return;
      }
    }

    this.manager.setAutoAssignEnabled(!currentlyEnabled);
    this.refreshAutoItem(win);
  }

  private async initializeNumbers(win: _ZoteroTypes.MainWindow): Promise<void> {
    try {
      const preview = await this.manager.getInitializationPreview();
      const count = preview.report.missing.length;
      if (!count) {
        this.alert(
          win,
          this.text("记录编号", "Record Number"),
          this.text(
            "“我的文库”中没有需要编号的文献。",
            "There are no unnumbered items in My Library.",
          ),
        );
        return;
      }

      const warningParts: string[] = [];
      if (preview.report.duplicates.length) {
        warningParts.push(
          this.text(
            `另有 ${preview.report.duplicates.length} 组重复编号，本操作不会修改它们。`,
            `${preview.report.duplicates.length} duplicate number group(s) also exist; this operation will not change them.`,
          ),
        );
      }
      if (preview.report.malformed.length) {
        warningParts.push(
          this.text(
            `另有 ${preview.report.malformed.length} 条格式错误的编号，本操作会跳过它们。`,
            `${preview.report.malformed.length} malformed number field(s) also exist; this operation will skip them.`,
          ),
        );
      }

      const confirmed = Services.prompt.confirm(
        win as unknown as mozIDOMWindowProxy,
        this.text("初始化记录编号", "Initialize Record Numbers"),
        [
          this.text(
            `将按“加入 Zotero 的时间”为 ${count} 篇未编号文献分配编号，从 ${preview.nextNumber} 开始。`,
            `Assign numbers to ${count} unnumbered item(s), ordered by Date Added, starting at ${preview.nextNumber}.`,
          ),
          this.text(
            "新文献优先使用最小空号；垃圾箱中的文献仍占用原编号。",
            "New items use the smallest available number; items in the trash still reserve their numbers.",
          ),
          ...warningParts,
          "",
          this.text("是否继续？", "Continue?"),
        ].join("\n"),
      );
      if (!confirmed) return;

      const result = await this.manager.initializeMissingNumbers();
      this.alert(
        win,
        this.text("编号完成", "Numbering complete"),
        this.text(
          `已为 ${result.assigned} 篇文献分配编号。首个/末个新编号：${result.firstNumber ?? "—"}/${result.lastNumber ?? "—"}。`,
          `Assigned numbers to ${result.assigned} item(s). First/last new number: ${result.firstNumber ?? "—"}/${result.lastNumber ?? "—"}.`,
        ),
      );
    } catch (error) {
      Zotero.logError(error as Error);
      this.alert(
        win,
        this.text("编号失败", "Numbering failed"),
        this.text(
          "操作未完成。请查看 Zotero 错误报告。",
          "The operation did not complete. Check the Zotero error report.",
        ),
      );
    }
  }

  private async renumberAllItems(
    win: _ZoteroTypes.MainWindow,
  ): Promise<void> {
    try {
      const preview = await this.manager.getRenumberPreview();
      if (preview.trashCount) {
        this.alert(
          win,
          this.text("无法重新编号", "Cannot renumber"),
          this.text(
            `垃圾箱中还有 ${preview.trashCount} 篇文献。请先确认并清空垃圾箱，以免恢复条目时产生重复编号。`,
            `${preview.trashCount} item(s) remain in the trash. Review and empty the trash first so restored items cannot create duplicate numbers.`,
          ),
        );
        return;
      }

      if (!preview.changed) {
        this.alert(
          win,
          this.text("记录编号", "Record Number"),
          this.text(
            `现有 ${preview.total} 篇文献已经连续编号为 1–${preview.total}。`,
            `The ${preview.total} existing item(s) are already numbered consecutively from 1 to ${preview.total}.`,
          ),
        );
        return;
      }

      const confirmed = Services.prompt.confirm(
        win as unknown as mozIDOMWindowProxy,
        this.text("重新连续编号", "Renumber consecutively"),
        [
          this.text(
            `将按当前编号顺序，把 ${preview.total} 篇文献重新编号为 1–${preview.total}；预计修改 ${preview.changed} 篇。`,
            `Renumber ${preview.total} item(s) as 1–${preview.total} in current number order; approximately ${preview.changed} item(s) will change.`,
          ),
          this.text(
            "未编号或格式错误的条目将按加入 Zotero 的时间排在最后。旧笔记中记录的编号可能不再对应原文献。",
            "Unnumbered or malformed items will be placed last by Date Added. Numbers recorded in older notes may no longer identify the same items.",
          ),
          "",
          this.text("是否继续？", "Continue?"),
        ].join("\n"),
      );
      if (!confirmed) return;

      const result = await this.manager.renumberAllItems();
      this.alert(
        win,
        this.text("重新编号完成", "Renumbering complete"),
        this.text(
          `现有 ${result.total} 篇文献已连续编号为 1–${result.total}，实际修改 ${result.changed} 篇。`,
          `${result.total} item(s) are now numbered consecutively from 1 to ${result.total}; ${result.changed} item(s) changed.`,
        ),
      );
    } catch (error) {
      Zotero.logError(error as Error);
      this.alert(
        win,
        this.text("重新编号失败", "Renumbering failed"),
        this.text(
          "操作未完成。请检查垃圾箱并查看 Zotero 错误报告。",
          "The operation did not complete. Check the trash and the Zotero error report.",
        ),
      );
    }
  }

  private async validateNumbers(win: _ZoteroTypes.MainWindow): Promise<void> {
    try {
      const report = await this.manager.getValidationReport();
      this.alert(
        win,
        this.text("编号检查结果", "Record Number check"),
        this.formatValidationReport(report),
      );
    } catch (error) {
      Zotero.logError(error as Error);
      this.alert(
        win,
        this.text("检查失败", "Check failed"),
        this.text("无法完成编号检查。", "Could not complete the check."),
      );
    }
  }

  private formatValidationReport(report: ValidationReport): string {
    const lines = [
      this.text(`文献总数：${report.total}`, `Total items: ${report.total}`),
      this.text(
        `已有编号：${report.numbered}`,
        `Numbered items: ${report.numbered}`,
      ),
      this.text(
        `缺少编号：${report.missing.length}`,
        `Missing numbers: ${report.missing.length}`,
      ),
      this.text(
        `格式错误：${report.malformed.length}`,
        `Malformed fields: ${report.malformed.length}`,
      ),
      this.text(
        `重复编号组：${report.duplicates.length}`,
        `Duplicate number groups: ${report.duplicates.length}`,
      ),
      this.text(`当前最大编号：${report.maximum}`, `Maximum number: ${report.maximum}`),
    ];

    if (report.duplicates.length) {
      lines.push("", this.text("重复编号示例：", "Duplicate examples:"));
      for (const duplicate of report.duplicates.slice(0, 10)) {
        const titles = duplicate.items
          .map((item) => shorten(item.getField("title"), 45))
          .join(" | ");
        lines.push(`${duplicate.number}: ${titles}`);
      }
    }

    if (report.malformed.length) {
      lines.push("", this.text("格式错误示例：", "Malformed examples:"));
      for (const item of report.malformed.slice(0, 10)) {
        lines.push(`• ${shorten(item.getField("title"), 70)}`);
      }
    }

    return lines.join("\n");
  }

  private showPrivacyInformation(win: _ZoteroTypes.MainWindow): void {
    this.alert(
      win,
      this.text("隐私说明", "Privacy information"),
      this.text(
        "本插件不包含联网、遥测、账户或授权验证代码。Zotero 自身会从 wl-co2/zotero-record-number 的 GitHub updates.json 检查插件更新；请求不含题录、PDF、Record Number 或使用数据，但 GitHub 会看到普通 HTTPS 连接的 IP、时间和 User-Agent。插件只读取“我的文库”的文献元数据，并把 Record Number 写入 Extra 字段。",
        "This plugin contains no networking, telemetry, account, or license-check code. Zotero itself checks the GitHub updates.json in wl-co2/zotero-record-number; the request contains no bibliographic metadata, PDF, Record Number, or usage data, though GitHub receives ordinary HTTPS metadata such as IP, time, and User-Agent. The plugin only reads item metadata in My Library and writes Record Number to Extra.",
      ),
    );
  }

  private createMenuItem(
    doc: Document,
    label: string,
    listener: () => void,
  ): XUL.MenuItem {
    const item = this.createXULElement(doc, "menuitem") as XUL.MenuItem;
    item.setAttribute("label", label);
    item.addEventListener("command", listener);
    return item;
  }

  private createXULElement(doc: Document, tag: string): XUL.Element {
    return (
      doc as Document & { createXULElement(name: string): Element }
    ).createXULElement(tag) as unknown as XUL.Element;
  }

  private refreshAutoItem(win: _ZoteroTypes.MainWindow): void {
    const item = win.document.getElementById(AUTO_ITEM_ID);
    if (item) this.updateAutoItem(item);
  }

  private updateAutoItem(item: Element): void {
    item.setAttribute(
      "checked",
      this.manager.isAutoAssignEnabled() ? "true" : "false",
    );
  }

  private alert(
    win: _ZoteroTypes.MainWindow,
    title: string,
    message: string,
  ): void {
    Services.prompt.alert(
      win as unknown as mozIDOMWindowProxy,
      title,
      message,
    );
  }

  private text(chinese: string, english: string): string {
    const locale = String((Zotero as unknown as { locale?: string }).locale || "");
    return locale.toLowerCase().startsWith("zh") ? chinese : english;
  }
}

function shorten(value: string, maximum: number): string {
  const normalized = value.trim() || "(untitled)";
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1)}…`;
}
