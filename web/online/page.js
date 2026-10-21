// The Online panel of the CTR_ONLINE web build. Loaded by the game itself (web/online/library.js,
// from a constructor before main()), so index.html stays the same for both builds.
//
// A sidebar on the right : the page makes room for it (the 4:3 canvas re-centres in what is
// left ; on a narrow window it covers the game's edge). Closed, it is a small round button at
// the right edge that fades out when the mouse is still, comes back as the mouse approaches,
// is fully opaque under it, and opens the sidebar on click.
//
// The room comes before the game needs it. Host : the meeting points of the new room (how the
// players find each other : our relay, public MQTT brokers, a copy-paste code), in order.
// Guest : the room link in the page's URL (`#room=…`, web/net/link.js) and the connection
// (automatic : direct, else via the relay ; or always via the relay). The guest starts its link
// as soon as the room opens ; the game's « Private Room » entry then uses it. The player name is
// read when the game connects. Strings follow the browser's language (French or English).
//
// Debug getter : `window.__ctrOnline.state()` — octr as the bridge sees it, the room, its links,
// per-slot kart samples, message counts ; tests read it instead of pixels (never `window.__ctr`,
// which is T3's).
import { formatRoomLink, newRoom, parseRoomLink } from '../net/link.js';
import { openRoom } from '../net/room.js';
import { createOnlineNet } from './net.js';

const DEFAULT_RELAY = 'wss://ctr-relay.suuuper.app';
const NAME_LEN = 9; // game/OnlineCTR/global.h
const WIDTH = 300; // the sidebar, CSS px

