# Blocks Logic: the doorbell workflow

The bell reads `Notification` rows (the inbox). A Blocks Logic workflow, `mf-doorbell`, reacts to each inserted row, rings a contentless doorbell through Blocks Notifier, and hands workspace, access-request, and build-failure emails to Blocks Mail (design 7.2 / 7.3). These files are applied only by the coordinator.

## Files

- `config.json` — the local app origin (`appBaseUrl`, MF_APP_ORIGIN, default http://localhost:5300) and the names/paths the apply script uses. Nothing secret.
- `notification/mf-doorbell.json` — the Notifier configuration: channel 0 (SignalR), type 2 (UserSpecific), `notifyMethod` `mf.doorbell` (the web client listens on exactly this name; a test checks it), persistence off.
- `workflows/mf-doorbell.json` — the workflow, a linear graph:
  1. trigger `Notification inserted` (Data Gateway, `blx_Notifications`, Inserted);
  2. code `Shape`: reads only the inserted row and returns `{ recipient, ring, email, to, template, subject, body }`. Its kind → template table is a literal copy of `src/domain/notificationEmail.ts`;
  3. `Can ring?` → HttpRequest `Ring`: `POST Notifier/Notify` to the recipient with the constant payload `{"t":"bell"}`;
  4. `Email?` → one If + SendMail pair per purpose (`mf-workspace-added`, `mf-access-requested`, `mf-build-failed`).
- Placeholders `__API_URL__`, `__TENANT_KEY__`, `__APP_URL__` are filled by the apply script into a temporary copy. No other URL or id is allowed in the file.

## Why it looks like this

- **MF-B08 — Notify is anonymous** and the hub's `Subscribe` trusts client-sent user ids. So the push carries no data (no kind, link, project or text), the client never subscribes by user id, ignores the payload and only refetches the bell (rate-limited).
- **MF-B09 — no delivery outcome.** Blocks Mail reports nothing without SES tracking; SES tracking and inbound mailboxes stay OFF. `EmailStatus` ends at `pending`.
- **MF-B10 — workflow management is plain `[Authorize]`.** The workflow therefore holds no secret, no identity-bearing node (no `dataAction`, `clientCredential`, `blocksAuthentication`, `{{$VAR.…}}`) and writes no data. Its worst case under tampering equals what anonymous Notify and any-user Mail already allow.
- **MF-B11 — data events are at-most-once** and node errors are swallowed. The Notification row is the source of truth; a missed doorbell delays the bell until the next poll (the safety net), and a missed email is not retried. A failed `Ring` becomes an error item and `Email?` still runs, because it reads `Shape`, not `$json`.
- **Persistence is off on purpose:** our inbox is the Notification schema; a Notifier inbox would be a second, forgeable one. **[U]** If the coordinator's smoke shows no push with persistence off, flip it on (`enablePersistence: true`); nothing reads the Notifier inbox.
- **[U]** The If nodes compare against the string `'true'`. If the engine hands booleans through differently, adjust the comparison on the live workflow and record it.
- Emails go to the address on the recipient's own active Account row (the server puts it in `ParamsJson`); the link is the fixed app origin plus a validated internal path.

## Apply, verify, roll back

```
node scripts/logic-apply.mjs            # dry run, prints the plan
node scripts/logic-apply.mjs --yes      # notification configuration → mail templates → workflow import --publish
node scripts/logic-apply.mjs --verify   # read-only checks
blocks logic workflow unpublish <id>    # roll back (the draft is kept)
```

Prerequisites: `BLOCKS_CONFIG_DIR` set, an outbound default mail configuration (D6), and the Notification.Kind validation already re-applied with the new kinds.
