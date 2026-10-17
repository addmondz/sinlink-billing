# Verification record

Verified locally on 17 October 2026. The app is built and served from Laravel at `http://127.0.0.1:8000`; the isolated MySQL server is on port 3308. No public deployment was performed.

## Environment and commands

- PHP 8.4.23 with BCMath and PDO MySQL; Composer 2.9.2.
- Laravel 13.37.0, Sanctum 4.3.3.
- Node 22.21.1; npm 10.9.4.
- Vue 3.5.44, Vite 8.3.4, Tailwind 4.3.3, Pinia 3.0.4, Dexie 4.4.6, jsPDF 4.2.1, AutoTable 5.0.9.
- Actual MySQL 8.4.11, with concurrent worker processes for reservation tests.
- Installed Google Chrome 155, headless via Playwright 1.64.1 on macOS. Phone-width checks use a 390 × 844 viewport; they are desktop browser emulation.

```sh
npm ci --ignore-scripts
composer validate --no-check-publish
vendor/bin/pint --dirty --format agent
php artisan test --compact
npm test
npm run build
php tests/support/browser-setup.php
npm run test:browser
npm audit --omit=dev
composer audit
```

The backend suite passes **18 tests / 171 assertions**. The frontend suite passes **9 tests**. The browser suite has **6 passing scenarios**. TypeScript checking and the production/PWA build pass. Dependency audits reported no known vulnerabilities. Vite reports a non-fatal main-chunk size warning; the complete precached application is approximately 1.7 MB before transfer compression.

## Checked behavior

| Area | Evidence |
| --- | --- |
| Login, authorization and staff | Real browser login, staff create/edit/password reset/deactivation; backend role/active checks, anonymous rejection, creator/admin draft access, stale-role recheck, and another staff member seeing/cancelling an invoice |
| Customers | Create, search, Malaysian/international phone normalization, normalized phone duplicate suggestions, no automatic name merge, offline creation and preserved customer references |
| Financial content | Decimal.js / BCMath half-up sen rounding, decimal quantity, amount in words, server recomputation and rejection of mismatched submitted totals/line amounts |
| Drafts | Encrypted local autosave restored after database/browser reload; no number consumption; random local revision rejects stale-tab overwrite |
| Issuance | Same final number retained after reload/sync, repeated issuance does not consume another number, server uniqueness and allocation ownership/range checks |
| Cancellation | Any active staff can cancel; blank reason accepted; original content/number retained; repeated cancellation creates no duplicate cancellation event; stale edits cannot restore cancelled invoices |
| Historical records | Customer and company edits leave issued snapshots intact; replacement invoices link to the cancelled original; audit entries record server time, original actor and device context |
| Idempotency | Duplicate operation returns the original durable receipt; modified content with a reused ID is refused; browser receives a deliberately aborted response **after a real server commit**, then replays the same operation ID and retains one invoice/issue event |
| Partial batches | Customer success, invalid customer failure, dependent invoice success are reported individually, without rolling back successful independent operations |
| Dependencies and reconnect | Customer and invoice created during real browser offline mode synchronize in dependency order; an offline cancellation follows its pending issue without restoring prior state |
| Number concurrency | Three concurrent MySQL reservation workers obtain disjoint ranges; two real browser tabs issue distinct local numbers and synchronize one issue event per invoice |
| Exhaustion | Local issuance stops when a block ends; draft saving still succeeds |
| Session expiry | Server session is invalidated while local work is pending; reconnect requests reauthentication and retains the queued customer/draft |
| Account separation and unlock | Distinct vault namespaces, wrong-password rejection, encrypted business data, expiry check, no server credential/token in localStorage, locked state clears decrypted application data |
| Backup | Encrypted export, missing-record import retaining operation IDs, counters cannot rewind, fresh-device recovery discards old ranges and changes device identity; deactivated staff proposals can enter administrator review without execution or reassignment |
| Conflicts | Stale customer/draft versions rejected and proposals retained; real browser conflict review archives the preserved local proposal and explicitly retrieves the current server customer |
| PWA reopen | Service worker activates; browser network is disabled with `BrowserContext.setOffline(true)`; app reloads and unlocks from its cached shell |
| Output offline | Offline PDF downloads and browser print-rendered PDFs; draft and cancelled markings; same snapshots/totals in preview and PDF |
| Updates | Real service-worker file update enters waiting state; user accepts the update; pending outbox IDs and saved draft survive reload |
| Responsive entry | Phone-width item cards are readable and there is no horizontal page overflow; desktop entry/list/detail screenshots captured |
| Static asset safety | Shell/assets bypass session middleware and never set session cookies, preventing login-cookie races during asset loading |

## PDF visual inspection

The browser generated these ignored local artifacts under `storage/test-artifacts`:

- `invoice.pdf`, `offline.pdf`: single-page issued invoices.
- `browser-print.pdf`: browser print rendering, using the application's print action and paper settings.
- `long-a4.pdf`: 84 long item descriptions plus extended notes, **7 pages**.
- `long-a5.pdf`: 40 long item descriptions plus extended notes, **7 pages**.
- `long-print.pdf`: the long A4 HTML document rendered by Chrome printing, **8 pages**.
- Desktop invoice and mobile entry screenshots.

The PDFs were rasterized using macOS PDFKit and visually inspected, including first, continuation, totals, and last/signature pages. Table headings repeat, descriptions wrap, totals remain readable, signatures remain together, and app navigation does not appear. Browser HTML printing and jsPDF may paginate differently; they share invoice content and totals.

To reproduce visual inspection on macOS:

```sh
swift tests/support/render-pdf.swift storage/test-artifacts/long-a4.pdf storage/test-artifacts/long-a4
```

This helper is verification tooling, not an application runtime dependency. It also writes extracted text per page. Other operating systems can use any trusted PDF renderer.

## Completed scope and remaining acceptance checks

All first-release modules have implemented working paths: authentication/roles, staff, customers, invoice entry/list/details/drafts/cancellation/replacement/audit, print/PDF/settings, PWA installation UI/guidance, encrypted offline work, transactional sync/number ranges, conflict review, backup/recovery, migrations/seeders/factories, and local/production documentation.

The following remain unverified or limited:

1. **Exact invoice styling:** the referenced invoice image and any earlier database package were unavailable. The editable print layout is explicitly provisional and contains no invented company contact or registration data.
2. **Physical devices and printers:** no physical iPhone, Android device, Windows machine, printer, or native home-screen installation was tested. Desktop Chrome phone-width emulation and browser PDF printing do not prove physical device behavior.
3. **Fonts:** bundled Noto Sans covers Latin/Malay, Greek and Cyrillic. Full CJK glyph coverage and Arabic shaping are not implemented. Test the shop's actual customer languages before rollout.
4. **Recovery acceptance:** encrypted recovery mechanics and server review boundaries are automated; a full operator-led backup transfer to a separate physical device has not been performed.
5. **Operational scale:** no long-running production soak, power-loss/storage-eviction experiment, quota stress test, high-volume load test, or production restore drill has been performed. The small-shop global write mutex prioritizes correctness.
6. **Offline limits:** disconnected revocation is impossible; the client grant is not tamper-resistant. Browser eviction can lose unsynced work. Reserved ranges can leave gaps and are not chronologically ordered across devices. Closed-app background sync is not guaranteed or required.

No external service blocks local operation. The missing invoice image blocks exact visual matching only.
