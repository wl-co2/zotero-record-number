# Installation

1. Download `dist/zotero-record-number-1.0.5.xpi`.
2. In Zotero 7, open **Tools → Plugins**.
3. Open the gear menu and choose **Install Plugin From File...**.
4. Select the downloaded XPI and restart Zotero if prompted.

For an existing library, first run **Tools → Record Number → Initialize Missing Record Numbers** on one primary computer, then run **Check Record Numbers**. Keep automatic assignment enabled on only one computer to avoid concurrent number allocation.

The add-on stores the number in each item's `Extra` field so Zotero sync carries it with the item. Uninstalling the add-on does not remove those values.

## Updates and privacy

Zotero checks the public `updates.json` file in this repository and downloads a newer signed release from `dist/` when available. The add-on itself contains no telemetry or bibliography-upload code. See [PRIVACY.md](PRIVACY.md) for the exact network boundary.
