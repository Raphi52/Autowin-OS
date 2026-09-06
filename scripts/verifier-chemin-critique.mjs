import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { racineDepot } from './racine-depot.mjs'
import { choisirPortLibre } from './port-libre.mjs'

/*
 * LA SONDE DU CHEMIN CRITIQUE, EN UN SEUL APPEL — et branchee automatiquement.
 *
 * Jusqu'au 2026-09-06 cette sonde ne tournait QUE si quelqu'un pensait a la lancer a la main, apres
 * avoir lui-meme demarre une instance isolee et devine son port. Resultat mesure le meme jour :
 * elle etait rouge depuis des semaines sur quatre defauts distincts (port introuvable, instance qui
 * ne demarrait pas, evenement rendu hors cadre, recu d'autorite jamais emis) sans que personne ne
 * le sache. Une preuve qu'on oublie de lancer ne protege de rien.
 *
 * POURQUOI PAS DANS `npm test` : la boucle de verification rapide est jouee a CHAQUE edition de
 * fichier. Y ajouter un packaging, un demarrage d'application et un parcours d'interface ferait
 * passer chaque edition de quelques secondes a plusieurs minutes — le prix serait paye des
 * centaines de fois par jour pour une preuve qui ne change qu'au build. Elle est donc branchee sur
 * `build:desktop` : elle s'execute sur le binaire qui vient d'etre produit, au moment ou la
 * question « ce paquet fonctionne-t-il ? » se pose vraiment.
 *
 * Le port est choisi haut et fixe pour cette verification : il n'entre pas en collision avec
 * l'application de developpement, qui prend le premier port libre a partir de 9222.
 */
const racine = racineDepot()
const binaire = join(racine, 'dist', 'win-unpacked', 'autowin-os.exe')
const instance = process.env.AUTOWIN_CP_INSTANCE || 'chemin-critique'
const portDemande = Number(process.env.AUTOWIN_CP_PORT || 9280)
/*
 * Le port demande peut etre tenu par un socket ORPHELIN — un enfant de l'application herite du
 * socket d'ecoute et le garde apres la mort du parent. Mesure le 2026-09-06 : 9280 etait en
 * LISTENING pour un PID introuvable, le harnais refusait de demarrer, et cette verification
 * automatique tombait a chaque construction pour une raison sans rapport avec le produit. Un
 * socket fantome ne se tue pas : on prend le suivant libre, et on le DIT.
 */
const port = choisirPortLibre(portDemande)
if (port === undefined) {
  console.error(
    `[chemin-critique] aucun port libre entre ${portDemande} et ${portDemande + 19} — machine saturee.`
  )
  process.exit(3)
}
if (port !== portDemande)
  console.log(`[chemin-critique] port ${portDemande} occupe (socket orphelin) — repli sur ${port}`)

if (!existsSync(binaire)) {
  console.error(
    `[chemin-critique] binaire absent : ${binaire}\n` +
      "Construis-le d'abord (npm run build:desktop) — cette verification porte sur le PAQUET, pas sur les sources."
  )
  process.exit(2)
}

const lanceur = (action) =>
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(racine, 'scripts', 'autowin-headless.ps1'),
      '-Action',
      action,
      '-InstanceId',
      instance,
      '-Port',
      String(port)
    ],
    { cwd: racine, encoding: 'utf8' }
  )

// Un reste d'execution precedente occuperait le port et ferait echouer le demarrage sur une cause
// qui n'a rien a voir avec le produit. On ferme avant d'ouvrir, sans se soucier de l'issue.
lanceur('Stop')

const demarrage = lanceur('Start')
if (demarrage.status !== 0) {
  console.error(
    `[chemin-critique] instance isolee non demarree :\n${demarrage.stderr || demarrage.stdout}`
  )
  process.exit(1)
}
console.log(`[chemin-critique] instance « ${instance} » prete sur le port ${port}`)

const sonde = spawnSync(
  process.execPath,
  [join(racine, 'scripts', 'cdp-observatory-critical-path.mjs'), '--port', String(port)],
  { cwd: racine, encoding: 'utf8', stdio: 'inherit' }
)

// L'arret a lieu QUOI QU'IL ARRIVE : une sonde rouge qui laisse une application ouverte derriere
// elle transforme un echec lisible en port occupe au prochain passage.
lanceur('Stop')

if (sonde.status !== 0) {
  console.error(`[chemin-critique] ECHEC — la sonde est sortie en ${sonde.status}`)
  process.exit(sonde.status ?? 1)
}
console.log('[chemin-critique] vert — parcours complet de l Observatory verifie sur le paquet')
