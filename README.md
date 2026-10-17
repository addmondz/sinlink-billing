# Sinlink Auto Accessories — cash sales

A single-repository Laravel 13 / Vue 3 / TypeScript application with a standalone Vite shell, Tailwind CSS 4, Pinia, MySQL, encrypted Dexie/IndexedDB storage, and offline jsPDF export. No Docker, queue worker, scheduler, external API, CDN, or paid service is required.

**The supplied conversation contained no accessible invoice image or database package.** The editable A4/A5 cash sales template is provisional. Only the supplied company name is prefilled; enter the real registration, address, phone, logo, and terms in Settings. Exact visual matching still requires the sample.

## Requirements

- PHP 8.3–8.5, Composer 2; extensions: PDO MySQL, BCMath, mbstring, intl, openssl, XML, ctype, fileinfo, tokenizer, session. GD is needed only to regenerate app icons.
- Node 22.12+ (tested with 22.21.1), npm 10+.
- MySQL 8.4 recommended. Tests requiring locks run on real MySQL, not SQLite.
- A modern browser with IndexedDB, Web Crypto, service workers, and JavaScript enabled. Use HTTPS for devices; `http://127.0.0.1` / `localhost` works for local development. A plain HTTP LAN address does **not** provide PWA/Web Crypto support.

