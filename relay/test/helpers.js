// Test client : a real WebSocket to a real relay, with a message queue to await on.
import WebSocket from 'ws';

export function connect(url, wsOptions) {
  const ws = new WebSocket(url, wsOptions);
  const queue = [];
  const waiters = [];
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  ws.on('error', () => {});
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.type === msg.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  const opened = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    opened,
    closed,
    send: (obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)),
    /** Resolves with the next message of `type`, or rejects after `ms`. */
    next(type, ms = 2000) {
      const i = queue.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const j = waiters.indexOf(waiter);
          if (j >= 0) { waiters.splice(j, 1); reject(new Error(`no ${type} within ${ms} ms`)); }
        }, ms);
      });
    },
    /** True when nothing of `type` arrives within `ms`. */
    async silent(type, ms = 300) {
      try { await this.next(type, ms); return false; } catch { return true; }
    },
    close: () => ws.close(),
  };
}

/** Connects and joins a room ; resolves with the client once welcomed. */
export async function join(url, hello, wsOptions) {
  const c = connect(url, wsOptions);
  await c.opened;
  c.send({ type: 'hello', ...hello });
  c.welcome = await c.next('welcome');
  return c;
}

export const quiet = () => {};
