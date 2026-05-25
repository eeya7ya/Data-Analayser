/**
 * Single source of truth for the user-facing app version string. Shown
 * in the fixed footer bar (AppFooter) so anyone can read which build
 * they're on at a glance. Bump the label here when cutting a new UI
 * version; `package.json` carries the semver, this carries the brand
 * label the product team uses ("v1.3a").
 */
export const APP_VERSION = "1.3c";
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
