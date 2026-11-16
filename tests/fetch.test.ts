import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { checkUrl, fetchImage, isPrivateAddress } from "@/server/modules/fetch/fetch.module";

// a gif header is enough, nothing decodes it here
const Gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b]);

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/ok.gif") return new Response(Gif, { headers: { "content-type": "image/gif" } });
      if (path === "/page") return new Response("<html>", { headers: { "content-type": "text/html" } });
      if (path === "/big.gif") {
        // no length header, so only streaming can catch it
        const chunk = new Uint8Array(64 * 1024);
        let sent = 0;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (sent++ > 40) controller.close();
              else controller.enqueue(chunk);
            }
          }),
          { headers: { "content-type": "image/gif" } }
        );
      }
      if (path === "/hop") return Response.redirect(`${base}/ok.gif`, 302);
      if (path === "/loop") return Response.redirect(`${base}/loop`, 302);
      if (path === "/private") return Response.redirect("http://10.0.0.1/x.gif", 302);
      return new Response("missing", { status: 404 });
    }
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

describe("fetch guard", () => {
  test("knows private and local addresses", () => {
    for (const address of ["127.0.0.1", "10.2.3.4", "192.168.1.1", "172.20.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:192.168.0.1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  test("refuses other schemes and local hosts", async () => {
    await expect(checkUrl("file:///etc/passwd")).rejects.toThrow("only http and https");
    await expect(checkUrl("ftp://example.com/a.gif")).rejects.toThrow("only http and https");
    await expect(checkUrl("http://localhost:8090/x.gif")).rejects.toThrow("local");
    await expect(checkUrl("http://127.0.0.1/x.gif")).rejects.toThrow("private");
    await expect(checkUrl("http://10.0.0.8/x.gif")).rejects.toThrow("private");
    await expect(checkUrl("http://192.168.0.2/x.gif")).rejects.toThrow("private");
    await expect(checkUrl("http://[::1]/x.gif")).rejects.toThrow("private");
    await expect(checkUrl("http://user:pass@example.com/x.gif")).rejects.toThrow("credentials");
    await expect(checkUrl("not a url")).rejects.toThrow("valid");
  });

  test("refuses the test server itself without the dev override", async () => {
    await expect(fetchImage(`${base}/ok.gif`)).rejects.toThrow("private");
  });
});

describe("fetch image", () => {
  const options = { allowHosts: ["127.0.0.1"] };

  test("downloads a gif", async () => {
    const image = await fetchImage(`${base}/ok.gif`, options);
    expect(image.type).toBe("image/gif");
    expect(image.bytes).toEqual(Gif);
    expect(image.name).toBe("ok.gif");
  });

  test("follows redirects, but not forever", async () => {
    expect((await fetchImage(`${base}/hop`, options)).name).toBe("ok.gif");
    await expect(fetchImage(`${base}/loop`, options)).rejects.toThrow("too many redirects");
  });

  test("checks every redirect against the guard", async () => {
    // the first hop is allowed, the redirect into 10.x is not
    await expect(fetchImage(`${base}/private`, options)).rejects.toThrow("private");
  });

  test("refuses anything that is not an image", async () => {
    await expect(fetchImage(`${base}/page`, options)).rejects.toThrow("not a gif");
    await expect(fetchImage(`${base}/missing`, options)).rejects.toThrow("404");
  });

  test("stops past the size cap while streaming", async () => {
    await expect(fetchImage(`${base}/big.gif`, { ...options, maxBytes: 1024 * 1024 })).rejects.toThrow("too large");
    expect((await fetchImage(`${base}/big.gif`, { ...options, maxBytes: 4 * 1024 * 1024 })).bytes.length).toBeGreaterThan(1024 * 1024);
  });
});
