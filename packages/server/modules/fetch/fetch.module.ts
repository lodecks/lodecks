import { Hono } from "hono";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Downloads an image for the browser, which most hosts would block
 * cross-origin. Only public http(s) addresses, only image types, and a
 * size cap, checked again on every redirect.
 */
export const ImageTypes = ["image/gif", "image/webp", "image/png", "image/apng"];

export type FetchOptions = {
  maxBytes?: number;
  timeout?: number;
  maxRedirects?: number;
  // hosts allowed even though they are local ("*" for any): tests serve
  // their upstream on localhost
  allowHosts?: string[];
};

const Defaults = { maxBytes: 25 * 1024 * 1024, timeout: 10_000, maxRedirects: 3 };

export class FetchError extends Error {
  constructor(
    message: string,
    public status: 400 | 413 | 415 | 502 = 400
  ) {
    super(message);
  }
}

const v4 = (address: string) => address.split(".").map(Number);

/** Loopback, private, link-local, carrier-grade NAT and other reserved ranges */
export const isPrivateAddress = (address: string): boolean => {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = v4(address);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith("ff")
    );
  }
  return true;
};

/** Throws unless the url is http(s) on a public address */
export const checkUrl = async (raw: string, allowHosts: string[] = []) => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("not a valid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("only http and https urls");
  }
  if (url.username || url.password) throw new FetchError("urls with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (allowHosts.includes("*") || allowHosts.includes(host)) return url;

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new FetchError("local addresses are not allowed");
  }
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => {
        throw new FetchError(`cannot resolve ${host}`, 502);
      })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new FetchError("local and private addresses are not allowed");
  }
  return url;
};

/** Downloads an image, following redirects by hand so each hop is checked */
export const fetchImage = async (raw: string, options: FetchOptions = {}) => {
  const { maxBytes, timeout, maxRedirects } = { ...Defaults, ...options };
  const signal = AbortSignal.timeout(timeout);
  let url = await checkUrl(raw, options.allowHosts);

  for (let hop = 0; ; hop++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      // hosts such as Wikimedia refuse requests without one (Workers send none)
      headers: { accept: ImageTypes.join(", "), "user-agent": "lodecks (+https://lodecks.com)" }
    }).catch((error: Error) => {
      throw new FetchError(error.name === "TimeoutError" ? "timed out" : `fetch failed: ${error.message}`, 502);
    });

    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel();
      if (hop >= maxRedirects) throw new FetchError("too many redirects", 502);
      url = await checkUrl(new URL(response.headers.get("location")!, url).href, options.allowHosts);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new FetchError(`upstream answered ${response.status}`, 502);
    }

    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ImageTypes.includes(type)) {
      await response.body?.cancel();
      throw new FetchError(`not a gif or animated image (${type || "no type"})`, 415);
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new FetchError("file is too large", 413);
    }

    // stream it, so a lying or missing length cannot get past the cap
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new FetchError("timed out", 502);
      });
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new FetchError("file is too large", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const name = decodeURIComponent(url.pathname.split("/").pop() || "") || url.hostname;
    return { bytes, type, name, url: url.href };
  }
};

export const FetchModule = new Hono().get("/", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "pass the image as ?url=" }, 400);
  try {
    // LODECKS_FETCH_ALLOW=127.0.0.1,… lets local hosts through while developing
    const allowHosts = (process.env.LODECKS_FETCH_ALLOW || "").split(",").map((host) => host.trim()).filter(Boolean);
    const image = await fetchImage(url, { allowHosts });
    return new Response(image.bytes, {
      headers: {
        "content-type": image.type,
        "x-image-name": encodeURIComponent(image.name),
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof FetchError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});
