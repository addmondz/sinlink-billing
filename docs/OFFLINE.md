# Offline and synchronization design

## Local authorization

The global IndexedDB directory contains profile identity, random PBKDF2 salt, business ID, device UUID, a credential-format marker, and expiring non-extractable wrapping keys for signed-in tabs. Every account uses a separate `sinlink-{businessUUID}-{userID}` database. Business rows, outbox records, number counters, and metadata are encrypted with AES-256-GCM using a fresh 96-bit IV per write. The record key and kind are authenticated additional data. Keys are derived using PBKDF2-SHA-256, 310,000 iterations, and the account password. No key, password, or API token is persisted in plaintext.

Online sign-in automatically creates or unlocks local storage with the submitted account password. Existing devices protected by a separate passphrase, or data protected by an account password from before a reset, request the previous secret once after successful online authentication. Re-encryption updates every local record in one IndexedDB transaction, retaining device identity, pending operation IDs, and number counters. Earlier backups remain encrypted with their original password; import can decrypt them with that password and re-encrypt missing records with the current key.

Unlock checks the encrypted authorization grant. It expires seven days after the last `/api/me` verification. A wrapped unlock key in tab-scoped `sessionStorage` allows refreshes to restore the same account without saving its password. Restoration checks the current server account when reachable, or the unexpired offline grant during network failures; expired or rejected sessions require sign-in. Logout/lock clears the tab envelope, the account's wrapping keys, Pinia data, the key reference, and database handles. Other tabs receive a lock notification. Offline unlock permits local work only; Laravel sessions, CSRF, active-account middleware, actor/device ownership, and operation-specific authorization control every server request. The grant is a practical trusted-device policy and cannot enforce immediate disconnected revocation or resist a hostile device owner.

## Data flow

1. Local customer edits, explicit Save Draft, issuance, and cancellation commit their encrypted entity and outbox operation in one Dexie transaction.
2. Draft typing autosaves locally without reserving/consuming a final number. A random local revision (`local_revision`) prevents two editors from silently overwriting a draft.
3. Each operation has UUID, original actor, registered device, entity UUID, type, payload, expected version, and a device-reported action time. An encrypted sequence orders writes on the device, independent of the device clock.
4. The sync runner acquires a Web Lock shared by same-origin tabs. The fallback uses an IndexedDB lease, renews it while running, and bounds each HTTP request. Server idempotency remains authoritative even if a suspended tab outlives a lease.
5. Customer operations precede dependent invoice operations. A failed/conflicted dependency blocks its dependents. Invoice operations retain their committed local order.
6. The server authenticates the actual session actor, checks device ownership, validates payload and totals, and processes each operation in its own database transaction. A batch explicitly returns each success/failure; partial success does not discard other operations.
7. The operation UUID and canonical payload hash identify a durable receipt stored in the same transaction as the entity, audit event, and change feed. Retry after timeout/commit returns the original receipt. Reusing an ID for changed content is rejected.
8. Only a successful durable receipt lets the client remove its outbox record. The acknowledgment and local merge are one IndexedDB transaction. Concurrent later local work is retained instead of overwritten by an old receipt.
9. Transient failures retry with capped exponential backoff (up to five minutes); the open app checks every 30 seconds. Permanent failures and 409 conflicts stay visible with their original proposal. Manual Retry uses the unchanged operation ID/content.
10. Pull uses server sequence pages of 200. All business writes acquire the same `billing_counters` row mutex **before** change-feed writes, and pull reads under that mutex. Thus later visible sequence commits cannot hide an earlier uncommitted change. Entity and cursor updates commit together locally. Pending or edited local entities are not overwritten by pull.

The shop-wide mutex favors simple correctness over high write throughput. It is suitable for a small retail shop, not a cross-region high-volume service. There is no timestamp-only ordering or last-write-wins for invoice financial content.

## Conflicts and cancellation

Customers and drafts have optimistic versions. A stale version receives 409 and the proposed payload stays in the local outbox and server review log. The review UI supports retry, copying invoice content to a new draft, or explicitly archiving the proposal and accepting the server record. It never silently merges financial content. Archiving retains operation content and archives later operations for the same entity together. Review an offline printed conflict before creating any replacement, to avoid treating a rejected printed document as synchronized.

Cancellation deliberately ignores a stale version because it is terminal and contains no financial edits. It changes only status, cancellation metadata, version, and audit history. An already-cancelled invoice returns safely. No other invoice operation can edit issued/cancelled content or restore its status. The local pull path also refuses to replace a cancelled record with an older issued/draft change.

Issued invoices contain customer and company/print snapshots. Company snapshot versions are checked against authorized settings history. Totals are recomputed using PHP BCMath, compared with submitted totals and line amounts, and rejected on discrepancy. Rejection does not silently alter the printed local invoice.

## Number allocation

`POST /api/number-allocations` accepts an allocation-request UUID. Under a MySQL row lock it reserves the next 100 numbers and advances the global counter. Replaying that UUID returns the same block. Each block belongs to one registered account/device.

Issuance reads/increments the next available local number, writes the immutable issued invoice, and enqueues the issue operation inside one IndexedDB read-write transaction. Separate connections/tabs serialize through IndexedDB, so no number can be reused by concurrent issuance. The server requires that the number be in a range reserved to the operation's device, verifies `SL-########`, and enforces unique final number and numeric value constraints.

Refill is proactive below 20 remaining numbers. The request UUID is persisted before the request, and receipt import never rewinds an existing local counter, including after a lost response. Exhaustion allows autosaved drafts; no provisional final number or post-print renumbering occurs. Allocation and invoice issue audit records retain reservation and consumption. Blocks are never reclaimed or reused. Gaps and nonchronological issuance across devices are expected.

A fresh storage identity always gets a new device UUID. Backup recovery drops old allocation rows and registers a new device, while retaining already-issued numbers and original operation IDs. Old pending operations still reference the original device, whose ownership remains verified server-side. Never clone an active vault to multiple live devices.

## PWA and durability

Vite PWA / Workbox precaches the shell, JavaScript, CSS, font, manifest, and icons. Navigation falls back to `index.html`; `/api`, `/sanctum`, and health routes are excluded. Authenticated responses are `no-store` and never enter shared runtime caches. No runtime CDN or network font is used.

Updates wait for an explicit prompt action. The action flushes the editor, activates the waiting worker, and reloads without touching IndexedDB. Schema changes must use additive Dexie upgrades with migrations that preserve outbox rows. Real network failures are handled independently of browser online hints. Reopen/foreground/reconnect/manual sync are supported; closed-app background execution is not assumed.

Persistent storage is requested where supported. Its grant, quotas, OS eviction, private browsing, disk failures, or a killed process can still affect local durability. Export an encrypted backup for important unsynced work and routinely synchronize. A local browser database is not a guaranteed backup.
