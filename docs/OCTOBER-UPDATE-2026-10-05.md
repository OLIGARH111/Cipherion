# Cipherion October update — implementation and release gates

This change extends the existing Node/SQLite-or-libSQL server and vanilla client. Realtime remains authenticated SSE plus HTTP signaling; it does not introduce a parallel WebSocket implementation. This feature branch has not been deployed and no production database migration has been performed. See the infrastructure status below before rollout.

## Current release checkpoint (2026-10-08)

- The owner requested completing the entire release preparation, including opening Turso for backup. Data/session preservation gates below still apply.
- Render independently auto-deployed main `95e8f5b504ea8632650c28715ede90d0412d0db0` at 09:39 UTC (12:39 Moscow): animation assets and index wiring. Preserve these changes when releasing this branch. This restart means current legacy-media availability must be inventoried again; it does not prove the files survived.
- The animation commit has been incorporated into this branch without changing its contents. Syntax checks and all 73 local tests pass, including legacy-session continuity after migration/restart.
- Turso browser login via Google encountered `502 Connection refused`; a fresh Turso page still shows sign-in. No production database backup, schema migration, media transfer, or new-version deployment has been performed. Do not claim successful authentication or provider integration from this checkpoint.
- Production email provider/sender credentials and real inbox delivery, real B2 PUT/HEAD/GET, current-media preservation and actual two-device calls remain unverified.

## Implemented

- Shared `saveAction`: duplicate-submit protection, retained inputs and inline errors, local-state completion before closing; stale account callbacks are ignored.
- Owner-only transactional group/channel deletion with `chat-deleted` SSE for all former members. Invitation-bound join, subscription exit, notification controls, Russian subscriber plurals.
- Channel subscribers have no composer or publication permissions. Owners can publish; admins require explicit `canPost`. Edit/delete, subscriber management and channel information permissions are checked on the server. Subscriber overrides cannot grant publication rights. Groups retain their existing permissions.
- Private S3-compatible storage behind existing authorized media endpoints. `media_objects` augments existing `media` metadata rather than replacing message/media IDs. Uploads use server-generated keys, format/size validation, SHA-256, PUT followed by HEAD verification. Production/Render uploads fail closed without configured durable storage. Development can use local files.
- Media, avatars, stories, voice/video messages, custom stickers and poster generation use the common storage adapter. Missing legacy files return a recoverable placeholder. Conservative reference checks protect forwarded/shared files during offline orphan cleanup.
- Three-step first/last name → email → code signup; user and session are created together only after verification. Username is nullable. Existing username/password accounts continue to log in. Email login/recovery uses expiring single-use codes; existing 2FA remains enforced. Email change requires the current session and verification of the new address.
- Codes use HMAC-SHA256, expire after 10 minutes, allow 5 attempts, and enforce persistent 60-second email cooldown plus request limits. No code or password is stored in browser storage. Mail is delivered through the existing HTTPS webhook contract or the direct Resend HTTPS adapter. Provider failures never expose credentials in client errors.
- Up to three independent HttpOnly cookie sessions. API, media and SSE select an account only when its session cookie validates. Switching aborts old requests and clears visible state before loading the next account. History/outbox/drafts/settings caches are scoped. Inactive accounts have independent SSE notifications; push registrations share the device endpoint without overwriting another account. Logout removes only the selected account session/cache. Push/call navigation selects the correct account first.
- WebRTC microphone capture is initiated at the user's dial/accept action; missing live audio tracks fail clearly. Remote playback retries remain in place; development logs expose permissions, tracks, senders/receivers, connection state, RTP counters/audio level and selected ICE candidate types. TURN is unchanged.

## Required before production rollout

### Mandatory preservation gate (2026-10-07)

The owner explicitly requires preservation of existing database data and continued use of existing authenticated sessions. Do not release until a restorable Turso backup and an inventory/copy of still-existing media, including all chat photographs are verified. Compare every pre-existing table's rows/identifiers and preserved attachment checksums on an isolated restored copy before and after migration; row counts alone are insufficient. Reconcile writes made during backup before cutover. Do not reset sessions, replace the database, rotate session tokens, change the site's origin/cookie scope, or force existing users into email registration. Existing expiry/revocation rules remain in effect; expired or manually revoked sessions must not be revived.

