/**
 * Small abort-budgeted JSON fetcher used by every client-side CRM list.
 *
 * Before this helper each component did `fetch(url).then(r => r.json())`
 * with no signal and no timeout, so when the serverless endpoint sat on
 * a cold Supabase handshake or a locked-up connection the component was
 * stuck on "Loading…" forever — the exact symptom behind the "nothing
 * loads in the CRM, navigation is dead" report. Mirrors the abort-budget
 * pattern already used by DesignerShell for /api/quotations reads.
 */

export class FetchTimeoutError extends Error {
  constructor() {
    super("Request timed out — please retry.");
    this.name = "FetchTimeoutError";
  }
}

export interface FetchJsonOptions {
  /** Abort budget for the whole request. Defaults to 25 s. */
  timeoutMs?: number;
  /** Optional external abort signal — the helper aborts when either
   *  this signal fires or the timeout elapses, whichever comes first. */
  signal?: AbortSignal;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 25_000);
  const external = opts.signal;
  const onExternal = () => ctl.abort();
  if (external) {
    if (external.aborted) ctl.abort();
    else external.addEventListener("abort", onExternal);
  }
  try {
    const init: RequestInit = {
      method: opts.method ?? "GET",
      signal: ctl.signal,
      cache: "no-store",
    };
    if (opts.body !== undefined) {
      init.body =
        typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      init.headers = {
        "Content-Type": "application/json",
        ...(opts.headers ?? {}),
      };
    } else if (opts.headers) {
      init.headers = opts.headers;
    }
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        if (external?.aborted) throw err;
        throw new FetchTimeoutError();
      }
      throw err;
    }
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) {
      const msg =
        (parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error?: unknown }).error ?? "")
          : "") || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onExternal);
  }
}
