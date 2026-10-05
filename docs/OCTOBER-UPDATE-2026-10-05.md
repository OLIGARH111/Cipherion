# Cipherion October update — implementation and release gates

This change extends the existing Node/SQLite-or-libSQL server and vanilla client. Realtime remains authenticated SSE plus HTTP signaling; it does not introduce a parallel WebSocket implementation. The production database and Render environment have not been modified.

## Implemented

- Shared `saveAction`: duplicate-submit protection, retained inputs and inline errors, local-state completion before closing; stale account callbacks are ignored.
- Owner-only transactional group/channel deletion with `chat-deleted` SSE for all former members. Invitation-bound join, subscription exit, notification controls, Russian subscriber plurals.
- Channel subscribers have no composer or publication permissions. Owners can publish; admins require explicit `canPost`. Edit/delete, subscriber management and channel information permissions are checked on the server. Subscriber overrides cannot grant publication rights. Groups retain their existing permissions.
- Private S3-compatible storage behind existing authorized media endpoints. `media_objects` augments existing `media` metadata rather than replacing message/media IDs. Uploads use server-generated keys, format/size validation, SHA-256, PUT followed by HEAD verification. Production/Render uploads fail closed without configured durable storage. Development can use local files.
- Media, avatars, stories, voice/video messages, custom stickers and poster generation use the common storage adapter. Missing legacy files return a recoverable placeholder. Conservative reference checks protect forwarded/shared files during offline orphan cleanup.
- Three-step first/last name → email → code signup; user and session are created together only after verification. Username is nullable. Existing username/password accounts continue to log in. Email login/recovery uses expiring single-use codes; existing 2FA remains enforced. Email change requires the current session and verification of the new address.
- Codes use HMAC-SHA256, expire after 10 minutes, allow 5 attempts, and enforce persistent 60-second email cooldown plus request limits. No code or password is stored in browser storage. Mail is delivered through the existing HTTPS webhook contract.
- Up to three independent HttpOnly cookie sessions. API, media and SSE select an account only when its session cookie validates. Switching aborts old requests and clears visible state before loading the next account. History/outbox/drafts/settings caches are scoped. Inactive accounts have independent SSE notifications; push registrations share the device endpoint without overwriting another account. Logout removes only the selected account session/cache. Push/call navigation selects the correct account first.
- WebRTC microphone capture is initiated at the user's dial/accept action; missing live audio tracks fail clearly. Remote playback retries remain in place; development logs expose permissions, tracks, senders/receivers, connection state, RTP counters/audio level and selected ICE candidate types. TURN is unchanged.

## Required before production rollout

1. Preserve the current production database and **all still-present local media before any Render redeploy/restart**. Missing files from previous ephemeral instances cannot be recovered by this code. Inventory and restore a verified database backup separately from media.
2. Provision a private S3-compatible bucket and server-side credentials. Set `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` and, for compatible providers, `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`. Verify permissions for PUT/HEAD/GET/DELETE. No bucket, paid resource or credentials have been provisioned by this change.
3. Run `node scripts/migrate-media.js` against the existing data for an inventory. Then run with `--apply` on the instance/export that still holds the files. Upload verification precedes metadata changes; source files are retained for rollback. Review missing-file count. Re-running skips verified objects. Do not point migration at an empty substitute data directory.
4. Stop application writes for the username schema migration. Set `EMAIL_MIGRATION_BACKUP` to a new secure durable backup file; run `node scripts/migrate-email.js --maintenance-confirmed` for a full schema/data snapshot. Verify a restore in staging. Use another unique backup path for `--maintenance-confirmed --apply`. The original users table is retained as `users_before_email`; no users or tables are dropped. Unexpected schema/triggers and redirected foreign keys abort. Remote libSQL may reject the required offline SQLite pragmas: in that case use a separately verified export/migration/import procedure, not production SQL improvisation.
5. Configure a real HTTPS `EMAIL_VERIFICATION_URL` with `VERIFICATION_TOKEN`, a stable random `EMAIL_CODE_SECRET` of at least 32 characters, and then `EMAIL_AUTH_ENABLED=1`. The webhook must deliver `{to, code, kind:"email", purpose, expiresIn:600}` and return success only after accepting delivery. Verify inbox delivery and resend behavior. No mail provider has been connected or validated in production.
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
- New passwordless users do not yet have a password-based 2FA enrollment flow. Existing password-account 2FA remains supported; email login does not bypass it.

Do not treat this draft as a completed production deployment. Do not run destructive schema migrations or replace the production database with test data.
## Automated results (2026-10-05)

- `npm run check`: passed.
- `npm test`: 64 passed, 0 failed.
- `CIPHERION_TEST_LIBSQL=1 node --test tests/october-update.test.js tests/release.test.js`: 10 passed, 0 failed (local libSQL driver, not the production Turso endpoint).
- Actual app DOM tests include complete subscriber composer removal, A → B blank state while B loads, and B → A history restoration.
- `git diff --check`: passed.
