// The debug tools' words (src/dev/, debug builds only), English and French like lib/strings.js —
// apart, so a release bundle carries none of them.
import { LANG } from '../lib/strings.js'

const en = {
  second: 'Second window',
  secondHelp: 'A window opens beside this one and joins the room as Bot ; you pick the race from your own menus, Bot follows (its character, its race).',
  secondModes: { vs: 'Netplay VS', battle: 'Netplay Battle', share: 'Couch', arcade: 'Netplay Arcade' },
  secondSteps: { hosting: 'Opening the room…', joining: 'Waiting for Bot in the room…', menus: 'Walking the menus to the race…', racing: 'Race on.', ready: 'Bot is in the room : pick the race from your menus (NETPLAY or VS.).', blocked: 'The browser blocked the window : allow pop-ups for this page.' },
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
  second: 'Deuxième fenêtre',
  secondHelp: 'Une fenêtre s\'ouvre à côté et rejoint la salle en Bot ; tu choisis la course dans tes propres menus, Bot suit (son perso, sa course).',
  secondModes: { vs: 'Netplay VS', battle: 'Netplay Combat', share: 'Couch', arcade: 'Netplay Arcade' },
  secondSteps: { hosting: 'Ouverture de la salle…', joining: 'En attente de Bot dans la salle…', menus: 'Menus parcourus jusqu\'à la course…', racing: 'Course lancée.', ready: 'Bot est dans la salle : choisis la course dans tes menus (NETPLAY ou VS.).', blocked: 'Le navigateur a bloqué la fenêtre : autorise les pop-ups pour cette page.' },
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