const STRINGS = {
  en: {
    title: 'Online',
    hide: 'Hide',
    open: 'Online',
    name: 'Player name',
    hostTitle: 'Host a room',
    meet: 'Meeting point (tried in this order)',
    meetHelp: 'How players find each other. The game itself goes directly between players when it can ; otherwise only the relay can carry it.',
    relay: 'Our relay',
    relayHelp: 'Finds the players, and carries the game when no direct path exists.',
    relayUrl: 'Relay address',
    relayKey: 'Relay key',
    mqtt: 'Public brokers (no server of ours)',
    mqttHelp: 'Finds the players through public MQTT servers. Cannot carry the game.',
    paste: 'Copy-paste code (no server at all)',
    pasteHelp: 'You and each guest exchange two codes by message. Cannot carry the game.',
    create: 'Create room',
    noMeet: 'Tick at least one meeting point.',
    noRelayUrl: 'The relay needs an address.',
    link: 'Room link — send it to the other players',
    copy: 'Copy',
    joinTitle: 'Join a room',
    joinPlaceholder: 'paste a room link',
    join: 'Join',
    path: 'Connection',
    pathAuto: 'Automatic : direct, else via the relay',
    pathRelay: 'Always via the relay',
    pathHelp: 'Always via the relay passes networks that block direct connections, a little slower.',
    codeOut: (who) => `Send this code to ${who} :`,
    theHost: 'the host',
    aGuest: 'the guest',
    codeIn: 'Paste the code you received :',
    useCode: 'Use this code',
    hosting: (room) => `Hosting room ${room}`,
    guestOf: (room) => `Guest of room ${room}`,
    waiting: 'Waiting for players',
    player: (n, path, met) => `Player ${n} : ${path}, met on ${met}`,
    toHost: (path, met) => `Connected to the host : ${path}, met on ${met}`,
    connecting: 'Connecting to the host…',
    notConnected: 'Not connected',
    game: (s) => `In the game : ${s}`,
    controls: [
      'Controls (keyboard) :',
      '  arrows = D-pad (steer, menus)    C = Cross (accelerate, OK)    V = Circle (use item)',
      '  X = Square (brake, reverse)      Z = Triangle (back)',
      '  L Shift = L1 (hop / drift)       R Shift = R1 (hop / drift)    L Ctrl = L2    R Ctrl = R2',
      '  Enter = Start (pause)            Space = Select (leave the online room)',
      '  A gamepad works as is (standard mapping). F4 moves the keyboard to the next player.',
    ],
    hint: 'Once there is a room, the game skips its server menu and lists the rooms : pick the same room number as the host (C = Cross).',
    paths: { 'direct-ipv6': 'direct (IPv6)', 'direct-lan': 'direct (local network)', 'direct-nat': 'direct (through NAT)', relay: 'via the relay' },
    meets: { relay: 'our relay', mqtt: 'public brokers', paste: 'copy-paste' },
    states: ['starting', 'server menu', 'room list', 'version error', 'joining', 'track choice', 'waiting for the track', 'character choice', 'waiting for the others', 'loading', 'start line', 'racing', 'results'],
    errors: {
      link: 'This room link is not valid.',
      absent: 'The host is not in the room (yet).',
      'no-direct-path': 'No direct path to the host, and this room has no relay to carry the game.',
      'no-relay': '« Always via the relay » needs a room with our relay.',
      impostor: 'The other side could not prove the room secret : wrong link, or someone in between.',
      timeout: 'Direct connection failed ; trying the relay.',
      ice: 'Direct connection failed ; trying the relay.',
      relay: 'The relay closed the connection.',
      paste: 'This room has no copy-paste meeting point.',
    },
  },
  fr: {
    title: 'En ligne',
    hide: 'Masquer',
    open: 'En ligne',
    name: 'Nom du joueur',
    hostTitle: 'Créer une partie',
    meet: 'Point de rendez-vous (essayés dans cet ordre)',
    meetHelp: 'Comment les joueurs se trouvent. Le jeu passe en direct entre joueurs quand c\'est possible ; sinon seul le relais peut le transporter.',
    relay: 'Notre relais',
    relayHelp: 'Trouve les joueurs, et transporte le jeu quand il n\'y a pas de chemin direct.',
    relayUrl: 'Adresse du relais',
    relayKey: 'Clé du relais',
    mqtt: 'Serveurs publics (aucun serveur à nous)',
    mqttHelp: 'Trouve les joueurs via des serveurs MQTT publics. Ne transporte pas le jeu.',
    paste: 'Code à copier-coller (aucun serveur)',
    pasteHelp: 'Toi et chaque invité échangez deux codes par message. Ne transporte pas le jeu.',
    create: 'Créer la partie',
    noMeet: 'Coche au moins un point de rendez-vous.',
    noRelayUrl: 'Le relais a besoin d\'une adresse.',
    link: 'Lien de la partie — envoie-le aux autres joueurs',
    copy: 'Copier',
    joinTitle: 'Rejoindre une partie',
    joinPlaceholder: 'colle un lien de partie',
    join: 'Rejoindre',
    path: 'Connexion',
    pathAuto: 'Automatique : en direct, sinon via le relais',
    pathRelay: 'Toujours via le relais',
    pathHelp: 'Toujours via le relais passe les réseaux qui bloquent le direct, un peu plus lent.',
    codeOut: (who) => `Envoie ce code à ${who} :`,
    theHost: 'l\'hôte',
    aGuest: 'l\'invité',
    codeIn: 'Colle le code reçu :',
    useCode: 'Utiliser ce code',
    hosting: (room) => `Tu héberges la partie ${room}`,
    guestOf: (room) => `Invité de la partie ${room}`,
    waiting: 'En attente de joueurs',
    player: (n, path, met) => `Joueur ${n} : ${path}, trouvé via ${met}`,
    toHost: (path, met) => `Connecté à l'hôte : ${path}, trouvé via ${met}`,
    connecting: 'Connexion à l\'hôte…',
    notConnected: 'Pas connecté',
    game: (s) => `Dans le jeu : ${s}`,
    controls: [
      'Commandes (clavier) :',
      '  flèches = croix directionnelle (diriger, menus)    C = Croix (accélérer, valider)    V = Rond (utiliser l\'objet)',
      '  X = Carré (freiner, reculer)      Z = Triangle (retour)',
      '  Maj gauche = L1 (saut / dérapage)    Maj droite = R1 (saut / dérapage)    Ctrl gauche = L2    Ctrl droite = R2',
      '  Entrée = Start (pause)            Espace = Select (quitter la salle en ligne)',
      '  Une manette marche telle quelle (mapping standard). F4 passe le clavier au joueur suivant.',
    ],
    hint: 'Dès qu\'il y a une partie, le jeu saute son menu de serveurs et liste les salles : prends le même numéro de salle que l\'hôte (C = Croix).',
    paths: { 'direct-ipv6': 'en direct (IPv6)', 'direct-lan': 'en direct (réseau local)', 'direct-nat': 'en direct (à travers le NAT)', relay: 'via le relais' },
    meets: { relay: 'notre relais', mqtt: 'les serveurs publics', paste: 'copier-coller' },
    states: ['démarrage', 'menu des serveurs', 'liste des salles', 'erreur de version', 'arrivée', 'choix du circuit', 'attente du circuit', 'choix du perso', 'attente des autres', 'chargement', 'ligne de départ', 'course', 'résultats'],
    errors: {
      link: 'Ce lien de partie n\'est pas valide.',
      absent: 'L\'hôte n\'est pas (encore) dans la partie.',
      'no-direct-path': 'Pas de chemin direct vers l\'hôte, et cette partie n\'a pas de relais pour transporter le jeu.',
      'no-relay': '« Toujours via le relais » demande une partie avec notre relais.',
      impostor: 'L\'autre côté n\'a pas prouvé le secret de la partie : mauvais lien, ou quelqu\'un au milieu.',
      timeout: 'Connexion directe impossible ; essai via le relais.',
      ice: 'Connexion directe impossible ; essai via le relais.',
      relay: 'Le relais a fermé la connexion.',
      paste: 'Cette partie n\'a pas de copier-coller.',
    },
  },
};

