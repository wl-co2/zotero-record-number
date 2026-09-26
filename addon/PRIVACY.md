# Privacy statement

Zotero Record Number is an offline-only plugin.

It does not contain or perform:

- HTTP, WebSocket, or other network requests;
- analytics, telemetry, crash reporting, or usage tracking;
- account login or license verification;
- plugin-initiated update checks (Zotero's own add-on manager checks the GitHub
  `updates.json` declared in the manifest);
- reading or uploading PDF contents;
- access to group libraries.

It reads top-level bibliographic metadata in the local Zotero **My Library**
database. When instructed, it writes a line such as `Record Number: 31` to the
item's Extra field. Its two local preferences are whether this computer may
assign numbers and the locally observed high-water number.

Zotero's own data-sync feature may synchronize the modified item metadata if
the user has enabled Zotero syncing. That synchronization is performed by
Zotero, not by this plugin.

Zotero 10 rejects plugins whose manifest omits `update_url`. This build points
that field to the `updates.json` file in the `wl-co2/zotero-record-number`
GitHub repository. Zotero may periodically request that file and download a
new XPI when it advertises a newer compatible version. GitHub can receive
ordinary HTTPS metadata such as the IP address, request time, and User-Agent,
but the request contains no library metadata, PDF, Record Number, account
credential, or usage telemetry.
