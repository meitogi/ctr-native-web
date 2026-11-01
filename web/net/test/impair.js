// Test-only network impairment for the room's links : the browser has no netem, so a player
// suite injects this file before the page loads (CDP Page.addScriptToEvaluateOnNewDocument) and
// sets `window.__ctrImpair.set({...})` at run time. Never shipped : CMake copies web/net/*.js,
// not web/net/test/.
//
// It wraps the senders of this page, so it impairs what this page sends ; inject it in both
// browsers for both directions.
//   RTCDataChannel `game` (unordered, maxRetransmits 0) : each message delayed by delay + a
//     uniform 0..jitter ms, dropped with probability `loss`, held back by one more jitter with
//     probability `reorder` (so a later one overtakes it).
//   RTCDataChannel `ctl` and the relay's WebSocket (reliable, ordered) : delayed the same way but
//     never reordered ; a `loss` is a retransmission — that message and everything behind it wait
//     `rto` ms more (TCP / SCTP head-of-line), never a drop.
//   cut : nothing leaves. `game` messages are dropped ; `ctl` and WebSocket messages wait and go
//     out in order when the cut ends (what SCTP / TCP retransmission does after a short outage).
//     ICE consent and the WebSocket's own ping / pong are below this layer : they keep a cut link
//     alive, as a peer that is gone at the application level (a frozen tab) would.
// Counters in `window.__ctrImpair.stats`.
(() => {
  if (globalThis.__ctrImpair) return;
  const cfg = { delay: 0, jitter: 0, loss: 0, reorder: 0, rto: 200, cut: false };
  const stats = { sent: 0, dropped: 0, delayed: 0, reordered: 0, retransmitted: 0, held: 0 };
  const held = []; // reliable sends waiting for the cut to end, in order
  const order = new WeakMap(); // reliable sender → time its last message is due
  const rnd = () => Math.random();

  const later = (fn, ms) => { if (ms > 0) { stats.delayed++; setTimeout(fn, ms); } else fn(); };

  function reliable(target, send, data) {
    if (cfg.cut) { stats.held++; held.push(() => send.call(target, data)); return; }
    const now = performance.now();
    let due = now + cfg.delay + rnd() * cfg.jitter;
    if (cfg.loss && rnd() < cfg.loss) { due += cfg.rto; stats.retransmitted++; }
    due = Math.max(due, order.get(target) ?? 0);
    order.set(target, due);
    stats.sent++;
    later(() => { if (target.readyState === 1 || target.readyState === 'open') send.call(target, data); }, due - now);
  }

  function lossy(target, send, data) {
    if (cfg.cut || (cfg.loss && rnd() < cfg.loss)) { stats.dropped++; return; }
    let ms = cfg.delay + rnd() * cfg.jitter;
    if (cfg.reorder && rnd() < cfg.reorder) { ms += cfg.jitter || 20; stats.reordered++; }
    stats.sent++;
    later(() => { if (target.readyState === 'open') send.call(target, data); }, ms);
  }

  if (globalThis.RTCDataChannel) {
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) {
      if (this.label === 'game') return lossy(this, send, data);
      return reliable(this, send, data);
    };
  }
  if (globalThis.WebSocket) {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) { return reliable(this, send, data); };
  }

  globalThis.__ctrImpair = {
    cfg,
    stats,
    set(next) {
      const wasCut = cfg.cut;
      Object.assign(cfg, next);
      if (wasCut && !cfg.cut) for (const flush of held.splice(0)) flush();
      return { ...cfg };
    },
    clear() { return this.set({ delay: 0, jitter: 0, loss: 0, reorder: 0, cut: false }); },
  };
})();