Package versions are recorded in `composer.lock` and `package-lock.json`. Official documentation was checked before choosing versions: [Laravel releases](https://laravel.com/framework/docs/releases), [authentication](https://laravel.com/framework/docs/13.x/authentication), [Vue + TypeScript](https://vuejs.org/guide/typescript/overview), [Vite requirements](https://vite.dev/guide/), [Dexie transactions](https://dexie.org/docs/Dexie/Dexie.transaction()), [Tailwind Vite installation](https://tailwindcss.com/docs/installation/using-vite), [PWA updates](https://vite-pwa-org.netlify.app/guide/prompt-for-update.html), [jsPDF](https://github.com/parallax/jsPDF), [AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable).

## Local startup

```sh
composer install
cp .env.example .env
php artisan key:generate
npm ci
```

Start your local MySQL server. For a Homebrew installation, `brew services start mysql@8.4` uses its normal configured service. Create the databases using a database administrator:

```sql
CREATE DATABASE sinlink CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE sinlink_testing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sinlink'@'localhost' IDENTIFIED BY 'CHOOSE_YOUR_OWN_DATABASE_PASSWORD';
GRANT ALL ON sinlink.* TO 'sinlink'@'localhost';
GRANT ALL ON sinlink_testing.* TO 'sinlink'@'localhost';
```

Set `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, and `DB_PASSWORD` in `.env`. With `APP_ENV=local`, leave `SINLINK_ADMIN_EMAIL` and `SINLINK_ADMIN_PASSWORD` blank to create the dummy administrator automatically:

```sh
php artisan config:clear
php artisan migrate --seed
npm run build
php artisan serve --host=127.0.0.1 --port=8000
```

Open **http://127.0.0.1:8000** and sign in with **admin@admin.com** / **password1234**. `AdminUserSeeder` creates this active dummy administrator automatically in `local` and `testing` environments when no custom seed credentials are configured, including after `php artisan migrate:fresh --seed`. The password is hashed. Rerunning the seeder keeps existing accounts unchanged, including their password, role, and active status. Production seeding does not use these dummy credentials.

To override the development defaults or create an administrator in production, configure both values explicitly:

```dotenv
SINLINK_ADMIN_NAME="Shop Administrator"
SINLINK_ADMIN_EMAIL=your-email@example.com
SINLINK_ADMIN_PASSWORD="YOUR_OWN_PASSWORD_OF_AT_LEAST_12_CHARACTERS"
```

Partial or invalid custom credentials are rejected. Remove custom seed credentials after setup and clear/rebuild the configuration cache. Add staff through the application. Signing in automatically sets up local storage using the same account password, registers a new device, downloads available records, and reserves 100 invoice numbers. No separate device passphrase is needed. Existing devices ask for their old passphrase once to preserve local work and switch to the account password.

If the migrations have already run, run only the administrator seeder:

```sh
php artisan config:clear
php artisan db:seed --class=AdminUserSeeder
```

The interactive `php artisan sinlink:admin owner@example.com --name="Shop Administrator"` command remains available as another setup option.

For frontend development, keep Laravel running and use a second terminal:

```sh
npm run dev
```

Open the Vite URL shown (normally http://127.0.0.1:5173). Vite proxies `/api` and `/sanctum` to Laravel on port 8000. PWA/offline tests use the **built application on port 8000**, not Vite's development server. Each origin has separate device storage. No queue or scheduler process is needed; sync runs while the application is open.

### This workspace's isolated MySQL

The preinstalled `mysql` command was MariaDB, and `mysql -uroot` failed with `ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: NO)`. An isolated **MySQL 8.4.11** instance was started in `storage/mysql` on **127.0.0.1:3308** without modifying the existing database service. The current ignored `.env` uses this instance. `brew install mysql@8.4` installed the binaries but its linking step reported conflicting MariaDB symlinks (`Could not symlink bin/innochecksum`). No links were overwritten; the absolute MySQL binary path is used.

To restart it after stopping the current process:

```sh
./scripts/mysql-local.sh
```

This optional macOS helper uses `/opt/homebrew/opt/mysql@8.4/bin`; override `SINLINK_MYSQL_BIN` for another installation. Its loopback-only root account has no password and is for this isolated development database only. It never runs as a public service. Create `sinlink` and `sinlink_testing` with that binary's `mysql -h127.0.0.1 -P3308 -uroot` if starting from an empty directory. Stop it with `mysqladmin` from the same binary directory, port 3308. Do not remove its data directory to stop it.

## Day-to-day workflow

- Invoices is the authenticated landing page. New Invoice starts with local customer name/phone search and inline customer creation.
- Draft edits autosave to the encrypted device vault after 300 ms; wait for **Saved on this device** before closing. Navigation, lock, and update actions flush saves. A killed browser before an IndexedDB commit can still lose the latest keystrokes.
- **Save Draft** explicitly queues a draft for the server. Incomplete drafts may remain local. No final number is consumed until **Issue Invoice**.
- Issuing allocates one reserved number and commits the invoice/outbox together. Repeated taps on the same draft do not allocate another number.
- Issued invoices are immutable. Any active staff member can cancel any invoice, with an optional reason. Cancellation preserves all content and the number. Create replacement links a new invoice to a cancelled original.
- All active staff can see synchronized invoices. Only the creator or an administrator can edit a draft. Staff management and company changes require an online administrator.
- Preview, browser printing, and PDF use the same invoice snapshots. Draft and cancelled documents are visibly labelled. Print opens the browser/OS dialog; silent printing is not implemented.
- Invoice search supports number, customer, phone and vehicle; status and dates filter the list. Online results are server paginated; local/queued documents are included. The offline list clearly describes its limited device dataset.
- Customer phone matches are suggestions for duplicate review. Names are never merged. Editing a customer does not change an issued invoice's snapshot.

## Tests

Create `.env.testing` from `.env.testing.example`, enter the test MySQL credentials/port, then generate a separate key. The test database must be dedicated and disposable. Tests migrate and clear **sinlink_testing**; do not point them at business data.

```sh
cp .env.testing.example .env.testing
php artisan key:generate --env=testing
php artisan test --compact
npm test
npm run build
```

Browser tests use Playwright with a locally generated random test account. They create customers, invoices, and staff in the local database, so use a disposable local installation. Fixtures are written only under the ignored `storage/test-artifacts` directory.

```sh
php tests/support/browser-setup.php
npm run test:browser
```

`playwright.config.ts` uses installed Google Chrome on macOS. Set `PLAYWRIGHT_CHROME_EXECUTABLE` to another Chromium executable, or remove the executable override and run `npx playwright install chromium`. The server starts automatically if port 8000 is free. Screenshots, PDFs, and failure traces go to ignored artifact directories. See [verification record](docs/VERIFICATION.md) for exact coverage and outstanding device checks.

## Offline policy, security, and synchronization

See [offline and sync design](docs/OFFLINE.md). Key rules:

- First login, staff creation, and device registration require internet. Online API permission comes from a Laravel Sanctum session in an HttpOnly cookie with CSRF protection. No server password or bearer token is stored in localStorage or IndexedDB.
- Each business/account has a distinct AES-GCM encrypted vault. PBKDF2 derives its key from the account password. The directory stores only account identity, salt, device ID, and a credential-format marker. The password, key, and decrypted records live in memory only while unlocked. Existing passphrase-protected data is re-encrypted with the account password after a one-time unlock; operation IDs, device identity, and number counters are preserved.
- Offline unlock is authorized for **7 days after the last successful online account verification**. The policy is enforced by the client, not a tamper-resistant server control. A compromised device/browser or changed clock can undermine local checks. Encryption protects locked data; it does not protect an already unlocked or compromised browser.
- A disconnected device cannot learn that an account was deactivated. Deactivation rejects online access immediately when requests arrive. The app preserves local work; encrypted backups can be reviewed with the password used at export, without reattributing or executing it.
- Session expiry pauses server sync, retains pending work, and asks for login. To reauthenticate, lock/sign in as the same account; the same password opens the retained vault automatically. Signing into another account never opens the former account's vault. After a password reset, enter the previous password once to re-encrypt saved data with the new password.
- The service worker caches only the application shell, assets, icons, and bundled font. It does not cache authenticated API responses. No third-party runtime resources are required.
- Updates prompt before activation, flush a draft, and retain IndexedDB/outbox data. Never clear site storage as an update procedure.
- Sync runs on open, reconnect, every 30 seconds while open, and Sync now. Actual request outcomes determine reachability; `navigator.onLine` is not trusted as proof. There is no dependency on iPhone background sync while the app is closed.
- Number blocks can cause gaps, and numbers issued on separate devices need not be in chronological order. Exhaustion allows drafts and requires a connection for new final numbers. Already printed invoices retain their number.

## Backups and recovery

**Central database:** make encrypted, access-controlled MySQL backups (e.g. `mysqldump --single-transaction` using a secure credentials file), retain them off the server, and test restoration to a separate database. Include the `.env` application key in a separately secured secrets backup. Never commit it. Back up deployment files/logos as applicable; company logos here are stored in database snapshots.

**Unsynced local work:** in Sync status choose Export backup while unlocked. The JSON contains encrypted records and original outbox operation IDs. Recovery requires the account password used at export (or the original device passphrase for older backups). This is a manual export, not automatic durable backup. Browser eviction, device loss, or clearing storage can lose unsynced records and number blocks.

- Import missing work on the original device restores absent customers/invoices/operations. It cannot rewind allocation counters or replace newer local records. Enter the backup password before import if the backup uses an older password or device passphrase.
- On a fresh browser: select Recover from an encrypted backup on the sign-in screen and sign in as the original account. If the backup uses an older password or device passphrase, enter it once when prompted; recovered data then uses the current account password. Recovery discards old ranges and registers a new device UUID; pending operations retain the original actor, device, entity, and operation IDs. Previously issued numbers remain unchanged. Obtain fresh ranges for future issuance.
- Keep only one active recovered copy of a device's work. Export files are not multi-device cloning tools. Concurrent editing from independently restored copies can conflict.
- A deactivated staff member can export retained offline work during the existing offline grant. Review staff backup requires the password protecting that export. Proposals enter the review log only; review does not grant permission to sync as that staff member.
- Forgotten encryption passwords cannot be recovered from the server. Resetting an account password does not decrypt data still protected by the old password. Preserve the backup and its password before resetting storage.

## Production deployment

Deploy locally/staging first; this implementation has **not** been published. Use a supported PHP web server with its document root pointing at `public`, and an isolated MySQL database/user. Laravel must route SPA paths and root PWA assets through `public/index.php` as in the included `public/.htaccess` or an equivalent `try_files $uri $uri/ /index.php?$query_string` configuration. The built assets live in `public/app`; do not serve that directory as a separate application origin.

```sh
composer install --no-dev --optimize-autoloader
npm ci
npm run build
php artisan migrate --force
php artisan db:seed --force
php artisan optimize
```

- Set `APP_ENV=production`, `APP_DEBUG=false`, the actual HTTPS `APP_URL`, `SESSION_SECURE_COOKIE=true`, `SESSION_ENCRYPT=true`, strong database credentials, and a unique generated `APP_KEY`.
- To create the first production administrator through seeding, explicitly configure `SINLINK_ADMIN_NAME`, `SINLINK_ADMIN_EMAIL`, and `SINLINK_ADMIN_PASSWORD` before `php artisan db:seed --force`. Alternatively, use the hidden password prompt in `php artisan sinlink:admin`. Without configured credentials production seeding creates no account; the dummy administrator is restricted to local/testing environments. Existing company settings, counters, and user accounts are preserved. Remove custom seed credentials after setup and rebuild the configuration cache.
- Keep `storage` and `bootstrap/cache` writable by the app user; restrict `.env`, logs, database backups, and local export access. Do not expose the repository or database port publicly.
- Use HTTPS end to end and configure trusted proxies correctly for the chosen reverse proxy. PWA/Web Crypto require a secure context. Protect host and browser profiles with normal OS security.
- Keep prior hashed assets available during a rollout until existing open clients update. Never delete users' IndexedDB databases. Back up before migrations; deploy schema-compatible changes ahead of the new shell. This app's first schema uses an intentionally simple shop-wide transactional mutex for correctness at shop scale.
- No queue worker or scheduled task is required. Monitor Laravel logs, failed sync reviews, disk space, database backups, and certificate expiry. Do not prune sync receipts/change history until a deliberate cursor-retention/rebootstrap policy exists.

## Scope and known limits

Implemented: authentication, roles, staff management, customers and duplicates, invoices/drafts/replacements/cancellation, audit history, decimal calculations, editable print settings, A4/A5 preview/printing/PDF, PWA shell, encrypted offline vaults, transactional outbox and number blocks, version conflicts, sync review, manual encrypted backup/recovery.

Not in this release: analytics, inventory, tax/discount complexity, accounting integration, a full vehicle module, silent printing, gapless numbering, or guaranteed closed-app background synchronization.

The bundled Noto Sans font covers Latin-script text (including Malay), Greek, and Cyrillic. Full CJK/Arabic shaping/font coverage is not provided. Paper/printer settings can change the browser's physical output. Physical iPhone/Android/Windows printers and actual home-screen installation still need acceptance testing. The original sample remains the only missing input for exact invoice styling.
