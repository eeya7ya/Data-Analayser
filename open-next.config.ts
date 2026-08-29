/**
 * OpenNext adapter config — builds this Next.js app into a Cloudflare Worker.
 *
 * Why OpenNext and not `@cloudflare/next-on-pages`?
 * ─────────────────────────────────────────────────
 * `next-on-pages` requires every route to run on the **edge** runtime. This app
 * declares `export const runtime = "nodejs"` on 105 route handlers and leans on
 * Node APIs (`node:crypto` for R2 SigV4 + mailbox-password AES-GCM, Buffer,
 * streams). Converting all of that would be a rewrite.
 *
 * OpenNext runs the Node.js runtime on top of `nodejs_compat`, so those routes
 * keep working unchanged. That is the single reason this migration is a config
 * change rather than a rewrite.
 *
 * Caching
 * ───────
 * The incremental cache is backed by R2 (`NEXT_INC_CACHE_R2_BUCKET`). It points
 * at a DEDICATED bucket, not the app's `magictech-files` bucket, so cache
 * objects never end up inside the nightly DB/files backups or the off-site
 * mirror. See wrangler.toml.
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
