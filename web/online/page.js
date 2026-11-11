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
// as soon as the room opens. The player name is read when the game connects. Strings follow the
// browser's language (French or English).
//
// One build (session 14) : the game plays solo until a room is here. Hosting a room shares this
// game's screen and takes the guests' pads as P2–P4 (web/share, on the same room : the lobby is
// the game's own ONLINE → VS / BATTLE menus), and asks the game to join (Module.ctrOnlineControl).
// A guest's game joins the same way ; while the host is in its menus the guest sees the host's
// screen over its own game and its keys and pad go to the host. At the host's track lock each
// guest gets the character it locked there (Share's LOBBY message) and every game loads its own
// race through OnlineCTR's protocol. Module.ctrOnlineLobby() is the game's side of it.
//
// Debug getter : `window.__ctrOnline.state()` — octr as the bridge sees it, the room, its links,
// per-slot kart samples, message counts ; tests read it instead of pixels (never `window.__ctr`,
// which is T3's).
import { CODE_MAX, CODE_MIN, ROOM_KIND, codeNames, codeRoom, codeText, parseCode, randomCode, roomFromCode } from '../net/code.js';
import { b64u, randomBytes } from '../net/crypto.js';
import { formatRoomLink, newRoom, parseRoomLink } from '../net/link.js';
import { openRoom, peersOf } from '../net/room.js';
import { probeRelay } from '../net/signaling.js';
import { createShareGuest } from '../share/guest.js';
import { gateGuest, gateHost } from '../net/admit.js';
import { TAG, encodeControl, nameOf, pickPad } from '../share/protocol.js';
import { createOnlineNet } from './net.js';
import { END_AFTER_CHOICES, END_AFTER_DEFAULT, createEndTimer, letIn, openFreeRoom, rejoinLoop, roomTag } from './rules.js';

/** enum OnlineLobbyPhase (game/OnlineCTR/native_compat.h) */
export const PHASE = { none: 0, menus: 1, starting: 2, race: 3 };
/** enum NativeOnlineControl (platform/native_online.h) */
export const CTL = { enter: 1, leave: 2, character: 3, endRace: 4, endBots: 5, slotGone: 6 };
/** enum OnlineState (game/OnlineCTR/global.h), the few the page reads */
const ST = { pickRoom: 2, assignRole: 4, waitForRace: 10, endRace: 12 };
/**
 * What the game's NETPLAY screens read (NativeWeb_NetplayStatus, game/230/MM_MenuFlow.c) : the
 * room a mode or JOIN asked for — on its way, waiting for the host's yes, there, or why not.
 */
export const NP = { idle: 0, busy: 1, waiting: 2, room: 3, noKey: 10, keyRefused: 11, offline: 12, noRoom: 13, full: 14, refused: 15 };
const NP_OF = { 'relay-key': NP.keyRefused, absent: NP.noRoom, 'room-full': NP.full, full: NP.full, refused: NP.refused };
/** The page's one OnlineCTR room (OnlineExternal_State) ; SG_ROOMS adds 8 to a locked room's count. */
const ROOM = 5;

const DEFAULT_RELAY = 'wss://ctr-relay.suuuper.app';
const NAME_LEN = 9; // game/OnlineCTR/global.h
const WIDTH = 300; // the sidebar, CSS px

const STRINGS = {
  en: {
    title: 'Netplay',
    hide: 'Hide',
    open: 'Netplay',
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
    copied: 'Copied',
    copyFailed: 'Select the link and copy it (Cmd-C).',
    checking: 'Checking the relay…',
    relayChecks: { ok: '✓ The relay accepts this key.', key: '✗ The relay refused this key.', unreachable: '✗ The relay does not answer.' },
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
    askingHost: 'Waiting for the host to let you in…',
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
      '  Enter = Start (pause)            Space = Select (INVITE in a room\'s menus ; leaves the room in its race)',
      '  A gamepad works as is (standard mapping). F4 moves the keyboard to the next player.',
    ],
    leave: 'Leave the room',
    hostHint: 'Netplay : every player runs their own copy of the game — each one needs their own disc (CTR, NTSC-U) and opens the room link you send. Create the room and send the link. Then, in the game : NETPLAY → VS, BATTLE or ARCADE (bots fill the race up to 8 karts). The others play P2–P4 on your screen ; at the track lock everyone races on their own screen.',
    guestHint: 'Netplay needs your own copy of the game (your CTR disc, NTSC-U) : open the host\'s room link here. Once in the room, the host\'s screen shows here while it picks : press Cross to join, pick your character with your own keys or pad. The race then runs on your own screen.',
    lobby: ['', 'In the host\'s menus', 'Starting the race', 'Racing'],
    inRoom: (list) => `In the room : ${list}`,
    noPicture: 'No direct path to the host : your pad plays, the host\'s screen is not shown.',
    hostLeft: 'The host left the room.',
    hostLeftSolo: 'The host left — you finish this race alone, the other karts are now driven by the computer.',
    roomOpen: 'Room open.',
    roomOpenCopied: 'Room open — the link is copied.',
    roomCode: (names) => `Code : ${names} (NETPLAY › JOIN).`,
    linkCopied: 'Invite link copied.',
    sendLink: 'Send it to the other players. Click here to copy it again ; it is also in Settings › Netplay.',
    clickToCopy: 'Click here to copy the link ; it is also in Settings › Netplay.',
    roomClosed: 'The room is closed (the host left).',
    joiningRoom: 'Joining the new room…',
    hostLost: 'Connection to the host lost.',
    backToSolo: 'Your game is back to solo.',
    reconnecting: 'Reconnecting…',
    reconnectTry: (n) => `Reconnecting to the host (try ${n})…`,
    reconnected: 'Reconnected to the host.',
    noReconnect: 'Could not reconnect to the host.',
    roomRacing: 'The room is racing.',
    nextLobby: 'You join at the next lobby, when this race ends.',
    endAfter: 'End the race after the first finisher',
    endAfterOff: 'never (wait for everyone)',
    seconds: (n) => `${n} s`,
    endIn: (n) => `The race ends in ${n} s.`,
    endInDetail: 'A player finished : the others have that long.',
    endedByTimeout: 'Time is up : your race is over.',
    botTakesOver: (name) => `${name || 'A player'} left : a bot finishes their race.`,
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
      'relay-key': 'The relay refused the key : check it in Settings › Netplay.',
      'room-full': 'The room is full.',
      refused: 'The host did not let you in.',
      'relay-silent': (e) => `The relay does not answer (${e.url}).`,
      paste: 'This room has no copy-paste meeting point.',
    },
  },
  fr: {
    title: 'Netplay',
    hide: 'Masquer',
    open: 'Netplay',
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
      '  Entrée = Start (pause)            Espace = Select (INVITE dans les menus d\'une partie ; quitte la partie en course)',
      '  Une manette marche telle quelle (mapping standard). F4 passe le clavier au joueur suivant.',
    ],
    leave: 'Quitter la partie',
    hostHint: 'Netplay : chaque joueur fait tourner son propre jeu — chacun a besoin de son propre disque (CTR, NTSC-U) et ouvre le lien de la partie que tu envoies. Crée la partie et envoie le lien. Puis, dans le jeu : NETPLAY → VS, BATTLE ou ARCADE (des bots complètent la course jusqu’à 8 karts). Les autres jouent P2–P4 sur ton écran ; au choix du circuit, chacun court sur son propre écran.',
    guestHint: 'Le Netplay demande ton propre jeu (ton disque CTR, NTSC-U) : ouvre ici le lien de la partie de l\'hôte. Une fois dans la partie, l\'écran de l\'hôte s\'affiche ici pendant qu\'il choisit : appuie sur Croix pour entrer, choisis ton perso avec tes touches ou ta manette. La course tourne ensuite sur ton écran.',
    lobby: ['', 'Dans les menus de l\'hôte', 'Lancement de la course', 'Course'],
    inRoom: (list) => `Dans la partie : ${list}`,
    noPicture: 'Pas de chemin direct vers l\'hôte : ta manette joue, l\'écran de l\'hôte n\'est pas affiché.',
    hostLeft: 'L\'hôte a quitté la partie.',
    hostLeftSolo: 'L\'hôte est parti — tu finis cette course seul, l\'ordinateur conduit les autres karts.',
    roomOpen: 'Partie ouverte.',
    roomOpenCopied: 'Partie ouverte — le lien est copié.',
    sendLink: 'Envoie-le aux autres joueurs. Clique ici pour le recopier ; il est aussi dans Réglages › Netplay.',
    clickToCopy: 'Clique ici pour copier le lien ; il est aussi dans Réglages › Netplay.',
    roomClosed: 'La partie est fermée (l\'hôte est parti).',
    joiningRoom: 'Connexion à la nouvelle partie…',
    hostLost: 'Connexion à l\'hôte perdue.',
    backToSolo: 'Ton jeu repasse en solo.',
    reconnecting: 'Reconnexion…',
    reconnectTry: (n) => `Reconnexion à l'hôte (essai ${n})…`,
    reconnected: 'Reconnecté à l\'hôte.',
    noReconnect: 'Impossible de se reconnecter à l\'hôte.',
    roomRacing: 'La partie est en pleine course.',
    nextLobby: 'Tu la rejoins au prochain salon, à la fin de cette course.',
    endAfter: 'Finir la course après le premier arrivé',
    endAfterOff: 'jamais (attendre tout le monde)',
    seconds: (n) => `${n} s`,
    endIn: (n) => `La course se termine dans ${n} s.`,
    endInDetail: 'Un joueur a fini : les autres ont ce temps-là.',
    endedByTimeout: 'Temps écoulé : ta course est terminée.',
    botTakesOver: (name) => `${name || 'Un joueur'} est parti : un bot finit sa course.`,
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
      'relay-key': 'Le relais a refusé la clé : vérifie-la dans Réglages › Netplay.',
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
#online .check { color: #888; }
#online .check:empty { display: none; }
#online .check.ok { color: #6c6; }
#online .check.key, #online .check.unreachable { color: #f66; }
#online .hint { color: #888; margin-top: 10px; }
#online-toggle { position: fixed; top: 40px; right: 10px; z-index: 16; width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid #555; background: #111; color: #ddd; cursor: pointer; padding: 0; opacity: 0;
  transition: opacity 150ms linear; display: flex; align-items: center; justify-content: center; }
