# Moving images from PostgreSQL to object storage

This is a future migration guide; the current implementation stores meal-photo
and avatar bytes in PostgreSQL. Use a private Cloudflare R2 or Amazon S3 bucket.
Keep the API as the authorization boundary: clients must never receive bucket
credentials or access to a public bucket.

## Access design

- Store opaque object keys, not provider URLs, in the database. Use separate
  prefixes such as `meal-photos/{photo_id}` and `avatars/{avatar_id}`; do not
  put user identifiers or original filenames in keys.
- Authenticate and check ownership on the API before issuing a short-lived
  signed GET URL. Keep expiry brief (for example, five minutes), and avoid
  logging signed URLs. A URL already issued works until it expires, even if the
  object is deleted.
- For uploads, either proxy bytes through the API or issue a short-lived signed
  PUT URL. In both cases enforce the existing byte and content-type limits at
  the API, then verify the stored object's size and type before marking it ready.
- Configure private access, encryption at rest, TLS, least-privilege service
  credentials, and lifecycle cleanup for abandoned/incomplete uploads. Do not
  cache signed responses publicly.

## Staged migration

1. **Prepare:** Create a private bucket in the intended region/account. Configure
   credentials as deployment secrets, lifecycle/retention policy, monitoring,
   and a tested backup/export procedure. Test signed GET/PUT, expiry, and denied
   access before using production data.
2. **Add metadata:** Deploy an additive migration adding nullable object-key
   (and, if needed, checksum) columns to both `food_log_photos` and
   `user_avatars`. Keep `data` and existing API behavior unchanged.
3. **Backfill:** In bounded batches, upload each row's bytes using a stable key.
   Make the job resumable and idempotent. Record the key only after a successful
   upload. On retry, safely overwrite or verify the existing object.
4. **Verify:** Compare row/object counts, byte sizes, content types, and
   SHA-256 checksums. Sample downloads through the authenticated API and verify
   user ownership. Investigate every mismatch; do not cut over on partial
   success.
5. **Dual-write:** Deploy code that writes the object and retains the BYTEA
   value. A failed object write must be surfaced and must not silently report
   success. Keep reads on BYTEA during this phase.
6. **Cut over reads:** After verification, read from the object store and return
   short-lived signed URLs only after the existing authentication and ownership
   checks. Monitor URL issuance, object-store errors, and client image failures.
   Keep a controlled BYTEA fallback during the rollback window.
7. **Remove BYTEA later:** After a defined stable period, take and verify a
   database backup, confirm every live row has a verified object, then deploy a
   separate migration to make the object key required and drop the byte column.
   Retain the old database backup and bucket export for the agreed recovery
   period; never combine this destructive step with the initial cutover.

## Rollback and recovery

- Before BYTEA is dropped, disable signed-URL reads and switch the API back to
  database bytes. Keep object writes disabled or dual-written until the cause is
  understood. Preserve the bucket for investigation; do not delete objects.
- If an upload or signed-URL request fails, return an explicit API error and
  alert on it. During the rollback window, serve the retained BYTEA copy rather
  than a success-shaped empty image.
- If object data is missing or corrupt, restore it from retained BYTEA (or a
  verified bucket/database backup), then rerun checksum verification.
- After BYTEA is dropped, rollback requires restoring the pre-drop database
  backup or copying verified objects back into the database before deploying
  code that expects BYTEA. Test this recovery procedure before dropping data.

## Capacity and storage-cost estimate

The current meal-photo limit is `MAX_PHOTO_BYTES = 1000 * 1024` = 1,024,000
bytes (1,000 KiB, about 0.977 MiB, or 0.001024 decimal GB) per photo. This is a
maximum, not a typical size: the app resizes photos before upload and the model
notes they are commonly around 300 KB. Avatars have a separate 512 KiB limit.

| Live meal photos | At maximum size | R2 Standard storage* | S3 Standard storage** |
| ---: | ---: | ---: | ---: |
| 1,000 | 1.024 GB | about $0.02/month | about $0.02/month |
| 10,000 | 10.24 GB | about $0.15/month | about $0.24/month |
| 100,000 | 102.4 GB | about $1.54/month | about $2.36/month |

These are steady-state storage-only estimates, before any free allowance and
excluding request charges, taxes, database backups, and replication. Assumptions:
R2 Standard at $0.015/GB-month and its published 10 GB-month free allowance;
S3 Standard at an illustrative $0.023/GB-month (first tier, commonly used
US-East pricing; verify the selected region). Provider rates and billing units
can change. R2 currently lists no internet egress charge; S3 transfer and
request costs depend on usage and region. See the [R2 pricing page](
https://developers.cloudflare.com/r2/pricing/) and [S3 pricing page](
https://aws.amazon.com/s3/pricing/) before deployment.

Formula at the maximum: `photos * 1,024,000 / 1,000,000,000 = decimal GB`.
Multiply by the applicable regional $/GB-month rate for a rough monthly storage
charge. For a more representative estimate, replace 1,024,000 with measured
average object bytes; at 300 KB, storage is roughly 29% of the maximum-size
estimate. Add avatar storage separately: `avatar_count * 524,288` bytes at its
maximum. Measure actual GET/PUT counts and data transfer for a complete bill
estimate; signed URLs do not eliminate object request or transfer pricing.