const CSS = `
#online { position: fixed; top: 30px; right: 0; bottom: 0; width: ${WIDTH}px; box-sizing: border-box; z-index: 15;
  padding: 10px 12px; overflow-y: auto; background: #111; border-left: 1px solid #333; color: #ccc; font: 12px/1.5 monospace; }
#online.closed { display: none; }
#online header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
#online h2 { font-size: 14px; margin: 0; color: #eee; }
#online h3 { font-size: 12px; margin: 12px 0 4px; color: #eee; }
#online label { display: block; margin: 4px 0; }
#online .opt { margin: 6px 0; }
#online .opt > label { margin: 0; }
#online .help { color: #888; margin: 0 0 2px 20px; }
#online .help.wide { margin-left: 0; }
#online input[type=text], #online input[type=password], #online textarea { width: 100%; box-sizing: border-box; font: inherit;
  background: #000; color: #ddd; border: 1px solid #444; padding: 2px 4px; }
#online textarea { height: 64px; resize: vertical; word-break: break-all; }
#online .sub { margin-left: 20px; }
#online button { font: inherit; background: #222; color: #ccc; border: 1px solid #444; cursor: pointer; margin: 4px 4px 0 0; }
#online .row { display: flex; gap: 4px; align-items: center; }
#online .row input { flex: 1; }
#online .status { white-space: pre-wrap; margin-top: 10px; color: #ddd; }
#online .error { color: #f66; white-space: pre-wrap; }
#online .hint { color: #888; margin-top: 10px; }
#online-toggle { position: fixed; top: 40px; right: 10px; z-index: 16; width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid #555; background: #111; color: #ddd; cursor: pointer; padding: 0; opacity: 0;
  transition: opacity 150ms linear; display: flex; align-items: center; justify-content: center; }
#online-toggle.hidden { display: none; }
`;

