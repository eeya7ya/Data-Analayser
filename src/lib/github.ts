/**
 * GitHub raw loader — fetches DATABASE/*.json files directly from the raw
 * GitHub URL of the configured repo/branch. Results are cached in-memory per
 * serverless instance and revalidated via Next's fetch cache.
 */

const REPO = () => process.env.GITHUB_REPO || "eeya7ya/Data-Analayser";
const BRANCH = () =>
  process.env.GITHUB_BRANCH || "claude/designer-quotation-search-jcWnF";

export function rawUrl(path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${REPO()}/${BRANCH()}/${encodeURI(clean)}`;
}

export async function fetchJson<T = unknown>(
  path: string,
  revalidateSeconds = 300,
): Promise<T> {
  const url = rawUrl(path);
  const res = await fetch(url, {
    next: { revalidate: revalidateSeconds },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub fetch failed (${res.status}) for ${path}: ${res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

export async function fetchLogo(): Promise<string> {
  return process.env.COMPANY_LOGO_URL || "/logo-placeholder.svg";
}
