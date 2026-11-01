# Turso connection — prepared, not deployed

The server supports direct remote libSQL using pinned `libsql` 0.5.29. Set BOTH server-only variables `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to select remote storage. Partial configuration, invalid URL or remote errors do not fall back to local SQLite. Do not put tokens in frontend code, git, screenshots or chat.

Target URL: `libsql://cipherion-oligarh111.aws-us-west-2.turso.io`.

## Cutover gates

1. Obtain a verified external copy of the CURRENT Render SQLite database and media before redeploy or environment changes that restart the service. Local test backups are not production backups.
2. Prepare the database offline with this release's additive migrations and verify restoration. Existing remote databases without the expected schema version are rejected before initialization.
3. Import the verified SQLite snapshot into Turso with the provider's import workflow. Compare schema, row counts, IDs, foreign keys and representative account/message scenarios. This import has not yet been performed.
4. Set URL and token on Render after backup/import. For a deliberately new empty database only, `TURSO_ALLOW_EMPTY_INIT=1` permits schema initialization. Do not set this flag to bypass migration or lose current accounts.
5. Test actual remote transactions, triggers, concurrent retries, invalid-token/network failures, and restart/redeploy persistence before declaring connected. Local libSQL tests do not prove remote behavior or performance. The synchronous remote driver blocks the Node event loop during network requests; measure under realistic load before public launch.
6. With `MEDIA_STORAGE_MODE=database` (Docker default) photos, stickers and files up to `MEDIA_DB_MAX_MB` (20 MB) are stored in the `media_blobs` table in 512 KB chunks, so they survive Render redeploys together with Turso. Files still on local disk are moved into the database at startup. Larger files stay local and can be lost on redeploy unless S3 (`MEDIA_STORAGE_MODE=durable`) is used. Mind the Turso storage quota.

## Validation

`CIPHERION_TEST_LIBSQL=1 npm test` uses libSQL against isolated local test databases; no Turso token or production data is used. Run the default suite too to retain node:sqlite support. Docker installs native platform packages via npm optional dependencies; verify the Alpine image separately before deployment.
