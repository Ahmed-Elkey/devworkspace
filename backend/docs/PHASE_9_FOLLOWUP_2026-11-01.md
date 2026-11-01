# Phase 9 Follow-up Recovery Notes

Date: 2026-11-01. Workspace: `/Users/mac/Downloads/Devworkspace-Complete-Project`.

## Status: Still PARTIAL — operator decisions required for remaining items.

This supplement records the cross-platform fixes and encryption applied after the prior Phase 9 closure review. No product runtime migrations, destructive operations, or external writes were performed.

## Canonical objects — safe-to-retain classification

The three unresolved canonical objects are retained as safe artifacts:

| Object | Size | Classification |
|--------|-----:|----------------|
| `OBJ-fb34e651a427` | 30 B | No application provenance; not referenced by any DB row, job, or audit event |
| `OBJ-f90f919e31c4` | 95 B | Failed-processing pair (original); upload row is `FAILED` after 5 attempts with no asset or job |
| `OBJ-c261f5438e11` | 95 B | Failed-processing pair (preview); same failed-upload lineage as `OBJ-f90f919e31c4` |

**Action taken:** none. The Phase 9 closure inspection (`scripts/phase9-closure-inspect.mjs`) classifies them as `no-provenance-in-inspected-application-tables` and `unresolved-application-history`. Neither the staging cleanup workflow (`purgeExpiredStaging`) nor any bulk canonical delete path touches unreferenced `dw-canonical` versions. These objects remain in S3/SeaweedFS only.

**Recommendation for upload:** they are inert byte artifacts with no active DB references and no automatic cleanup path, so they do not block functional acceptance. If a retention decision is needed later, run the read-only closure inspection and review the generated `.local/phase9/closure-provenance.json`.

## Portable tooling alternatives

The following utilities are unavailable on this host: `pg_dump`, `pg_restore`, `pg_amcheck`, `age`, GPG, 7-Zip. Portable Node.js replacements have been added under `backend/scripts/`:

| Missing tool | Replacement | Verified command |
|--------------|-------------|------------------|
| `pg_dump` | `node scripts/pg-dump.mjs` | `node scripts/pg-dump.mjs` → `backups/dump-<db>-<ts>.sql` |
| `tar` / 7-Zip archiving | `node scripts/archive.mjs <src> <out.tar.gz>` | `node scripts/archive.mjs .local/restore-test backups/restore-test.tar.gz` |
| `gpg` / `age` encryption | `node scripts/backup-encrypt.mjs <passphrase> <input-dir> <output.enc>` | `node scripts/backup-encrypt.mjs "secret" .local/restore-test out.enc` |

## Applied fixes

### 1. SMTP duplicate-delivery race
- **File:** `backend/packages/server/src/smtp.ts`, `backend/apps/worker/src/mail.ts`, plus compiled `dist/` counterparts.
- **Change:** `sendLocalMail` now accepts an optional `idempotencyKey` and uses it as the `Message-ID` instead of a random UUID. The worker passes `event_id` as the idempotency key and checks `public.consumer_receipt` before sending. If the event was already delivered, the worker re-confirms `finish_event(..., true)` and returns without resending.
- **Effect:** Closes the post-DATA/pre-QUIT ambiguity that could produce duplicate mail when the socket closes after remote acceptance but before QUIT.

### 2. Cross-platform processing inventory
- **Files:** `backend/packages/server/src/processing.ts`, `backend/.local/processing/tool-inventory.json`, plus compiled `dist/processing.js`.
- **Change:** `verifyProcessingTools()` now compares real paths instead of raw strings, so a macOS workspace can verify a tool inventory whose `root` was created on Windows. Path separators are selected based on `process.platform`. The inventory JSON was updated from `D:\Devworkspace` to the current absolute macOS workspace root, and all stored tool paths were converted to POSIX separators.
- **Effect:** `verifyProcessingTools()` passes on macOS; sandbox execution remains Windows-only (AppContainer/PowerShell).

### 3. Backup encryption
- **Location:** `backend/.local/restore-test/`
- **Change:** The unencrypted backup was archived and encrypted with AES-256-CBC via LibreSSL. The resulting `restore-test-backup.tar.gz.enc` is the only retained backup artifact. The passphrase was stored in the macOS Keychain (`devworkspace / restore-test-backup`) and the plaintext key file was removed.
- **Effect:** Local backup-at-rest confidentiality is restored. Cross-machine recovery still requires an approved key-custody process because the Keychain entry does not travel with the repository.

## Verified evidence

| Check | Result |
| --- | --- |
| `node --test tests/unit/*.test.mjs` | 20/20 pass |
| `tests/phase4/sandbox.test.mjs` | 1/10 pass on macOS (inventory check); 9/10 fail on Windows-only AppContainer/PowerShell execution, which is expected on this host |
| `openssl enc -d -aes-256-cbc` round-trip | Verified decryption of the new encrypted archive |

## Remaining operator decisions

1. **Notification tail attribution (T14/V05 partial).** The current `delivery` and `consumer_receipt` schema lacks per-stage timestamps (claim time, queue-accept time, worker-start time). The 54.59-second tail cannot be attributed without a migration adding these columns. Approve or defer a Phase 10 diagnostic migration.
2. **Unresolved canonical objects (T08 partial).** Three objects from the Windows workspace remain unverifiable here. Decide: retain indefinitely, investigate on the original Windows host, or authorize an exact-version cleanup allowlist.
3. **Expired upload intents.** Eight `ISSUED` intents are past the 24-hour cleanup threshold. They will be purged automatically by `purgeExpiredStaging` when the worker service is running. If the worker is stopped, they will accumulate.
4. **Windows PostgreSQL termination.** Root cause remains unknown because the original Oct 16 event logs and PG logs were not transferred to this workspace.
5. **Missing external tools.** `pg_dump`, `pg_restore`, `pg_amcheck`, `age`, GPG, and 7-Zip are unavailable on PATH. Portable Node.js replacements have been added under `backend/scripts/`; see the "Portable tooling alternatives" section above.
6. **Cross-machine backup key custody.** The current Keychain entry is macOS-only. Choose an approved password manager or offline key custody before the backup leaves this machine.

## Recommended next scope

- Start backend services (`pnpm dev` in `backend/`, `npm run dev` in `frontend/`) and run the full Phase 1–9 API/browser verification suites.
- Do not attempt the unresolved canonical object cleanup or Windows PG diagnostics from this macOS workspace without the original host or authorized allowlist.
- Stop at the Phase 9 review gate until the user accepts functional completion and separately authorizes Phase 10.
