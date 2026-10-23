// --js-library of the CTR_ONLINE web build : the wasm imports of
// platform/web_online_transport.c. Every function here is synchronous and
// returns at once — none is an ASYNCIFY import (D6). They reach the page's
// transport object, `Module.ctrOnlineNet` (web/online/net.js), which the
// page module (web/online/page.js) sets, or a test sets before the module starts.

addToLibrary({
  // Called once, from a constructor before main(): remembers where octr is for
  // the debug getter, and loads the page module when there is a page.
  ctr_web_online_init__deps: ['$UTF8ToString'],
  ctr_web_online_init: (octr, layout, layoutLen, karts, lobby) => {
    const l = Array.from(HEAP32.subarray(layout >> 2, (layout >> 2) + layoutLen));
    const [curr, numDrivers, driverID, levelID, numRooms, numEnded, country, room, busy, clientCount, sync, names, nameStride, maxPlayers, lockIn1] = l;
    const u8 = (off) => HEAPU8[octr + off];
    Module.ctrOnlineOctr = () => ({
      CurrState: HEAP32[(octr + curr) >> 2],
      NumDrivers: u8(numDrivers),
      DriverID: u8(driverID),
      levelID: u8(levelID),
      numRooms: u8(numRooms),
      numDriversEnded: u8(numEnded),
      serverCountry: u8(country),
      serverRoom: u8(room),
      boolClientBusy: u8(busy),
      clientCount: Array.from(HEAP8.subarray(octr + clientCount, octr + clientCount + 16)),
      windowsClientSync: HEAPU8[octr + sync],
      names: Array.from({ length: maxPlayers }, (_, i) => UTF8ToString(octr + names + i * nameStride, nameStride)),
    });
    void lockIn1;
    // One build : the mod is on while a room is joined. The page asks with
    // commands the wasm polls once per frame (ctr_web_online_control, D6) and
    // reads the state back from the heap : active, the lobby phase
    // (0 none, 1 menus, 2 starting, 3 race) and, at the track lock, the menus'
    // character per slot (-1 = empty).
    const [activePtr, phasePtr, charsPtr] = Array.from(HEAP32.subarray(lobby >> 2, (lobby >> 2) + 3));
    Module.ctrOnlineLobby = () => ({
      active: HEAP32[activePtr >> 2] !== 0,
      phase: HEAP32[phasePtr >> 2],
      characters: Array.from(HEAP32.subarray(charsPtr >> 2, (charsPtr >> 2) + 8)),
    });
    Module.ctrOnlineControlQueue = [];
    // cmd : 1 enter the page's room, 2 leave, 3 this guest's character (arg)
    Module.ctrOnlineControl = (cmd, arg = 0) => { Module.ctrOnlineControlQueue.push({ cmd, arg }); };
    // sampled by platform/web_online_transport.c once per bridge frame while connected
    Module.ctrOnlineKarts = () => {
      const k = HEAP32.subarray(karts >> 2, (karts >> 2) + 1 + maxPlayers * 6);
      return {
        frame: k[0] >>> 0,
        slots: Array.from({ length: maxPlayers }, (_, i) => {
          const [exists, posX, posY, posZ, angle, held] = k.subarray(1 + i * 6, 7 + i * 6);
          return { exists, posX, posY, posZ, angle, held };
        }),
      };
    };
    if (!Module.ctrOnlineNet && typeof document !== 'undefined') {
      import('./online/page.js').then((page) => page.attach(Module), (e) => err(`[OnlineCTR] web/online/page.js: ${e}`));
    }
  },

  // next page command, 0 when none ; its argument into arg
  ctr_web_online_control: (arg) => {
    const c = Module.ctrOnlineControlQueue?.shift();
    if (!c) return 0;
    HEAP32[arg >> 2] = c.arg | 0;
    return c.cmd | 0;
  },

  ctr_web_online_role__deps: ['$stringToUTF8'],
  ctr_web_online_role: (name, cap) => {
    const net = Module.ctrOnlineNet;
    if (!net || !net.room) return 0;
    stringToUTF8(String(net.name || 'Player'), name, cap);
    return net.role === 'host' ? 1 : net.role === 'guest' ? 2 : 0;
  },

  ctr_web_online_connect: () => Module.ctrOnlineNet?.connect() ?? -1,

  ctr_web_online_disconnect: () => { Module.ctrOnlineNet?.disconnect(); },

  ctr_web_online_send: (peer, buf, len, reliable) => {
    Module.ctrOnlineNet?.send(peer, HEAPU8.slice(buf, buf + len), reliable);
  },

  ctr_web_online_kick: (peer) => { Module.ctrOnlineNet?.kick(peer); },

  // Next queued event : its payload into buf, info = [peer, event, reliable, key low,
  // key high] ; returns the payload length, or -1 when the queue is empty.
  ctr_web_online_poll: (buf, cap, info) => {
    const e = Module.ctrOnlineNet?.poll();
    if (!e) return -1;
    const bytes = e.bytes ?? new Uint8Array(0);
    const len = Math.min(bytes.length, cap);
    HEAPU8.set(bytes.subarray(0, len), buf);
    HEAP32.set([e.peer, e.event, e.reliable ?? 1, e.key?.[0] ?? 0, e.key?.[1] ?? 0], info >> 2);
    return len;
  },
});
