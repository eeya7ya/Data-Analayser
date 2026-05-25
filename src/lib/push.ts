import webpush from "web-push";
import { sql } from "./db";

/**
 * Server-side Web Push delivery.
 *
 * VAPID keys are read from the environment so the same identity is used
 * across every serverless instance:
 *
 *   VAPID_PUBLIC_KEY   — also served to the browser via
 *                        /api/push/public-key for subscription.
 *   VAPID_PRIVATE_KEY  — secret; never exposed to the client.
 *   VAPID_SUBJECT      — contact URL/mailto required by the spec
 *                        (defaults to a mailto so a missing value never
 *                        breaks configured keys).
 *
 * Everything degrades gracefully: when the keys are absent every helper
 * is a no-op and `isPushConfigured()` returns false, so the UI can hide
 * the "enable notifications" affordance instead of erroring.
 */

let configured: boolean | null = null;

export function isPushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    try {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:notifications@magictech.local",
        pub,
        priv,
      );
      configured = true;
    } catch {
      configured = false;
    }
  } else {
    configured = false;
  }
  return configured;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

/**
 * Deliver one notification to every active push subscription owned by
 * the listed users. Dead endpoints (404 / 410 from the push service) are
 * pruned. Fire-and-forget friendly: callers usually `void` this so a slow
 * push provider never blocks the originating request, and any error is
 * swallowed rather than failing the user's action.
 */
export async function sendPushToUsers(
  userIds: number[],
  payload: PushPayload,
): Promise<void> {
  if (!isPushConfigured()) return;
  const ids = [...new Set(userIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return;

  const q = sql();
  const subs = (await q`
    select id, endpoint, p256dh, auth
    from push_subscriptions
    where user_id = any(${ids}::int[])
  `) as Array<{ id: number; endpoint: string; p256dh: string; auth: string }>;
  if (subs.length === 0) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    url: payload.url ?? "/",
    tag: payload.tag,
  });

  const dead: number[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body,
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        // Other errors (timeout, 5xx) are transient — leave the row.
      }
    }),
  );

  if (dead.length > 0) {
    try {
      await q`delete from push_subscriptions where id = any(${dead}::int[])`;
    } catch {
      // pruning is best-effort
    }
  }
}
