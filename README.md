# Zotero Record Number

Version 1.0.5 supports Zotero 7.0 through Zotero 10.0.x.

A small, offline Zotero plugin that provides EndNote-style persistent record
numbers for top-level bibliographic items in **My Library**.

## Behavior

- Stores the value in the item's Extra field as `Record Number: 31`.
- Existing numbers never change because of sorting, filtering, collections, or
  deletion of another item.
- New numbers use the highest number ever seen by this installation plus one.
- Deleted numbers are not intentionally reused.
- Attachments and notes do not receive their own numbers.
- Collections share one sequence because they contain references to items in
  My Library rather than separate copies.
- Group libraries are deliberately not numbered in this private build.

## Safe multi-computer use

The Record Number is item metadata, so Zotero data sync can carry the value to
other computers. Install the plugin on another computer if you want the custom
column there, but enable automatic assignment on **one computer only**.

On secondary computers, leave **Tools → Record Number → Automatically assign
new numbers on this computer** unchecked. New unnumbered items added elsewhere
will receive numbers after they reach the designated numbering computer via
Zotero sync.

## Initial setup

1. Back up the Zotero data directory.
2. Install the XPI from **Tools → Plugins → gear → Install Plugin From File**.
3. Open **Tools → Record Number**.
4. Run **Assign numbers to existing unnumbered items…** once.
5. On the one primary computer, enable automatic assignment.
6. Run **Check record numbers…** to verify the library.

## Privacy

The runtime plugin contains no network requests, telemetry, accounts, license
checks, or remote services. The manifest points Zotero's standard plugin update
checker to the `updates.json` file in the `wl-co2/zotero-record-number` GitHub
repository. GitHub receives normal HTTPS connection metadata such as the IP
address, time, and User-Agent, but no bibliographic metadata, PDF, Record
Number, or usage telemetry. The plugin reads local Zotero item metadata and
writes only a `Record Number` line in Extra. If Zotero data sync is enabled,
Zotero itself syncs that metadata; this plugin does not contact the Zotero
server directly.

## Build

```text
npm install
npm test
npm run build
```

The XPI is produced under `.scaffold/build/`.

## Origin and license

This private build was developed after reviewing the Zotero One item-column
implementation and its Zotero plugin scaffold. The numbering logic was
rewritten to persist values instead of recalculating row positions. See
`NOTICE.md` for attribution. Distributed under AGPL-3.0-or-later.
