// Fetching remote pages and files with sane limits.

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export interface FetchedResource {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export async function fetchResource(
  fetchFn: FetchFn,
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; accept?: string; referer?: string } = {},
): Promise<FetchedResource> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetchFn(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.referer ? { Referer: opts.referer } : {}),
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = (err as Error)?.name === "AbortError";
    throw new FetchError(aborted ? "The site took too long to respond" : `Could not reach the site (${(err as Error)?.message ?? err})`, undefined, true);
  }
  try {
    if (!res.ok) {
      throw new FetchError(`The site answered with HTTP ${res.status}`, res.status, res.status >= 500 || res.status === 429);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          chunks.push(Buffer.from(value.subarray(0, value.length - (total - maxBytes))));
          truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(Buffer.from(value));
      }
    }
    return {
      url: res.url || url,
      status: res.status,
      contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
      body: Buffer.concat(chunks),
      truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Decodes an HTML response honouring the declared or sniffed charset. */
export function decodeHtml(body: Buffer, contentType: string): string {
  let charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/["']/g, "");
  if (!charset) {
    const head = body.subarray(0, 4096).toString("latin1");
    charset =
      /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
      /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Removes common tracking parameters so the same page saved twice is recognised. */
export function cleanUrl(value: string): string {
  try {
    const u = new URL(value.trim());
    const drop = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_(cid|eid)$/i, /^igshid$/i, /^ref_src$/i, /^si$/i, /^_hs(enc|mi)$/i];
    for (const key of [...u.searchParams.keys()]) {
      if (drop.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    u.hash = u.hash && u.hash.length > 1 && !u.hash.startsWith("#:~:") ? u.hash : "";
    return u.toString();
  } catch {
    return value.trim();
  }
}
