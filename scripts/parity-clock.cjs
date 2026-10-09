/**
 * Pins the clock for a parity build (scripts/parity.ts). Loaded with
 * NODE_OPTIONS=--require into `next build` and `next start` only, never into
 * the site itself. Pages that depend on today's date (feeds, "coming due",
 * a card's last update) are built as of PARITY_NOW, so a check run days after
 * its baseline compares like with like. The clock still runs: it starts at
 * PARITY_NOW instead of the real time, so timeouts behave as usual.
 */
const target = Date.parse(process.env.PARITY_NOW || "");
if (Number.isFinite(target)) {
  const RealDate = Date;
  const offset = target - RealDate.now();
  const now = () => RealDate.now() + offset;
  globalThis.Date = new Proxy(RealDate, {
    construct: (T, args, newTarget) => Reflect.construct(T, args.length ? args : [now()], newTarget),
    apply: () => new RealDate(now()).toString(),
    get: (T, prop, receiver) => (prop === "now" ? now : Reflect.get(T, prop, receiver)),
  });
}
