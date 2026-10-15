'use strict'
/**
 * CE QUE LANCE UN CLIC SUR « Autowin OS Dev » DANS LE MENU DÉMARRER.
 *
 * Constaté le 2026-10-15 (conv-954) : l'icône Autowin du menu Démarrer ouvrait la page d'accueil
 * d'Electron au lieu d'Autowin OS. Ce raccourci, l'app le pose elle-même au démarrage
 * (src/main/raccourci-demarrer-dev.ts) parce qu'Electron l'exige pour les notifications et que la
 * barre des tâches lui prend son icône. Electron le contrôle (`ExistingShortcutValid`) : sa CIBLE
 * doit rester l'exe qui fait tourner l'app, sinon il le réécrit, sans icône. Or cet exe, lancé SANS
 * argument, ouvre l'application par défaut d'Electron (`resources/default_app.asar`).
 *
 * Electron ne contrôle PAS les arguments du raccourci. Ils désignent donc ce fichier : l'application
 * par défaut d'Electron le charge comme script principal. Il démarre le lanceur officiel — le même
 * que le raccourci du Bureau (scripts/create-dev-shortcut.ps1 : Python graphique + launch_dev.py) —
 * puis se ferme. Source : https://github.com/electron/electron/blob/main/shell/browser/notifications/win/windows_toast_activator.cc
 *
 * ESSAI SANS LANCER : `AUTOWIN_MENU_DEMARRER_ESSAI=<fichier>` écrit dans ce fichier la commande qui
 * serait lancée, et ne lance rien (le lanceur réel ouvre une boîte « déjà lancé » si l'app tourne).
 */
const { existsSync, writeFileSync } = require('node:fs')
const { delimiter, join, resolve } = require('node:path')

const RACINE = resolve(__dirname, '..')
const TITRE = 'Autowin OS Dev'

/**
 * Interpréteur Python GRAPHIQUE, dans le MÊME ordre que scripts/create-dev-shortcut.ps1 : le CPython
 * embarqué du dépôt, puis `pyw.exe`, puis `pythonw.exe` du PATH. Jamais `python.exe` : une console.
 */
function choisirInterpreteur({ racine, chemins, existe }) {
  const embarque = join(racine, 'resources', 'python', 'pythonw.exe')
  if (existe(embarque)) return embarque
  for (const nom of ['pyw.exe', 'pythonw.exe']) {
    for (const dossier of chemins) {
      if (!dossier) continue
      const candidat = join(dossier, nom)
      if (existe(candidat)) return candidat
    }
  }
  return undefined
}

/** La commande du lanceur officiel, ou la raison pour laquelle on ne peut pas la former. */
function commandeLanceur({ racine, chemins, existe }) {
  const lanceur = join(racine, 'scripts', 'launch_dev.py')
  if (!existe(lanceur)) return { erreur: `Lanceur Dev introuvable :\n${lanceur}` }
  const interpreteur = choisirInterpreteur({ racine, chemins, existe })
  if (!interpreteur) {
    return { erreur: 'Aucun interpréteur Python graphique (pyw.exe ou pythonw.exe) trouvé dans le PATH.' }
  }
  return { interpreteur, arguments: [lanceur], dossier: racine }
}

function demarrer() {
  const { app, dialog } = require('electron')
  const { spawn } = require('node:child_process')
  const commande = commandeLanceur({
    racine: RACINE,
    chemins: (process.env['PATH'] ?? '').split(delimiter),
    existe: existsSync
  })
  const essai = process.env['AUTOWIN_MENU_DEMARRER_ESSAI']
  if (essai) {
    writeFileSync(essai, JSON.stringify({ ...commande, executable: process.execPath }, null, 2))
    app.exit(0)
    return
  }
  if (commande.erreur) {
    // Aucun échec muet : sans fenêtre, personne ne verrait l'erreur.
    dialog.showErrorBox(TITRE, commande.erreur)
    app.exit(1)
    return
  }
  const enfant = spawn(commande.interpreteur, commande.arguments, {
    cwd: commande.dossier,
    detached: true,
    stdio: 'ignore'
  })
  enfant.once('spawn', () => {
    enfant.unref()
    app.exit(0)
  })
  enfant.once('error', (erreur) => {
    dialog.showErrorBox(TITRE, `Le lanceur Dev n'a pas pu démarrer :\n${erreur.message}`)
    app.exit(1)
  })
}

// Chargé par l'application par défaut d'Electron : on lance. Importé par un test sous Node : rien.
if (process.versions['electron'] && process.type === 'browser') demarrer()

module.exports = { RACINE, choisirInterpreteur, commandeLanceur }