// A monochrome « network » glyph : three linked nodes.
const ICON = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
<circle cx="10" cy="4" r="2.2"/><circle cx="4" cy="15.5" r="2.2"/><circle cx="16" cy="15.5" r="2.2"/>
<path d="M9 6 5 13.5M11 6l4 7.5M6.2 15.5h7.6"/></svg>`;

const load = (key, fallback = '') => {
  try { return localStorage.getItem(`ctr-online.${key}`) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(`ctr-online.${key}`, value); } catch { /* private mode : not remembered */ }
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** @param {object} Module - the game's Emscripten module */
export function attach(Module) {
  const T = /^fr\b/i.test(navigator.language ?? '') ? STRINGS.fr : STRINGS.en;
  const query = new URLSearchParams(location.search);
  const net = createOnlineNet({ name: load('name', 'Player') });
  Module.ctrOnlineNet = net;
  const asGuest = location.hash.includes('room=');

  let link = null; // the parsed room link, once there is a room
  let linkText = '';
  let error = '';
  let codeOut = null; // { to, blob } : the copy-paste code to send

  document.head.append(el('style', { textContent: CSS }));
  const panel = el('aside', { id: 'online' });
  const toggle = el('button', { id: 'online-toggle', type: 'button', title: T.open, innerHTML: ICON });
  // The page's Settings (web/ui, session 12) when it is there : this panel becomes its « Online »
  // tab (no sidebar, no round button of its own) and the player name is the Settings one.
  const ui = globalThis.ctrUI;
  const tab = ui ? ui.adopt('online', T.title, panel) : null;
  if (!tab) document.body.append(panel, toggle);
  // keys typed in the panel are not the game's
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  panel.addEventListener('keyup', (e) => e.stopPropagation());

  // ---- open / closed ----
  const setOpen = (open) => {
    save('panel', open ? 'open' : 'closed');
    if (tab) return open ? tab.open() : tab.close();
    panel.classList.toggle('closed', !open);
    toggle.classList.toggle('hidden', open);
    document.body.style.paddingRight = open ? `${WIDTH}px` : '';
  };
  // The closed button : invisible while the mouse rests, brighter as it approaches, opaque on it.
  let lastMove = 0;
  const fade = (x, y) => {
    if (toggle.classList.contains('hidden')) return;
    const r = toggle.getBoundingClientRect();
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    const near = d === 0 ? 1 : Math.max(0, 1 - d / 240) * 0.85;
    const recent = Date.now() - lastMove < 2500 ? 0.2 : 0;
    toggle.style.opacity = String(Math.max(near, recent));
  };
  let pointer = { x: -1e4, y: -1e4 };
  document.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    lastMove = Date.now();
    fade(pointer.x, pointer.y);
  });
  setInterval(() => fade(pointer.x, pointer.y), 500); // fades out once the mouse rests
  toggle.addEventListener('click', () => setOpen(true));

  // ---- name ----
  const name = el('input', { type: 'text', maxLength: NAME_LEN, value: net.name, id: 'online-name', autocomplete: 'off' });
  name.addEventListener('input', () => { net.name = name.value || 'Player'; save('name', name.value); });
  if (ui) {
    // one name : Settings › Player owns it (same key, ctr-online.name) ; this field stays for scripts
    name.addEventListener('input', () => ui.settings.patch({ name: name.value }));
    ui.settings.subscribe((v) => {
      net.name = v.name || 'Player';
      if (name.value !== v.name) name.value = v.name;
    });
  }

  // ---- host ----
  const points = (load('points', 'relay') || 'relay').split(',');
  const meet = (id, label, help, extra) => {
    const box = el('input', { type: 'checkbox', id: `online-meet-${id}`, checked: points.includes(id) });
    return { id, box, node: el('div', { className: 'opt' }, el('label', {}, box, ' ', label), el('div', { className: 'help' }, help), ...(extra ? [extra] : [])) };
  };
  const relay = el('input', { type: 'text', id: 'online-relay', value: query.get('relay') ?? load('relay', DEFAULT_RELAY) });
  const rk = el('input', { type: 'password', id: 'online-rk', value: query.get('rk') ?? load('rk'), autocomplete: 'off' });
  const meets = [
    meet('relay', T.relay, T.relayHelp, el('div', { className: 'sub' }, el('label', {}, T.relayUrl, relay), el('label', {}, T.relayKey, rk))),
    meet('mqtt', T.mqtt, T.mqttHelp),
    meet('paste', T.paste, T.pasteHelp),
  ];
  const createButton = el('button', { type: 'button', id: 'online-host', textContent: T.create });
  const linkBox = el('input', { type: 'text', id: 'online-link', readOnly: true });
  const copyButton = el('button', { type: 'button', id: 'online-copy', textContent: T.copy });
  const linkRow = el('div', {}, el('label', {}, T.link), el('div', { className: 'row' }, linkBox, copyButton));
  const hostBox = el('section', { id: 'online-host-box' },
    el('h3', {}, T.hostTitle),
    el('div', { className: 'help wide' }, T.meet),
    el('div', { className: 'help wide' }, T.meetHelp),
    ...meets.map((m) => m.node),
    createButton, linkRow);

  // ---- join ----
  const joinInput = el('input', { type: 'text', id: 'online-join-link', placeholder: T.joinPlaceholder });
  const joinButton = el('button', { type: 'button', id: 'online-join', textContent: T.join });
  const savedPath = load('path', 'auto');
  const pathAuto = el('input', { type: 'radio', name: 'online-path', id: 'online-path-auto', checked: savedPath !== 'relay' });
  const pathRelay = el('input', { type: 'radio', name: 'online-path', id: 'online-path-relay', checked: savedPath === 'relay' });
  const joinBox = el('section', { id: 'online-join-box' },
    el('h3', {}, T.joinTitle),
    el('div', { className: 'row' }, joinInput, joinButton),
    el('div', { className: 'help wide' }, T.path),
    el('label', {}, pathAuto, ' ', T.pathAuto),
    el('label', {}, pathRelay, ' ', T.pathRelay),
    el('div', { className: 'help wide' }, T.pathHelp));

  // ---- copy-paste codes ----
  const codeOutLabel = el('label', {});
  const codeOutBox = el('textarea', { id: 'online-code-out', readOnly: true });
  const codeOutCopy = el('button', { type: 'button', textContent: T.copy });
  const codeInBox = el('textarea', { id: 'online-code-in' });
  const codeInButton = el('button', { type: 'button', id: 'online-code-use', textContent: T.useCode });
  const codeBox = el('section', { id: 'online-codes' },
    codeOutLabel, codeOutBox, codeOutCopy,
    el('label', {}, T.codeIn), codeInBox, codeInButton);

  // ---- status ----
  const roomLine = el('div', { id: 'online-room' });
  const status = el('div', { className: 'status', id: 'online-status' });
  const errorLine = el('div', { className: 'error', id: 'online-error' });
  const hideButton = el('button', { type: 'button', id: 'online-hide', textContent: T.hide });

  panel.append(
    el('header', {}, el('h2', {}, T.title), hideButton),
    el('label', { hidden: !!ui }, T.name, name),
    hostBox, joinBox, codeBox,
    roomLine, status, errorLine,
    el('div', { className: 'hint' }, T.hint));
  hideButton.addEventListener('click', () => setOpen(false));

  const explain = (e) => T.errors[e?.code] ?? `${e?.code ? `${e.code} : ` : ''}${e?.message ?? e}`;
  const fail = (e) => { error = explain(e); render(); };

  async function host() {
    if (net.room) return;
    error = '';
    const chosen = meets.filter((m) => m.box.checked).map((m) => m.id);
    save('points', chosen.join(','));
    save('relay', relay.value);
    save('rk', rk.value);
    if (!chosen.length) return fail(T.noMeet);
    if (chosen.includes('relay') && !relay.value.trim()) return fail(T.noRelayUrl);
    try {
      link = newRoom({ relay: chosen.includes('relay') ? relay.value.trim() : '', rk: chosen.includes('relay') ? rk.value.trim() : '', signaling: chosen });
      // the relay key may have come in the query : it only travels after # (ROLLOUT, private relays)
      const base = new URL(location.href);
      base.searchParams.delete('relay');
      base.searchParams.delete('rk');
      linkText = formatRoomLink(base.href, link);
      const room = await openRoom({ link, role: 'host', name: net.name });
      room.on('link', render);
      room.on('linkclose', render);
      room.on('warning', (w) => fail(w));
      room.on('blob', (b) => { codeOut = b; render(); });
      room.on('close', () => fail({ code: 'relay' }));
      net.host(room);
    } catch (e) {
      link = null;
      fail(e);
    }
    render();
  }

  // A guest's room : opened at once from the page's link, and its link to the host started at
  // once ; reopened when the connection setting changes before the game is connected.
  async function guest() {
    error = '';
    codeOut = null;
    try {
      link = parseRoomLink(location.hash);
      linkText = location.href;
      net.reset();
      net.room?.close();
      const room = await openRoom({ link, role: 'guest', mode: pathRelay.checked ? 'ws' : 'auto', name: net.name, rtcTimeoutMs: 5000 });
      room.on('link', render);
      room.on('linkclose', render);
      room.on('warning', (w) => { if (w.code !== 'no-webrtc') fail(w); });
      room.on('blob', (b) => { codeOut = b; render(); });
      net.guest(room);
      net.preconnect();
    } catch (e) {
      fail(e);
    }
    render();
  }

  createButton.addEventListener('click', host);
  copyButton.addEventListener('click', () => navigator.clipboard?.writeText(linkText));
  codeOutCopy.addEventListener('click', () => navigator.clipboard?.writeText(codeOutBox.value));
  codeInButton.addEventListener('click', async () => {
    error = '';
    try { await net.room.paste(codeInBox.value.trim()); codeInBox.value = ''; } catch (e) { fail(e); }
    render();
  });
  joinButton.addEventListener('click', () => {
    const text = joinInput.value.trim();
    if (!text.includes('#')) return fail({ code: 'link' });
    try { parseRoomLink(text); } catch (e) { return fail(e); }
    location.hash = text.slice(text.indexOf('#') + 1);
    location.reload();
  });
  const onPath = () => {
    save('path', pathRelay.checked ? 'relay' : 'auto');
    const inGame = (Module.ctrOnlineOctr?.().CurrState ?? 0) >= 2;
    if (net.role === 'guest' && !inGame) guest();
    render();
  };
  pathAuto.addEventListener('change', onPath);
  pathRelay.addEventListener('change', onPath);

  function links() {
    if (net.role === 'host') {
      const out = [];
      for (const peer in net.links) {
        const l = net.links[peer];
        out.push({ peer: Number(peer), peerId: l.peerId, path: l.path, backend: l.backend, signaling: l.signaling });
      }
      return out;
    }
    const l = net.hostLink;
    return l ? [{ peer: -1, peerId: l.peerId, path: l.path, backend: l.backend, signaling: l.signaling }] : [];
  }

  const say = (l) => [T.paths[l.path] ?? l.path, T.meets[l.signaling] ?? l.signaling];

  function render() {
    const room = net.room;
    hostBox.style.display = net.role === 'guest' || asGuest ? 'none' : '';
    joinBox.style.display = net.role === 'host' ? 'none' : '';
    for (const m of meets) m.box.disabled = !!room;
    relay.disabled = rk.disabled = createButton.disabled = !!room;
    linkRow.style.display = room && net.role === 'host' ? '' : 'none';
    linkBox.value = linkText;
    codeBox.style.display = codeOut || link?.signaling?.includes('paste') ? '' : 'none';
    codeOutLabel.textContent = T.codeOut(net.role === 'host' ? T.aGuest : T.theHost);
    codeOutBox.value = codeOut?.blob ?? '';
    for (const node of [codeOutLabel, codeOutBox, codeOutCopy]) node.style.display = codeOut ? '' : 'none';
    roomLine.textContent = room ? (net.role === 'host' ? T.hosting(link?.room ?? '') : T.guestOf(link?.room ?? '')) : '';
    const list = links();
    const octr = Module.ctrOnlineOctr?.();
    const lines = [];
    if (net.role === 'host') lines.push(list.length ? list.map((l) => T.player(l.peer + 1, ...say(l))).join('\n') : T.waiting);
    if (net.role === 'guest') lines.push(net.hostLink ? T.toHost(...say(list[0])) : net.pending ? T.connecting : T.notConnected);
    if (octr && octr.CurrState >= 0) lines.push(T.game(T.states[octr.CurrState] ?? octr.CurrState));
    status.textContent = lines.join('\n');
    errorLine.textContent = error || (net.lastError ? explain(net.lastError) : '');
  }
  setInterval(render, 500);

  // The server menu (Europe, USA… Private Room) asks a question the page already answered :
  // once there is a room, Private Room is picked for the player, every 3 s at most (a guest
  // whose host is not there yet goes back to that menu after the bridge's attempts).
  let lastPick = 0;
  setInterval(() => {
    if (!net.room || Date.now() - lastPick < 3000) return;
    if (Module.ctrOnlinePickPrivateRoom?.()) lastPick = Date.now();
  }, 250);

  window.__ctrOnline = {
    state() {
      return {
        role: net.role,
        room: link?.room ?? null,
        link: linkText,
        signaling: link?.signaling ?? null,
        backend: net.room?.backend ?? null,
        links: links(),
        queue: net.queue.length,
        stats: net.stats,
        lastError: net.lastError ? { code: net.lastError.code, message: net.lastError.message } : null,
        error,
        octr: Module.ctrOnlineOctr?.() ?? null,
        karts: Module.ctrOnlineKarts?.() ?? null,
      };
    },
    host,
  };

  // The controls, once, in the page's log under the canvas and in the browser's console.
  for (const line of T.controls) Module.print?.(line);

  setOpen(load('panel', 'open') !== 'closed');
  if (asGuest) guest();
  render();
}
