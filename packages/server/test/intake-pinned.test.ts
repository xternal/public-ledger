import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, expect, it } from "vitest";
import { pinnedFetch } from "../src/intake/ssrf";

// A local server stands in for "the address that passed the check". The URL's
// host name is one that does not resolve at all, so a response proves the
// connection went to the pinned address, not to a fresh DNS answer.
let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/gz") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" });
      res.end(gzipSync("<p>We will build 1.5 million homes</p>"));
    } else if (req.url === "/moved") {
      res.writeHead(302, { location: "/gz" });
      res.end();
    } else {
      res.writeHead(200, { "content-type": "text/plain", "x-host": req.headers.host ?? "" });
      res.end("hello");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

it("connects to the pinned address whatever the host name resolves to, and keeps the Host header", async () => {
  const res = await pinnedFetch("127.0.0.1")(`http://does-not-resolve.invalid:${port}/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello");
  expect(res.headers.get("x-host")).toBe(`does-not-resolve.invalid:${port}`);
});

it("decompresses gzip bodies and passes redirects through unfollowed", async () => {
  const gz = await pinnedFetch("127.0.0.1")(`http://example.invalid:${port}/gz`);
  expect(await gz.text()).toContain("1.5 million homes");
  expect(gz.headers.get("content-encoding")).toBeNull();
  const moved = await pinnedFetch("127.0.0.1")(`http://example.invalid:${port}/moved`);
  expect(moved.status).toBe(302);
  expect(moved.headers.get("location")).toBe("/gz");
});