Owner clarification at 23:15 Europe/Moscow on 2026-10-07 supersedes the earlier photo exception for chat attachments: a photograph sent immediately BEFORE deployment must remain visible in its original conversation AFTER deployment, without re-upload by either user. Do not omit chat photos from backup/migration or treat the previous exception as accepting their loss. Preserve original message/media IDs and exact file bytes. Include uploads accepted after the initial inventory in a final reconciliation while writes are paused, before the old instance is replaced. Verify the original message and photo bytes using both participants' existing sessions after deployment. Future uploads must go directly to verified durable object storage. Database references alone cannot recover vanished local bytes; deployment remains blocked until existing chat photos have a verified durable copy. No database row deletion or forced logout is authorized.

`tests/legacy-session-upgrade.test.js` seeds the old NOT NULL username schema and the exact SHA-256 session/cookie format from deployed commit `418ee3c`. It compares every seeded table before/after migration, then uses the original cookie through two new-server starts to read the same account, settings, message and exact attachment bytes, including account selection for the new UI. It verifies no replacement cookie/session, unchanged expiration/password and valid foreign keys. This passes locally; it does not prove production backup completeness or recovery of previously lost files.

Render Dashboard inspection on 2026-10-07 confirms all six S3 variable names are present, with values masked; live credential validity is not yet tested. No email delivery variables or linked environment groups were configured. Free compute blocks Shell access. Production still runs `418ee3c`; no new deployment or production schema changes were made during this inspection.

1. Preserve the current production database and **still-present local media, including all chat photographs, before any Render redeploy/restart**. Missing files from previous ephemeral instances cannot be recovered by this code. Inventory and restore a verified database backup separately from media.
2. Provision a private S3-compatible bucket and server-side credentials. Set `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` and, for compatible providers, `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`. Verify permissions for PUT/HEAD/GET/DELETE. No bucket, paid resource or credentials have been provisioned by this change.
3. Run `node scripts/migrate-media.js` against the existing data for an inventory. Then run with `--apply` on the instance/export that still holds the files. Upload verification precedes metadata changes; source files are retained for rollback. Review missing-file count. Re-running skips verified objects. Do not point migration at an empty substitute data directory.
4. Stop application writes for the username schema migration. Set `EMAIL_MIGRATION_BACKUP` to a new secure durable backup file; run `node scripts/migrate-email.js --maintenance-confirmed` for a full schema/data snapshot. Verify a restore in staging. Use another unique backup path for `--maintenance-confirmed --apply`. The original users table is retained as `users_before_email`; no users or tables are dropped. Unexpected schema/triggers and redirected foreign keys abort. Remote libSQL may reject the required offline SQLite pragmas: in that case use a separately verified export/migration/import procedure, not production SQL improvisation.
5. Configure either a real HTTPS `EMAIL_VERIFICATION_URL` with `VERIFICATION_TOKEN`, or `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM` using a verified sender/domain. The Resend API integration is server-side and uses an idempotency key per challenge. Configure a stable random `EMAIL_CODE_SECRET` of at least 32 characters, and then `EMAIL_AUTH_ENABLED=1`. The webhook must deliver `{to, code, kind:"email", purpose, expiresIn:600}` and return success only after accepting delivery. Verify inbox delivery and resend behavior. No mail provider has been connected or validated in production.
6. Keep existing Turso/database configuration, session rows, cookies' secure origin settings, VAPID keys and storage credentials stable. Deploy a staging instance with a restored production-shaped database first. Run the acceptance tests below before merging the auto-deployed production branch.

## Backup and cleanup

`node scripts/backup.js create DATA_DIR BACKUP_DIR --maintenance-confirmed` creates a portable **local SQLite** backup, including S3 objects downloaded and checksum-verified. Only the snapshot's provider metadata is changed to local so it is self-contained. `node scripts/backup.js verify BACKUP_DIR` verifies it. This is not a remote Turso backup command; use the database provider's verified export/backup process for that database. Replicate/version the object bucket independently as well.

`node scripts/cleanup-media.js --maintenance-confirmed` previews old unreferenced objects; add `--apply` to delete them. It requires stopped writes to prevent upload/reference races. Deleted-message references remain protected conservatively. Never schedule this command against a live writable app.

