# Cipherion: branding, privacy and static Sticker Studio

This is a partial implementation of the requested larger release. It must not be advertised as complete VIP billing or the full Emoji & Sticker Studio specification.

## Implemented

- Original uploaded JPEG is preserved byte-for-byte under `public/brand/original.jpeg`. Proportional dark-padded PNG derivatives are 32, 120, 152, 167, 180, 192 and 512 pixels. No redraw, background removal or color edits.
- Apple Touch Icon, versioned icon URLs, standalone web manifest, PNG/manifest MIME types, immutable fingerprinted assets and revalidated mutable paths. Logo appears in sign-in/registration, navigation, About, notifications and startup/failure UI. Startup completes with application readiness, without a fixed delay.
- Additive SQLite privacy policies, allow/deny exceptions (deny wins), explicit contacts, phone/birthday/public avatar, server-filtered profile/search/chat-member/author projections, protected avatar retrieval, messages/calls/invitations checks, separate direct/group receipts, privacy revision conflict detection and cross-device settings refresh.
- Existing passwords remain scrypt hashes. TOTP 2FA adds an independent factor, setup confirmation, replay rejection and ten one-time hashed recovery codes. Existing sessions and revocation remain in use. Security events are owner-only.
- P2P-disabled calls require configured TURN and use `iceTransportPolicy: relay`; signaling rejects non-relay candidates and redacts SDP connection/origin/RTCP addresses. Without TURN these calls fail closed.
- VIP self-activation API is removed. Existing VIP grants are migrated once without expiring legacy access. Server-controlled grants support expiry, lifetime gifts, revocation, single-use-per-user promo redemption, admin allowlist and audit records. Ordinary users cannot modify grants.
- Files: 2 GiB free / 4 GiB VIP, streaming upload and download. Hosting proxy/disk limits still apply. Account storage is 20 GiB. Folders 10/50, pins 5/20, bio 300/500 (the existing free 300-character allowance is preserved). Existing excessive pin/folder counts remain usable. No card data is stored.
- Five additional VIP palettes plus the existing Midnight palette (Midnight remains free because it was already available). Existing AI request quotas plus an aggregate server request budget.
- Static pack database, author-only editing/deletion/reordering API, private/public visibility, installation, favorites, recents, pack links, reports/hiding and admin moderation API. Twelve starter vector sets contain 96 original geometric reactions.
- Static PNG ingestion validates signature, CRC, dimensions, color format, decompressed raster length and filters; metadata is stripped and data recompressed. SVG/GIF/APNG imports are rejected. Existing uploaded photographs are rasterized by the browser editor before submission.
- Sticker sending and inline custom emoji work across accounts/devices. Custom emoji reaction API is implemented. Stored asset access follows pack/message membership rules.
- Canvas Studio supports photo placement preserving aspect ratio, drawing, eraser, rotation, horizontal reflection, outlined text and Undo/Redo, exporting PNG.

## Not implemented / not verified

- Paid checkout, monthly/yearly recurring billing, payment webhooks, cancellation/refunds, paid gifting and restore purchases. Provider and merchant configuration have not been supplied. UI explicitly reports payment unavailability; it does not pretend payment succeeded.
- Complete VIP personalization, video/animated covers, every requested increased limit, smart drafts/reminders/automatic translation, full semantic search and all AI VIP features.
- Message-request inbox, invitation requests, Stories privacy, PIN/biometric application lock, complete security event taxonomy, inactivity deletion, automatic message deletion, account/data deletion/export and phishing classification.
- Animated emoji/sticker imports/editing, animation scheduling, automatic background removal, crop/scale handles, advanced layer/effect tools, thumbnail pipeline, full list virtualization, recommendations, author hiding and complete catalog moderation UI.
- The starter catalog consists of simple static vector reactions; it is not twelve polished animated/3D art collections.
- Custom reactions currently have API support and display, but the full emoji-reaction picker is not yet implemented.
- Existing forwarding does not link back to an account; no new forwarding identity link was introduced.
- Native iPhone/Android home-screen installation, OS launch screen, physical-device rendering, large-file end-to-end transfer, real TURN networks and visual browser QA have not been verified. The remote browser could not access the local test server.

## Verification and rollout

Run `npm run check` and `npm test` on Node 24+. Tests use disposable SQLite databases, not production data. Added tests cover private API redaction, exceptions, media ACL, settings persistence/conflicts, blocked messages/calls, group restrictions, receipts, no-TURN failure, 2FA/recovery/session revocation, VIP privilege/expiry/promo replay, pack publishing across accounts, inline emoji/reactions and icon/manifest responses.

Before deployment, back up the existing SQLite database and media directory; use persistent storage for both `DATA_DIR/media` and `DATA_DIR/stickers`. Do not deploy onto an ephemeral filesystem expecting media to persist. Set `ADMIN_USER_IDS` to the actual owner's UUID. Do not put secrets in Git or browser settings.

On iOS, an existing home-screen icon may remain cached by the OS. Remove the old home-screen shortcut and add Cipherion again via Safari → Share → Add to Home Screen after the release is deployed. Do not delete the Cipherion account.

Browser CSS startup animation runs after the web document starts. The operating system's earlier static launch screen is separate and is not animated by website CSS.
