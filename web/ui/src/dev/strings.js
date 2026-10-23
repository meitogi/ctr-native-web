// The debug tools' words (src/dev/, debug builds only), English and French like lib/strings.js —
// apart, so a release bundle carries none of them.
import { LANG } from '../lib/strings.js'

const en = {
  second: 'Second window (dev)',
  secondHelp: 'Opens a window beside this one, already in the room, playing as Bot ; this window walks its menus to the race.',
  secondModes: { vs: 'Online VS', battle: 'Online Battle', share: 'Share' },
  secondSteps: { opening: 'Opening the second window…', hosting: 'Starting the game and the room…', joining: 'Waiting for Bot in the room…', menus: 'Walking the menus to the race…', racing: 'Race on.', blocked: 'The browser blocked the window : allow pop-ups for this page.' },
  bot: 'Bot (autopilot)',
  botHelp: 'This window drives itself : the character browsed and locked, the racing line, an item every 1.5 s. Debug builds only.',
  dev: {
    tab: 'Dev',
    log: 'Page log',
    showLog: 'Show the log over the game',
    state: 'Game state',
    copy: 'Copy the state',
    copied: 'State copied',
  },
}

const fr = {
  second: 'Deuxième fenêtre (dev)',
  secondHelp: 'Ouvre une fenêtre à côté de celle-ci, déjà dans la salle, jouée par Bot ; cette fenêtre parcourt ses menus jusqu\'à la course.',
  secondModes: { vs: 'En ligne VS', battle: 'En ligne Combat', share: 'Partage' },
  secondSteps: { opening: 'Ouverture de la deuxième fenêtre…', hosting: 'Démarrage du jeu et de la salle…', joining: 'En attente de Bot dans la salle…', menus: 'Menus parcourus jusqu\'à la course…', racing: 'Course lancée.', blocked: 'Le navigateur a bloqué la fenêtre : autorise les pop-ups pour cette page.' },
  bot: 'Bot (pilote auto)',
  botHelp: 'Cette fenêtre joue toute seule : le personnage parcouru puis verrouillé, la trajectoire, un objet toutes les 1,5 s. Builds debug seulement.',
  dev: {
    tab: 'Dev',
    log: 'Journal de la page',
    showLog: 'Afficher le journal sur le jeu',
    state: 'État du jeu',
    copy: 'Copier l\'état',
    copied: 'État copié',
  },
}

export const D = LANG === 'fr' ? fr : en