## Verification and limits

Automated tests use local HTTP servers, test mail capture, SQLite/local libSQL, JSDOM and a mock S3 client. They validate code contracts; they do not establish live email/S3 availability or mobile audio quality.

Manual staging acceptance still required:

- Real inbox signup without username, automatic login, optional username and verified email change; old-account login and retained history.
- Add A and B, switch both directions, check messages/drafts/media/AI/settings and unread badges, logout only B, reopen the app; receive real background push and accept calls addressed to each account.
- Owner/admin/subscriber channel actions; subscriber has no composer and direct HTTP publication returns 403; deletion disappears on another open client.
- Upload photo/voice/video/sticker/avatar, restart and redeploy Render, then reopen the original messages and compare bytes.
- Two real devices, Wi-Fi↔Wi-Fi, Wi-Fi↔mobile and mobile↔mobile; audio in both directions, mute/unmute, teardown and Safari playback. Record RTP counters and selected candidate pair in development. The original one-way-audio root cause has **not** been reproduced or conclusively fixed by an actual device test; the change adds safeguards and diagnosis needed to isolate it.
- Passwordless users can enroll/disable 2FA after a fresh email challenge. Approval tokens are hashed in the DB, expire after 5 minutes, are bound to the exact authenticated session and consumed on completion. Enrollment confirmation is also session-bound. Disabling 2FA additionally requires a current authenticator/recovery code. Existing password-account 2FA remains supported; email login does not bypass either mode.

Do not treat this draft as a completed production deployment. Do not run destructive schema migrations or replace the production database with test data.
## Automated results (2026-10-05)

- `npm run check`: passed.
- `npm test`: 68 passed, 0 failed.
- `CIPHERION_TEST_LIBSQL=1 node --test tests/october-update.test.js tests/release.test.js`: 10 passed, 0 failed (local libSQL driver, not the production Turso endpoint).
- Actual app DOM tests include complete subscriber composer removal, A → B blank state while B loads, and B → A history restoration.
- `git diff --check`: passed.

## Direct email setup

The Resend adapter uses [POST /emails](https://resend.com/docs/api-reference/emails/send-email). Set `EMAIL_PROVIDER=resend`, a server-only `RESEND_API_KEY`, and `EMAIL_FROM` for your verified sender/domain. Keep `EMAIL_CODE_SECRET` stable and enable email auth only after the database migration. No SMTP server or custom webhook service is required in this mode. Provider/domain verification and real inbox delivery remain external release gates; test-sender success is not evidence of general delivery. Never paste credentials into the repository or a public issue.

Recent GitHub checks for the initial PR commit passed for both push and pull-request workflows. Follow-up changes add direct mail API transport tests, session-bound passwordless 2FA enrollment/login tests, and the shared email security UI flow.

## Pre-release hardening (2026-10-06)

- Partial S3 configuration no longer stops the entire application. Production uploads still return 503 until durable storage is configured; no ephemeral upload fallback is enabled. Existing S3 media records remain untouched. Health exposes only media/email configuration booleans, not credentials or a claim of live provider connectivity.
- Logout invalidates the active client context, stops account services and waits for pending outbox writes before clearing that account cache. A late network error cannot recreate a departed account's drafts. Other account drafts survive. Disposed history synchronizers no longer accept writes.
- Changing call devices preserves microphone mute and camera-off state. A failed sender replacement restores previous senders and releases newly acquired tracks. Flipping the camera also preserves its enabled state. This does not prove the reported one-way-audio issue resolved.
- Validation: npm run check and all 72 tests passed locally (0 failures), including the four added regression tests for partial storage configuration, logout/write races, mute preservation and replacement rollback.

Infrastructure status: the private Backblaze bucket cipherion-media-zadars108 exists in us-east-005. Four non-secret S3 environment variables were added on 2026-10-05. The Render connector unexpectedly triggered a redeploy of unchanged main commit 418ee3c76466e53cfe6571c3b1b3ccb3e6a976fa; Render later reported it live. This is not deployment of PR #8. Old-media availability after that restart has not been verified. App-key installation and actual bucket access remain unverified; never infer them from a configuration flag. Email delivery, a verified Turso backup/migration and real-device audio tests remain release gates. The user postponed the new-version deployment on 2026-10-06.
