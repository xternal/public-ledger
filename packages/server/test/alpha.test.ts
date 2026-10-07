import { describe, expect, it } from "vitest";
import { ALPHA_COOKIE, alphaCookieValid, alphaGate, alphaPasswordMatches, alphaToken, safeNext } from "../src/alpha";

const env = { SITE_STAGE: "alpha", ALPHA_PASSWORD: "correct horse battery" };
const req = (path: string, init: { method?: string; cookie?: string } = {}) =>
  new Request(`https://alpha.example${path}`, { method: init.method ?? "GET", headers: init.cookie ? { cookie: init.cookie } : {} });

describe("alpha gate", () => {
  it("does nothing on a live site or on a public alpha (no password set)", () => {
    expect(alphaGate(req("/"), {})).toBeNull();
    expect(alphaGate(req("/"), { SITE_STAGE: "live", ALPHA_PASSWORD: "x" })).toBeNull();
    expect(alphaGate(req("/promises"), { SITE_STAGE: "alpha" })).toBeNull();
  });

  it("sends pages to the sign-in page, keeping where the tester was going", () => {
    const r = alphaGate(req("/promise/uk-bus-cap-2-2026?x=1"), env)!;
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("/alpha?next=%2Fpromise%2Fuk-bus-cap-2-2026%3Fx%3D1");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("answers 401 for API calls and form posts without the cookie", () => {
    expect(alphaGate(req("/api/t1?s=x"), env)!.status).toBe(401);
    expect(alphaGate(req("/api/follow", { method: "POST" }), env)!.status).toBe(401);
  });

  it("lets the right cookie through, and refuses an old or forged one", () => {
    expect(alphaGate(req("/", { cookie: `other=1; ${ALPHA_COOKIE}=${alphaToken(env.ALPHA_PASSWORD)}` }), env)).toBeNull();
    expect(alphaGate(req("/", { cookie: `${ALPHA_COOKIE}=${alphaToken("an old password")}` }), env)!.status).toBe(307);
    expect(alphaCookieValid("forged", env.ALPHA_PASSWORD)).toBe(false);
  });

  it("keeps the gate, health, webhooks and one-click unsubscribe open", () => {
    for (const p of ["/alpha", "/api/alpha", "/api/health", "/api/telegram", "/api/follow/unsubscribe", "/robots.txt", "/icon.svg", "/_next/static/x.js"])
      expect(alphaGate(req(p, { method: p.startsWith("/api") ? "POST" : "GET" }), env)).toBeNull();
    expect(alphaGate(req("/admin"), env)!.status).toBe(307); // editors sign in to the alpha first, then to /admin
  });

  it("compares passwords without leaking length or timing, and never redirects off-site", () => {
    expect(alphaPasswordMatches("correct horse battery", env.ALPHA_PASSWORD)).toBe(true);
    expect(alphaPasswordMatches("correct horse batter", env.ALPHA_PASSWORD)).toBe(false);
    expect(alphaPasswordMatches(undefined, env.ALPHA_PASSWORD)).toBe(false);
    expect(safeNext("/promises?area=health")).toBe("/promises?area=health");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "/alpha?next=/", 42, undefined]) expect(safeNext(bad)).toBe("/");
  });
});