#online-toggle.hidden { display: none; }
#online-lobby { position: fixed; inset: 0; width: 100vw; height: 100vh; object-fit: contain; background: #000; z-index: 5; pointer-events: none; }
#online-lobby.hidden { display: none; }
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
  // English for everyone for now (the user, 2026-11-04) ; STRINGS.fr is kept for later
  const T = STRINGS.en;
  const query = new URLSearchParams(location.search);
  const net = createOnlineNet({ name: globalThis.ctrUI?.settings.get().name || load('name', 'Player') });
  Module.ctrOnlineNet = net;
  let asGuest = location.hash.includes('room=');

  let link = null; // the parsed room link, once there is a room
  let linkText = '';
  let error = '';
  let codeOut = null; // { to, blob } : the copy-paste code to send
  let shareGuest = null; // guest : the host's screen and our pad (web/share/guest.js)
  let shareHost = null; // host : the lobby shared (web/share/panel.js's host)
  let startSent = false; // host : the characters of this race start went out
  const held = Object.create(null); // guest : the keys down, for the pad sent to the host
  const lobbyVideo = el('video', { id: 'online-lobby', className: 'hidden', autoplay: true, playsInline: true });
  const lobbyStream = new MediaStream();
  const lobby = () => Module.ctrOnlineLobby?.() ?? { active: false, phase: PHASE.none, characters: [] };

  document.head.append(el('style', { textContent: CSS }));
  document.body.append(lobbyVideo);
  const panel = el('aside', { id: 'online' });
  const toggle = el('button', { id: 'online-toggle', type: 'button', title: T.open, innerHTML: ICON });
  // The page's Settings (web/ui, session 12) when it is there : this panel becomes its « Online »
  // tab (no sidebar, no round button of its own) and the player name is the Settings one.
  const ui = globalThis.ctrUI;
  const tab = ui ? ui.adopt('online', T.title, panel) : null;
  if (!tab) document.body.append(panel, toggle);
  // the main menu's NETPLAY row, picked with no room (game/230/MM_MenuFlow.c) : a room at once
  // with the saved relay and key (session 32), its link in a toast ; none saved : 0, the game
  // says why and its OPEN brings this panel
  let hosting = false; // a room on its way : a second mode picked or Create room opens no other
  let np = NP.idle; // the game's NETPLAY screens : the room they asked for (session 28)
  let gate = null; // host : the room's door (./admit.js)
  let hostError = null; // host() : why the room did not open
  let codeGen = 0; // JOIN by code : a newer code, or its Triangle, drops the one on its way
  // a code typed on the home page before the game started (web/ui lib/join.js, 28b) : `#c=`,
  // joined at boot behind the joining card ; what fails goes back to the home page's dials
  let bootCode = asGuest ? null : new URLSearchParams(location.hash.slice(1)).get('c');
  const shareDoor = () => globalThis.ctrShareApi?.door?.() ?? null;
  let codeLength = CODE_MIN; // the characters of a new room's code (config.json)
  fetch(new URL('./config.json', import.meta.url)).then((r) => r.json()).then((config) => {
    const n = Number(config?.codeLength);
    if (Number.isInteger(n)) codeLength = Math.min(CODE_MAX, Math.max(CODE_MIN, n));
  }).catch(() => { /* no file : the shortest code */ });
  // this browser, for a host's « already let in » (a guest coming back is not asked for again)
  let me = load('me');
  if (!me) save('me', me = b64u.encode(randomBytes(12)));
  if (Module.ctrInput) {
    Module.ctrInput.openMultiplayer = () => setOpen(true);
    // back on the main menu after a room (Triangle up, a host's QUIT before a room's race) : out
    // of it (32e) ; a guest's QUIT keeps it (32f) : that guest watches, then comes back
    Module.ctrInput.leaveRoom = () => {
      if (hosting) return;
      if (net.room && !away) leave();
      np = NP.idle;
    };
    // a guest's QUIT mid-race (game/MAIN/MainFreeze.c, 32f) : out of the race, not of the room
    Module.ctrInput.roomQuit = () => {
      if (net.role !== 'guest' || !net.room || away) return;
      goAway('quit');
      rejoin({ quiet: true });
    };
    // the room, top right on the game's menus (32f) : its code's characters (28), or with no
    // code (a room without the relay) the tag of its id
    Module.ctrInput.roomTag = () => (link?.code ? '' : roomTag(link?.room ?? ''));
    Module.ctrInput.roomCode = () => link?.code ?? shareDoor()?.code ?? '';
    // a Share room this page hosts under a code (web/share/panel.js, 28b) : the game shows its
    // tag, INVITE and its door as a Netplay room's
    Module.ctrInput.shareHost = () => (!link && shareDoor() ? 1 : 0);
    // NETPLAY > VS, BATTLE or ARCADE picked with no room (session 28) : this player hosts one, on
    // the relay and key of Settings ; 0 with no key, the game says why
    Module.ctrInput.netplayHost = () => {
      // a room the game left on its own (the pause menu's QUIT mid-race) : closed, a new one
      if (net.room && !hosting && !lobby().active) leave();
      if (net.room && net.role !== 'host') leave();
      if (net.room || hosting) return 1;
      if (!haveKey()) return 0;
      const relayBox = meets.find((m) => m.id === 'relay').box;
      relayBox.checked = true;
      np = NP.busy;
      hostAndTell();
      return 1;
    };
    Module.ctrInput.netplayStatus = () => np;
    // NETPLAY > JOIN, its dials set (one hex digit per character) : 0 with no key
    Module.ctrInput.netplayJoin = (text) => {
      if (!haveKey()) return 0;
      joinByCode(parseCode(text));
      return 1;
    };
    // INVITE (pad Select on the room's menus) : the link copied, the game shows the code
    Module.ctrInput.invite = () => (link ? inviteCopy() : shareDoor()?.invite());
    // a guest who typed the code waits at the door : its name for the game's box, and the answer
    Module.ctrInput.askName = () => (gate ?? shareDoor())?.asking()?.name ?? '';
    Module.ctrInput.askAnswer = (yes) => (gate ?? shareDoor())?.answer(!!yes);
  }
  // the boot screen's « Joining the room… » (a room link at boot, session 32e) : its Back
  if (ui) ui.onJoinBack = () => { asGuest = false; leave(); };
  // the watching band's Back (32f) : out of the room for good, the player's own main menu
  if (ui) ui.onWaitBack = () => leave();
  // keys typed in the panel are not the game's
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  panel.addEventListener('keyup', (e) => e.stopPropagation());

  // ---- open / closed ----
  const setOpen = (open) => {
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
  // the relay and its key tried on leaving either field (no room opened) : only the last try shows
  const relayCheck = el('div', { className: 'check', id: 'online-relay-check', role: 'status' });
  let checked = '';
  let checkGen = 0;
  const checkRelay = () => {
    const url = relay.value.trim();
    const key = rk.value.trim();
    if (relay.disabled || `${url}\n${key}` === checked) return;
    checked = `${url}\n${key}`;
    const gen = ++checkGen;
    relayCheck.className = 'check';
    relayCheck.textContent = url ? T.checking : '';
    if (url) probeRelay(url, key).then((result) => {
      if (gen !== checkGen) return;
      if (result === 'unreachable') checked = ''; // tried again on the next focus out (a relay started since)
      relayCheck.className = `check ${result}`;
      relayCheck.textContent = T.relayChecks[result];
    });
  };
  relay.addEventListener('focusout', checkRelay);
  rk.addEventListener('focusout', checkRelay);
  // typed once, kept by the browser (the game's NETPLAY menu reads them, no Create room needed)
  relay.addEventListener('input', () => save('relay', relay.value));
  rk.addEventListener('input', () => save('rk', rk.value));
  const haveKey = () => {
    if (relay.value.trim() && rk.value.trim()) return true;
    np = NP.noKey;
    return false;
  };
  const meets = [
    meet('relay', T.relay, T.relayHelp, el('div', { className: 'sub' }, el('label', {}, T.relayUrl, relay), el('label', {}, T.relayKey, rk), relayCheck)),
    meet('mqtt', T.mqtt, T.mqttHelp),
    meet('paste', T.paste, T.pasteHelp),
  ];
  const createButton = el('button', { type: 'button', id: 'online-host', textContent: T.create });
  const linkBox = el('input', { type: 'text', id: 'online-link', readOnly: true });
  const copyButton = el('button', { type: 'button', id: 'online-copy', textContent: T.copy });
  const linkRow = el('div', {}, el('label', {}, T.link), el('div', { className: 'row' }, linkBox, copyButton));
  // the end-of-race timeout (session 11b) : the host's rule, changeable any time
  const savedEndAfter = Number(load('endAfter', String(END_AFTER_DEFAULT)));
  const endAfter = el('select', { id: 'online-end-after' },
    ...END_AFTER_CHOICES.map((n) => el('option', { value: String(n), textContent: n ? T.seconds(n) : T.endAfterOff, selected: n === savedEndAfter })));
  endAfter.addEventListener('change', () => save('endAfter', endAfter.value));
  const hostBox = el('section', { id: 'online-host-box' },
    el('h3', {}, T.hostTitle),
    el('div', { className: 'help wide' }, T.meet),
    el('div', { className: 'help wide' }, T.meetHelp),
    ...meets.map((m) => m.node),
    createButton, linkRow,
    el('label', {}, T.endAfter, ' ', endAfter));

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
  const leaveButton = el('button', { type: 'button', id: 'online-leave', textContent: T.leave });
  const hint = el('div', { className: 'hint' });

  panel.append(
    el('header', {}, el('h2', {}, T.title), hideButton),
    el('label', { hidden: !!ui }, T.name, name),
    hostBox, joinBox, codeBox,
    roomLine, status, errorLine, leaveButton,
    hint);
  hideButton.addEventListener('click', () => setOpen(false));
  leaveButton.addEventListener('click', () => leave());

  const explain = (e) => {
    const text = T.errors[e?.code];
    if (typeof text === 'function') return text(e);
    return text ?? `${e?.code ? `${e.code} : ` : ''}${e?.message ?? e}`;
  };
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
    hostError = null;
    try {
      const room = chosen.includes('relay') ? await openCodeRoom(chosen) : await openRoom({ link: link = newRoom({ signaling: chosen }), role: 'host', name: ROOM_KIND.netplay });
      // the relay key may have come in the query : it only travels after # (ROLLOUT, private relays)
      const base = new URL(location.href);
      base.searchParams.delete('relay');
      base.searchParams.delete('rk');
      linkText = formatRoomLink(base.href, link);
      room.on('link', render);
      room.on('linkclose', render);
      room.on('warning', (w) => fail(w));
      room.on('blob', (b) => { codeOut = b; render(); });
      room.on('close', () => fail({ code: 'relay' }));
      // the door : the game's server and the lobby share only see a guest once it is let in
      gate = gateHost(room, { pass: link.pass, onChange: knocked });
      net.host(gate);
      // the lobby : this game's screen to the guests, their pads as P2–P4, on the same room
      const share = globalThis.ctrShareApi;
      if (share) shareHost = await share.startOn(gate, { relayGuests: true, by: 'online' });
      // a guest leaving : the ones above it moved down a slot (web/share/slots.js compact), and the
      // character select moves their picks with them (session 32e)
      shareHost?.on('leave', (g) => { if (lobby().phase === PHASE.menus) Module.ctrOnlineControl?.(CTL.slotGone, g.slot); });
      // a guest's page that (re)connects gets the room info at once : a Cup under way keeps a
      // guest coming back out until it ends (32f)
      shareHost?.on('listen', (g) => {
        const info = Module.ctrOnlineRoom?.();
        if (info) g.link.send(encodeControl(TAG.lobby, { phase: lobby().phase, room: info }), { reliable: true });
      });
      Module.ctrOnlineControl?.(CTL.enter);
      np = NP.room;
    } catch (e) {
      link = null;
      hostError = e;
      fail(e);
    }
    render();
  }

  // A host's room under a fresh code (web/net/code.js), one no other host holds on this relay
  // (rules.js openFreeRoom : 3 characters, then 4, then 5)
  function openCodeRoom(chosen) {
    return openFreeRoom({
      length: codeLength,
      async open(length) {
        link = { ...(await codeRoom(randomCode(length), { relay: relay.value.trim(), rk: rk.value.trim() })), signaling: chosen };
        // the host's name on the relay is its room's kind (28b) : the home page reads it before a disc
        const room = await openRoom({ link, role: 'host', name: ROOM_KIND.netplay });
        const peers = await peersOf(room);
        return { room, taken: peers.some((p) => p.kind === 'host' && p.id !== room.selfId) };
      },
    });
  }

  // someone who typed the code waits at the door : the game's box asks on its menus ; mid-race
  // the game draws one line, the box comes with the menus (28b : nothing of it on the page)
  const knocked = () => render();

  /** INVITE in the game : the link copied when the browser allows it (a pad press is no gesture). */
  function inviteCopy() {
    if (!linkText) return;
    const names = link?.code ? T.roomCode(codeNames(parseCode(link.code))) : '';
    const write = navigator.clipboard?.writeText(linkText);
    const offer = () => ui?.toast(names || T.roomOpen, T.clickToCopy, '', { action: copyLink, ms: 10_000 });
    if (!write) return offer();
    write.then(() => ui?.toast(T.linkCopied, names), offer);
  }

  /** The clipboard refused : the text in `field` selected for the player's Cmd-C, and a toast saying so. */
  function selectForCopy(field) {
    ui?.toast(T.copyFailed);
    field.focus();
    field.select();
  }

  /** Copy : « Copied » on the button for 2 s ; refused, the text is selected for the player's Cmd-C. */
  function copyText(button, text, field) {
    const failed = () => selectForCopy(field);
    const write = navigator.clipboard?.writeText(text);
    if (!write) return failed();
    write.then(() => {
      button.textContent = T.copied;
      clearTimeout(button.copiedTimer);
      button.copiedTimer = setTimeout(() => { button.textContent = T.copy; }, 2000);
    }, failed);
  }

  /** NETPLAY's room and the panel's Create room : one at a time, and a toast either way. */
  function hostAndTell() {
    if (hosting || net.room) return;
    hosting = true;
    render();
    host().finally(() => { hosting = false; render(); }).then(() => {
      if (!net.room || !linkText) {
        if (np === NP.busy) np = NP_OF[hostError?.code] ?? NP.offline;
        return ui?.toast(error || T.errors.relay);
      }
      // a pad press is no user gesture : the clipboard often refuses it, a click on the toast is one
      const names = link?.code ? `${T.roomCode(codeNames(parseCode(link.code)))} ` : '';
      const tell = (title, detail) => ui?.toast(title, names + detail, '', { action: copyLink, ms: 10_000 });
      const write = navigator.clipboard?.writeText(linkText);
      if (!write) return tell(T.roomOpen, T.clickToCopy);
      write.then(() => tell(T.roomOpenCopied, T.sendLink), () => tell(T.roomOpen, T.clickToCopy));
    });
  }

  /** The « Room open » toast's click : the link copied ; refused, Settings › Netplay with the link selected. */
  function copyLink() {
    const refused = () => {
      setOpen(true);
      setTimeout(() => selectForCopy(linkBox), 300); // the panel's tab rendered first
    };
    const write = navigator.clipboard?.writeText(linkText);
    if (!write) return refused();
    write.then(() => ui?.toast(T.copied), refused);
  }

  // the host's pause for everyone (D12.9) ends here : a game frozen by it runs no netcode, so it
  // would never see the leave or the host's loss that follows
  const unfreeze = () => {
    const room = Module.ctrOnlineRoom?.();
    if (room?.paused) Module.ctrOnlineRoomSet?.({ ...room, paused: 0 });
  };

  /** Leaves the room : the game drops the mod, the lobby share stops, the room closes. */
  function leave() {
    unfreeze();
    joinGen++; // a guest() still opening its room drops it
    rejoinToken++;
    rejoinTry = 0;
    toldWaiting = false;
    solo = false;
    away = null;
    ui?.waiting?.(null);
    slotsGone.length = 0;
    hostPhase = PHASE.none;
    Module.ctrOnlineControl?.(CTL.leave);
    globalThis.ctrShareApi?.stopOn({ keepRoom: true });
    shareHost = null;
    gate = null;
    np = NP.idle;
    shareGuest?.close();
    shareGuest = null;
    for (const t of lobbyStream.getTracks()) lobbyStream.removeTrack(t);
    net.disconnect?.();
    net.room?.close();
    net.room = null;
    net.role = 'none';
    link = null;
    linkText = '';
    codeOut = null;
    setLobbyGuest(false);
    render();
  }

  // A guest's room : opened at once from the page's link, and its link to the host started at
  // once ; reopened when the connection setting changes before the game is connected.
  // Resolves once the room is open and the link started : null, or the error.
  // `byCode` : the room of a code typed in the game (joinByCode) instead of the page's link ; a
  // rejoin keeps the room the page is in.
  async function guest(byCode = null) {
    error = '';
    codeOut = null;
    try {
      const base = new URL(location.href);
      base.hash = '';
      link = byCode ?? link ?? parseRoomLink(location.hash);
      linkText = link.code ? formatRoomLink(base.href, link) : location.href;
      keepRelay(link);
      net.reset();
      net.room?.close();
      const gen = ++joinGen;
      const room = await openRoom({ link, role: 'guest', mode: pathRelay.checked ? 'ws' : 'auto', rtcTimeoutMs: 5000 });
      if (gen !== joinGen) { // left, or another link opened, while this room was opening
        room.close();
        return null;
      }
      // a code nobody hosts : said at once (the relay's answer lists who is there), no 5 s wait
      if (byCode && !(await peersOf(room)).some((p) => p.kind === 'host')) {
        room.close();
        throw Object.assign(new Error('no host under this code'), { code: 'absent' });
      }
      room.on('link', render);
      room.on('linkclose', render);
      room.on('warning', (w) => { if (w.code !== 'no-webrtc') fail(w); });
      room.on('blob', (b) => { codeOut = b; render(); });
      // the host's door (./admit.js) : the link's pass goes straight in, a typed code waits
      const door = gateGuest(room, { pass: link.pass, me, name: net.name, onWait: () => {
        if (np === NP.busy) np = NP.waiting;
        if (bootCode) ui?.joining?.({ state: 'waiting' });
        render();
      } });
      net.guest(door);
      net.preconnect();
      // a code typed in the game : its keys and its game stay its own until the host said yes
      // (lobbyTick lets it in) — its JOIN screen still needs Triangle
      if (!byCode) {
        setLobbyGuest(true); // before the game's ENTER is processed, the keys are the host's
        // a guest out of the race (32f) : its game comes in later, once the host's word allows it
        if (!away) Module.ctrOnlineControl?.(CTL.enter);
      }
      lobbyGuestOn(door).catch(fail).finally(render);
    } catch (e) {
      fail(e);
      ui?.joining?.({ state: 'failed', reason: error });
      render();
      return e;
    }
    render();
    return null;
  }

  // A room link's relay and key are kept when Settings has no key yet (the user, session 28) : one
  // click on an invite, and the game's JOIN and its modes work for good in this browser.
  function keepRelay(l) {
    if (!l.relay || !l.rk || rk.value.trim()) return;
    relay.value = l.relay;
    rk.value = l.rk;
    save('relay', l.relay);
    save('rk', l.rk);
  }

  // NETPLAY > JOIN (session 28) : the room of the characters on the dials, on Settings' relay
  // and key. The game reads how it goes (np) : busy, waiting for the host's yes, in — or why not.
  async function joinByCode(ids) {
    const gen = ++codeGen;
    if (net.room) leave();
    np = NP.busy;
    let e = null;
    try {
      if (!ids) throw Object.assign(new Error('not a code'), { code: 'absent' });
      const target = { ...(await roomFromCode(ids)), relay: relay.value.trim(), rk: rk.value.trim(), signaling: ['relay'], mqtt: [], code: codeText(ids), pass: '' };
      if (gen !== codeGen) return;
      e = await guest(target);
    } catch (thrown) {
      e = thrown;
    }
    if (gen !== codeGen || !e) return;
    leave();
    codeSaid(NP_OF[e.code] ?? NP.offline);
  }
  // why a code did not join : the game's JOIN reads it ; the home page's code goes back to its dials
  function codeSaid(status) {
    np = status;
    if (!bootCode) return;
    const code = bootCode;
    bootCode = null;
    ui?.joinSaid?.(code, status);
  }
  // its Triangle while the room is on its way, or while the host has not answered
  if (Module.ctrInput) Module.ctrInput.netplayCancel = () => {
    codeGen++;
    if (net.room && net.role === 'guest') leave();
    np = NP.idle;
  };

  // The link to the host closed or went silent past its timeout (web/online/net.js) : the game
  // already left the room (its bridge's DISCONNECTED, game/OnlineCTR/thread.c : back to the
  // title, solo), unless it was racing (below). A host no longer on the meeting point left : say
  // so and close the page's room.
  // A host still there means we lost it (session 11b) : rejoin on a fresh link — guest() opens
  // the room again, so a new relay id and sealer (web/net/crypto.js pins an id's first IV prefix),
  // WebRTC else the relay as the path setting says, the same name ; the game waits on its title
  // for the room's race to end (a locked room refuses the join, OnlineExternal_State retries).
  let rejoinToken = 0;
  let joinGen = 0; // guest()'s room opening, superseded by a leave or a newer join
  let rejoinTry = 0; // the attempt in flight, for the status line (0 : none)
  // Mid-race the game does not leave : it finishes the race alone (session 32, the bridge's
  // GoSolo), its room still active until the results have shown ; then (32f) the page looks for
  // the host again : still there, the guest comes back at its next lobby ; gone, the room closes.
  // A host still there (we lost it) : the game leaves the race now and rejoins, as before.
  let solo = false;
  // Session 32f : a guest out of the room's race — its QUIT ('quit'), its link lost ('lost') —
  // keeps the room : its link back (rejoin), the host's picture and the band meanwhile, its game
  // let in (CTL.enter) once the host's room info says no Cup (rules.js letIn) ; back in the room
  // at the next lobby. Back on the band leaves for good.
  let away = null;
  let entered = false; // its game told to come in
  let hostRoom = null; // the host's latest room info (D12.3), whatever our game's state
  let linkedAt = null; // when the link to the host came back
  let watchSent = null; // the share guest last told whether we watch, and what
  const goAway = (why) => {
    // our game's copy of the room info, while it holds a Cup (a guest never let in early by it ;
    // the host's word replaces it once the link is back)
    const mine = Module.ctrOnlineRoom?.();
    away = why;
    entered = false;
    hostRoom = mine?.cup ? mine : null;
    linkedAt = null;
    ui?.waiting?.({ cup: !!hostRoom?.cup });
  };
  const hostLeft = (why, detail = T.backToSolo) => {
    ui?.toast(why, detail);
    leave();
    error = detail ? `${why} ${detail}` : why;
    render();
  };
  net.onHostLost = () => {
    unfreeze();
    const room = net.room;
    setTimeout(() => {
      if (net.role !== 'guest' || net.room !== room) return;
      const hostThere = room.signaling?.peers?.some((p) => p.kind === 'host');
      if (!hostThere && lobby().active) {
        solo = true;
        ui?.toast(T.hostLeftSolo);
        error = T.hostLeftSolo;
        return render();
      }
      if (!hostThere) return hostLeft(T.hostLeft);
      Module.ctrOnlineControl?.(CTL.leave); // a race this game was finishing alone
      ui?.toast(T.hostLost, T.reconnecting);
      goAway(away ?? 'lost'); // its game out again, not let in yet
      rejoin();
    }, 1000); // the meeting point's peer list catches up with a host that just left
  };
  // `quiet` : no « lost » line nor « reconnected » toast (the player's own QUIT) ; `gone` : what
  // to say when the host is not on the meeting point any more
  async function rejoin({ quiet = false, gone = [T.hostLeft] } = {}) {
    const token = ++rejoinToken;
    if (!quiet) error = `${T.hostLost} ${T.reconnecting}`;
    render();
    const result = await rejoinLoop({
      cancelled: () => token !== rejoinToken,
      onAttempt: (n) => { rejoinTry = n; render(); },
      async attempt() {
        const e = await guest();
        if (e) return e.code === 'absent' ? 'gone' : 'retry';
        const room = net.room;
        for (let i = 0; i < 300; i++) { // 30 s : WebRTC's 5 s, then the relay
          if (net.room !== room || token !== rejoinToken) return 'retry';
          if (net.hostLink) return 'ok';
          if (net.lastError) return net.lastError.code === 'absent' ? 'gone' : 'retry';
          await new Promise((r) => setTimeout(r, 100));
        }
        return 'retry';
      },
    });
    if (token !== rejoinToken) return;
    rejoinTry = 0;
    if (result === 'ok') {
      error = '';
      if (!quiet) ui?.toast(T.reconnected);
    } else if (result === 'gone') hostLeft(...gone);
    else hostLeft(T.noReconnect);
    render();
  }

  // The host's screen and our pad ride the game's own link to the host (web/share/guest.js) ;
  // ?bot : a scripted guest (web/online/bot.sh) asks a debug host for its kart as Share's bot does.
  async function lobbyGuestOn(room) {
    // a minute for the link ; as long as it takes while the host has not answered at its door
    for (let i = 0; (i < 600 || np === NP.waiting) && !net.hostLink && net.room === room; i++) await new Promise((r) => setTimeout(r, 100));
    if (net.room === room && !net.hostLink) ui?.joining?.({ state: 'failed', reason: explain(net.lastError ?? { code: 'absent' }) });
    if (net.room !== room || !net.hostLink) return;
    shareGuest?.close();
    const g = createShareGuest(room, {
      link: net.hostLink, name: net.name, bot: query.has('bot'), relay: true,
      onTrack(e) {
        // one track of a kind : a previous room's ended one would be the one the video shows
        for (const t of lobbyStream.getTracks()) if (t.kind === e.track.kind) lobbyStream.removeTrack(t);
        lobbyStream.addTrack(e.track);
        if (lobbyVideo.srcObject !== lobbyStream) lobbyVideo.srcObject = lobbyStream;
      },
    });
    shareGuest = g;
    let seen = null; // each LOBBY message once
    g.on('change', () => {
      const body = g.lobby;
      // the host's word beside the wire (D12) : the Cup's table, its AI's karts — into our game
      if (body && body !== seen && body.room) hostRoom = body.room;
      if (body && body !== seen && body.room && lobby().active) Module.ctrOnlineRoomSet?.(body.room);
      if (body && body.phase === PHASE.starting && Number.isInteger(body.character)) Module.ctrOnlineControl?.(CTL.character, body.character);
      if (body && body !== seen && body.phase === PHASE.race && lobby().phase === PHASE.race) {
        // the host's end-of-race timeout (session 11b)
        const st = Module.ctrOnlineOctr?.().CurrState ?? 0;
        if (body.endIn > 0 && st < ST.endRace) ui?.toast(T.endIn(Math.round(body.endIn / 1000)), T.endInDetail);
        if (body.endRace) endMyRace();
        if (body.takeover !== undefined) ui?.toast(T.botTakesOver(body.takeover));
      }
      seen = body;
      render();
    });
    await g.connect();
  }

  // ---- the lobby, every 100 ms : what the game's phase asks of the page ----
  // A guest's game is in the room once the server took it (a guest waiting for the room's race to
  // end sits on its own title : no host picture over it, no pad sent into the host's race)
  const joined = () => (Module.ctrOnlineOctr?.().CurrState ?? 0) >= ST.assignRole;
  const inHostMenus = () => lobby().phase === PHASE.menus && joined();
  const setLobbyGuest = (on) => {
    ui?.lobby?.(on);
    // in the host's menus, or watching its race out of the room (32f)
    lobbyVideo.classList.toggle('hidden', !(on && (joined() || away) && shareGuest?.media && lobbyStream.getVideoTracks().some((t) => t.readyState === 'live')));
  };
  // guest : the game asked the room and was refused because it is racing
  const refused = () => {
    const o = Module.ctrOnlineOctr?.();
    return net.role === 'guest' && lobby().active && o?.CurrState === ST.pickRoom && o.clientCount[ROOM] >= 8;
  };
  // from the first refusal until the server takes the guest : the game retries every 2 s through
  // its server menu, so refused() alone flickers
  let toldWaiting = false;
  const waitingForRace = () => toldWaiting && net.role === 'guest' && !joined();
  const endTimer = createEndTimer();
  // the host's pause for everyone (D12.9) stops the end-of-race clock : the time spent paused is
  // taken off the clock the timer sees
  let pausedSince = null;
  let pausedMs = 0;
  const raceNow = () => {
    const now = Date.now();
    const paused = Module.ctrOnlineRoom?.().paused > 0;
    if (paused && pausedSince === null) pausedSince = now;
    else if (!paused && pausedSince !== null) {
      pausedMs += now - pausedSince;
      pausedSince = null;
    }
    return (pausedSince ?? now) - pausedMs;
  };
  let sentRoom = null; // host : the room info last sent to the guests (D12)
  let hostPhase = PHASE.none; // host : the lobby's phase at the last tick
  const slotsGone = []; // host : freed slots to tell the game, one a tick (32f)
  let knownBots = 0; // host : the bots' slots at the race's start, then the takeovers told
  // to every guest of the lobby share that listens : our framing (Share's LOBBY message), not the game's
  const toGuests = (body) => {
    for (const id in shareHost?.guests ?? {}) {
      const g = shareHost.guests[id];
      if (g.listening) g.link.send(encodeControl(TAG.lobby, body), { reliable: true });
    }
  };
  // this game's race ends now, if it still runs
  const endMyRace = () => {
    const st = Module.ctrOnlineOctr?.().CurrState ?? 0;
    if (st < ST.waitForRace || st >= ST.endRace) return;
    ui?.toast(T.endedByTimeout);
    Module.ctrOnlineControl?.(CTL.endRace);
  };
  function lobbyTick() {
    const l = lobby();
    if (net.role === 'host') {
      // the players who finished : the host's bots (session 23) never start the clock
      const finished = (Module.ctrOnlineOctr?.().raceStats ?? []).filter((x) => !((l.hostBots ?? 0) >> x.slot & 1)).length;
      const step = endTimer.tick({ race: l.active && l.phase === PHASE.race, finished, endAfterMs: Number(endAfter.value) * 1000, now: raceNow() });
      if (step?.notice) {
        const secs = Math.round(step.notice / 1000);
        if ((Module.ctrOnlineOctr?.().CurrState ?? 0) < ST.endRace) ui?.toast(T.endIn(secs), T.endInDetail);
        toGuests({ phase: PHASE.race, endIn: step.notice });
      }
      if (step?.end) {
        toGuests({ phase: PHASE.race, endRace: true });
        endMyRace();
        Module.ctrOnlineControl?.(CTL.endBots);
      }
      // ONLINE > ARCADE : a slot the host's AI took over mid-race was a leaver's (D11.6)
      const bots = l.hostBots ?? 0;
      if (!(l.active && l.phase === PHASE.race)) knownBots = bots;
      else if (bots & ~knownBots) {
        const names = Module.ctrOnlineOctr?.().names ?? [];
        for (let slot = 1; slot < 8; slot++) {
          if (!((bots & ~knownBots) >> slot & 1)) continue;
          ui?.toast(T.botTakesOver(names[slot]));
          toGuests({ phase: PHASE.race, takeover: names[slot] ?? '' });
        }
        knownBots = bots;
      }
    }
    if (net.role === 'host' && shareHost) {
      // the host's word beside the wire (D12) : the Cup's table and its AI's karts, to every
      // guest when it changes, and again at each track lock (a guest that joined since)
      const room = Module.ctrOnlineRoom?.();
      const roomKey = room && JSON.stringify(room);
      if (room && l.active && (roomKey !== sentRoom || (l.phase === PHASE.starting && !startSent))) {
        sentRoom = roomKey;
        toGuests({ phase: l.phase, room });
      } else if (!l.active && sentRoom && JSON.parse(sentRoom).paused) {
        // the host's game left the room's race paused for everyone (its QUIT) : the guests run on (D12.9)
        const unpaused = { ...JSON.parse(sentRoom), paused: 0 };
        sentRoom = JSON.stringify(unpaused);
        toGuests({ phase: PHASE.race, room: unpaused });
      }
      // the track lock : each guest gets the character its pad locked on this screen
      if (l.active && l.phase === PHASE.starting && !startSent) {
        startSent = true;
        for (const id in shareHost.guests) {
          const g = shareHost.guests[id];
          const character = l.characters[g.slot];
          if (g.listening && character >= 0) g.link.send(encodeControl(TAG.lobby, { phase: PHASE.starting, character }), { reliable: true });
        }
      }
      if (l.phase !== PHASE.starting) startSent = false;
      // the menus back after a race : a leaver's slot kept as a hole meanwhile (32f, nobody moved
      // mid-race) and still free is filled now, the game told each one (its characters move down)
      if (l.active && l.phase === PHASE.menus && hostPhase !== PHASE.menus) slotsGone.push(...shareHost.compactHoles());
      if (l.active && l.phase === PHASE.menus && slotsGone.length) Module.ctrOnlineControl?.(CTL.slotGone, slotsGone.shift());
      hostPhase = l.active ? l.phase : PHASE.none;
    }
    if (net.role === 'guest' && solo) {
      // the race finished alone : its 11b timeout counts from this player's own finish, then the title
      const finished = (Module.ctrOnlineOctr?.().raceStats ?? []).filter((x) => x.slot === 0).length;
      const step = endTimer.tick({ race: l.active && l.phase === PHASE.race, finished, endAfterMs: Number(endAfter.value) * 1000, now: raceNow() });
      if (step?.end) Module.ctrOnlineControl?.(CTL.endBots);
      if (!l.active) {
        // its results shown : the host still there, back in the room at its next lobby (32f)
        solo = false;
        goAway('lost');
        rejoin({ quiet: true, gone: [T.roomClosed, ''] });
      }
    } else if (net.role === 'guest') {
      // our game ignores the local devices from the room's join to its race load (and again on
      // the title reloaded after a race) ; the pad goes to the host only while its menus run
      if (away) awayTick();
      if (np === NP.busy || np === NP.waiting) codeJoinTick();
      setLobbyGuest((l.active && l.phase !== PHASE.race) || !!away);
      if (l.active && inHostMenus() && shareGuest?.state === 'connected') sendPad();
      if (!away && refused() && !toldWaiting) {
        ui?.toast(T.roomRacing, T.nextLobby);
        toldWaiting = true;
        ui?.joining?.({ state: 'racing' });
      } else if (joined()) toldWaiting = false;
      // the joining screen goes once the game is in the host's menus (its picture over the canvas) ;
      // the link to the host refused (no host there) : the reason, Back to leave
      if (l.active && inHostMenus() && (!lobbyVideo.classList.contains('hidden') || (shareGuest?.state === 'connected' && !shareGuest.media))) ui?.joining?.(null);
      else if (net.lastError && !net.hostLink && !net.pending) ui?.joining?.({ state: 'failed', reason: explain(net.lastError) });
    }
  }
  // A code typed in the game, every lobby tick until it is settled : in once the host's lobby
  // took this guest (its game enters then), or the reason for the JOIN screen's red line
  function codeJoinTick() {
    const said = shareGuest?.state;
    if (net.hostLink && said === 'connected') {
      np = NP.room;
      bootCode = null;
      setLobbyGuest(true);
      Module.ctrOnlineControl?.(CTL.enter);
    } else if (said === 'refused' || (net.lastError && !net.hostLink && !net.pending)) {
      const code = said === 'refused' ? shareGuest.code : net.lastError.code;
      codeGen++;
      leave();
      codeSaid(NP_OF[code] ?? NP.offline);
    }
  }
  // 32f : a guest out of the race, every lobby tick — the host told we watch, our game let in
  // once the host's word allows it, the band until the room takes it again
  function awayTick() {
    const linked = !!net.hostLink && shareGuest?.state === 'connected';
    if (linked && linkedAt === null) linkedAt = Date.now();
    if (!linked) linkedAt = null;
    if (joined()) {
      away = null;
      entered = false;
      ui?.waiting?.(null);
      tellWatching(false);
      return;
    }
    tellWatching(linked);
    // our game out again after it was let in (a leave from the lost link's late close) : again
    // (the enter is a latch, one sent twice before the game's next frame is harmless)
    if (entered && !lobby().active) entered = false;
    if (!entered && letIn({ room: hostRoom, linked, waitedMs: linkedAt === null ? 0 : Date.now() - linkedAt })) {
      entered = true;
      Module.ctrOnlineControl?.(CTL.enter);
    }
    ui?.waiting?.({ cup: !!hostRoom?.cup });
  }
  // the host keeps its picture coming while one of its guests watches (web/share/panel.js)
  function tellWatching(on) {
    if (!shareGuest || shareGuest.state !== 'connected') return;
    const key = `${on}`;
    if (watchSent?.guest === shareGuest && watchSent.key === key) return;
    watchSent = { guest: shareGuest, key };
    shareGuest.link.send(encodeControl(TAG.lobby, { watching: on }), { reliable: true });
  }
  setInterval(lobbyTick, 100);
  // our keys and pad to the host while in its lobby (~60 a second, latest wins there)
  function sendPad() {
    if (!ui || shareGuest?.state !== 'connected') return;
    const s = ui.settings.get();
    const pad = query.has('bot') ? pickPad({ mode: 'keyboard' }, held, []) : pickPad(s.device, held, navigator.getGamepads?.() ?? [], ui.guestInput?.());
    shareGuest.sendPad(pad);
  }
  for (const type of ['keydown', 'keyup']) {
    window.addEventListener(type, (e) => {
      held[e.code] = type === 'keydown';
      if (shareGuest?.state === 'connected' && inHostMenus()) sendPad();
    });
  }
  window.addEventListener('blur', () => { for (const k in held) held[k] = false; });
  (function padLoop() {
    if (shareGuest?.state === 'connected' && inHostMenus()) sendPad();
    requestAnimationFrame(padLoop);
  })();
  // the lobby's sound follows the page's volume, and its forced mute (?mute : Settings › Dev's
  // second window, beside a host already playing the same sound)
  ui?.settings.subscribe((s) => { lobbyVideo.muted = !!s.muted || !!window.ctrAudio?.forcedMute; lobbyVideo.volume = Math.min(1, Math.max(0, s.volume ?? 1)); });

  createButton.addEventListener('click', hostAndTell);
  copyButton.addEventListener('click', () => copyText(copyButton, linkText, linkBox));
  codeOutCopy.addEventListener('click', () => copyText(codeOutCopy, codeOutBox.value, codeOutBox));
  codeInButton.addEventListener('click', async () => {
    error = '';
    try { await net.room.paste(codeInBox.value.trim()); codeInBox.value = ''; } catch (e) { fail(e); }
    render();
  });
  joinButton.addEventListener('click', () => {
    const text = joinInput.value.trim();
    if (!text.includes('#')) return fail({ code: 'link' });
    try { parseRoomLink(text); } catch (e) { return fail(e); }
    const hash = `#${text.slice(text.indexOf('#') + 1)}`;
    if (location.hash === hash) switchRoom();
    else location.hash = hash; // hashchange : switchRoom
  });
  // A changed link (session 32b) : another room's link opened in this page — the address bar, or
  // Join above — leaves the current room (a host's guests are told it closed ; a race of the room
  // ends the retail way, back to the title) and joins that one in place : the game enters it once
  // on its title, behind the host's picture in its menus, or waiting for its race to end
  let switching = null; // the room a changed link is joining, until its guest() settles
  function switchRoom() {
    if (!location.hash.includes('room=')) return;
    let next;
    try { next = parseRoomLink(location.hash); } catch (e) { return fail(e); }
    if ((net.room && link?.room === next.room) || switching === next.room) return;
    leave(); // also a rejoin between its attempts, or a join still opening
    asGuest = true;
    ui?.toast(T.joiningRoom);
    switching = next.room;
    guest().finally(() => { if (switching === next.room) switching = null; });
  }
  window.addEventListener('hashchange', switchRoom);
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
    relay.disabled = rk.disabled = !!room;
    createButton.disabled = !!room || hosting;
    linkRow.style.display = room && net.role === 'host' ? '' : 'none';
    linkBox.value = linkText;
    codeBox.style.display = codeOut || link?.signaling?.includes('paste') ? '' : 'none';
    codeOutLabel.textContent = T.codeOut(net.role === 'host' ? T.aGuest : T.theHost);
    codeOutBox.value = codeOut?.blob ?? '';
    for (const node of [codeOutLabel, codeOutBox, codeOutCopy]) node.style.display = codeOut ? '' : 'none';
    const roomName = link?.code ? codeNames(parseCode(link.code)) : link?.room ?? '';
    roomLine.textContent = room ? (net.role === 'host' ? T.hosting(roomName) : T.guestOf(roomName)) : '';
    const list = links();
    const octr = Module.ctrOnlineOctr?.();
    const l = lobby();
    const lines = [];
    if (net.role === 'host') lines.push(list.length ? list.map((l) => T.player(l.peer + 1, ...say(l))).join('\n') : T.waiting);
    if (net.role === 'guest') lines.push(net.hostLink ? T.toHost(...say(list[0])) : np === NP.waiting ? T.askingHost : rejoinTry ? T.reconnectTry(rejoinTry) : net.pending ? T.connecting : T.notConnected);
    if (waitingForRace()) lines.push(`${T.roomRacing} ${T.nextLobby}`);
    const players = net.role === 'host' ? shareHost?.players() : shareGuest?.list;
    if (players?.length) lines.push(T.inRoom(players.map((p) => `P${p.slot + 1} ${nameOf(p.slot, p.name)}`).join(' · ')));
    if (l.active && T.lobby[l.phase] && !waitingForRace()) lines.push(T.lobby[l.phase]);
    if (net.role === 'guest' && shareGuest?.state === 'connected' && !shareGuest.media) lines.push(T.noPicture);
    if (octr && octr.CurrState >= 0) lines.push(T.game(T.states[octr.CurrState] ?? octr.CurrState));
    status.textContent = lines.join('\n');
    errorLine.textContent = error || (net.lastError ? explain(net.lastError) : '');
    leaveButton.style.display = room ? '' : 'none';
    hint.textContent = net.role === 'guest' || asGuest ? T.guestHint : T.hostHint;
  }
  setInterval(render, 500);

  window.__ctrOnline = {
    state() {
      return {
        role: net.role,
        room: link?.room ?? null,
        code: link?.code ?? '',
        np,
        asking: gate?.asking() ?? null,
        link: linkText,
        signaling: link?.signaling ?? null,
        backend: net.room?.backend ?? null,
        selfId: net.room?.selfId ?? null,
        links: links(),
        queue: net.queue.length,
        stats: net.stats,
        lastError: net.lastError ? { code: net.lastError.code, message: net.lastError.message } : null,
        error,
        octr: Module.ctrOnlineOctr?.() ?? null,
        karts: Module.ctrOnlineKarts?.() ?? null,
        lobby: lobby(),
        roomInfo: Module.ctrOnlineRoom?.() ?? null,
        rejoin: rejoinTry,
        waitingForRace: waitingForRace(),
        watch: { away, entered, band: away && !joined() ? { cup: !!hostRoom?.cup } : null, shown: !lobbyVideo.classList.contains('hidden'), frames: lobbyVideo.getVideoPlaybackQuality?.().totalVideoFrames ?? 0, hostRoom },
        share: net.role === 'host'
          ? { guests: shareHost ? Object.values(shareHost.guests).map((g) => ({ slot: g.slot, name: g.name, state: g.state, path: g.path, bot: !!g.bot })) : [] }
          : shareGuest ? { state: shareGuest.state, media: shareGuest.media, slot: shareGuest.slot, list: shareGuest.list, lobby: shareGuest.lobby, video: [lobbyVideo.videoWidth, lobbyVideo.videoHeight] } : null,
      };
    },
    /** ?bot : our kart as the host's game sees it, shaped like window.__ctr (web/share/guest-page.js bot()). */
    bot() {
      if (!shareGuest || shareGuest.state === 'closed' || shareGuest.state === 'refused') return { gone: true, screen: shareGuest?.state ?? 'idle', kart: null };
      const s = shareGuest.game;
      return s ? { ...s, track: shareGuest.track } : null;
    },
    host,
    leave,
  };

  // The controls, once, in the page's log under the canvas and in the browser's console.
  for (const line of T.controls) Module.print?.(line);

  // One build : a solo boot keeps the panel closed, as the OFF build had none (nothing stored :
  // session 9's remembered state kept it open at every boot) ; a room link opens it, but for the
  // page's UI, whose boot screen says « Joining the room… » (session 32e).
  setOpen(asGuest && !ui);
  if (asGuest) guest();
  else if (bootCode && !haveKey()) codeSaid(NP.noKey);
  else if (bootCode) joinByCode(parseCode(bootCode));
  render();
}
