# Message sending repair — 2026-10-05

## Root cause

The client rendered outbox items separately from server history. Every pending render removed and recreated the pending articles; every history fetch replaced the whole message list. `sendText` waited for the outbox callback (which itself fetched chats and history) before clearing the textarea. The outbox discarded the HTTP message response and removed its local record instead of reconciling it. SSE message events triggered more complete history fetches, so the same message could temporarily appear as both a pending article and a server article.

The application uses SSE/EventSource, not WebSocket. Message creation is HTTP-only. The database already has a unique partial index on `(user_id, client_id)` and a request fingerprint table; these protections are retained.

## Changes

- `public/message-state.js`: unified merge by server ID or sender-scoped client ID; stable keyed DOM reconciliation; optimistic message projection; delayed acknowledgements do not resurrect deleted or edited content.
- `public/app.js`: immediate draft capture/clear, unified state per chat, targeted SSE updates, persistent message elements, error/retry controls, monotonic receipts, optimistic forwarding, no history reload after sending text/media/stickers/recordings.
- `public/outbox.js`: synchronous optimistic notification, IndexedDB persistence, acknowledgement merge before queue removal, transient errors, same-key retries, bounded POST timeout, serial queue draining and monotonic local ordering.
- `public/sync.js`: apply recovered sync events to loaded conversations.
- `public/ui.js`: optional request abort signal.
- `server/index.js`: explicit `clientMessageId`/server ID in message projections, viewer-specific full SSE payloads, deferred event projection, idempotent forwarding.
- `server/stickers.js`: client ID alias support and reject reuse for a different sticker.
- Tests: three new message suites, updated outbox response fixture, current username/admin fixture rules in integration/privacy/september suites.

## Identity and retry contract

A UUID is allocated once per send action. `clientMessageId` is sent with the legacy `clientId` for compatibility, stored as `client_id`, and returned through HTTP/history/SSE. The DOM key combines the sender ID and client ID. The server ID replaces the temporary ID on the same object/article. Equal text with different IDs remains separate messages. Repeated requests reuse the same ID; the database uniqueness constraint prevents duplicate insertion. Fingerprints reject changed text/media/reply or forwarding source under an existing key.

Pending sends and attachments survive reload via IndexedDB. Offline, network and server errors remain visible, with a Retry control. Transient failures are also retried when online or by the background timer; permanent validation errors require explicit retry. Local storage failures are reported instead of silently dropping the in-memory item. If the process/page closes before the first IndexedDB transaction commits, durability cannot be guaranteed.

## Validation

`npm run check`: passed.

`node --test --test-timeout=25000 tests/*.test.js`: 52 passed, 0 failed.

New tests cover actual composer Enter/button handlers, duplicate submit, ten rapid sends, a one-second delayed response, both HTTP/SSE arrival orders, stale history racing optimistic messages, offline recovery, lost response/retry with the same UUID, stable article/body/media nodes, sender-scoped keys, two independent users and two login sessions, concurrent duplicate requests, forwarded-message replay, read/delivery receipts and server restart. Existing suites cover permissions, media, groups, polls, stickers, edits, deletion, privacy, notifications and other regressions.

Physical iOS/Android device testing and production network testing were not performed. These results are local automated tests with real HTTP/SSE server sessions and a DOM browser simulation; they are not a claim of zero possible failures on every network.
