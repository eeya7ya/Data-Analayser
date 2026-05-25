#!/usr/bin/env node
/**
 * Generate a VAPID keypair for Web Push and print env lines ready to paste
 * into .env.local or the Vercel project env. Run once:
 *
 *   npm run vapid:gen
 *
 * Keep VAPID_PRIVATE_KEY secret (server-only). The public key is safe to
 * expose — the browser needs it to create a push subscription.
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log("# Web Push (VAPID) keys — add to .env.local / Vercel env:");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:notifications@magictech.local");
