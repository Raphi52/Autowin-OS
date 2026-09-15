/**
 * UN SEUL POINT DE PASSAGE POUR PRENDRE UNE PREUVE SANS TOUCHER A L'ECRAN DE L'UTILISATEUR.
 *
 * DEFAUT MESURE : deux chemins de preuve coexistaient. Quatre sondes demarraient chacune leur
 * propre instance isolee, avec son port EN DUR et son code d'arret recopie ; `ui-capture.mjs`, lui,
 * pilote la fenetre REELLE du poste (il clique le vrai bouton de navigation — mesure du 2026-09-02 :
 * une phase a deplace l'utilisateur deux fois sur Knowledge pendant qu'il travaillait). Et l'arret
 * n'etait garanti par personne : un script interrompu (Ctrl-C, timeout, exception avant le `Stop`)
 * laissait une application vivante et un `instance.json` derriere lui, donc un port occupe au
 * passage suivant.
 *
 * CE QUE CE SCRIPT GARANTIT, pour N'IMPORTE QUEL appelant :
 *   1. un port REELLEMENT libre (un socket orphelin ne se tue pas, on prend le suivant) ;
 *   2. une instance cachee, profil et APPDATA dedies (deja assure par autowin-headless.ps1) ;
 *   3. l'arret et la suppression de `instance.json` QUOI QU'IL ARRIVE — fin normale, sonde rouge,
 *      exception, SIGINT/SIGTERM ;
 *   4. le ramassage des restes : les `instance.json` d'executions precedentes dont le processus est
 *      mort. Les dossiers d'instance portent des captures : seuls les `preuve-<pid>` de plus de 24 h,
 *      lanceur et application morts, SANS aucune capture, sont purges (voir `dossiersApurger`) ;
 *   5. un code de sortie HONNETE : celui de la sonde, ou un code nomme si le demarrage a echoue.
 *
 * Usage : node scripts/avec-instance-headless.mjs [--instance-id <id>] [--port <depart>] [--attendre <s>]
 *                -- node scripts/cdp-xxx.mjs [args...]
 * Le `--port <port choisi>` est ajoute a la commande enfant si elle ne le porte pas deja.
 *
 * TRAVAUX PARALLELES (2026-09-13) : sans --instance-id, l'identifiant vaut `preuve-<pid>`, donc
 * deux lancements simultanes ont chacun leur bureau cache et leur profil. L'instance ET le port
 * sont pris par un fichier-verrou cree en mode exclusif (atomique entre processus) : un second
 * lanceur du meme nom est REFUSE au lieu de fermer l'application du premier, et deux lanceurs ne
 * peuvent plus choisir le meme port. Un verrou dont le lanceur est mort est repris.
 * Limite connue : la reprise d'un verrou mort a une fenetre tres courte ou deux lanceurs peuvent
 * la tenter en meme temps ; le cas nominal (lanceurs vivants) n'a pas de course.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { racineDepot } from './racine-depot.mjs'
import { portsEnEcouteSysteme } from './port-libre.mjs'

/** La commande PowerShell du lanceur, pour une action donnee. Pure. */
export function commandeLanceur({ racine, action, instanceId, port }) {
  return {
    commande: 'powershell',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(racine, 'scripts', 'autowin-headless.ps1'),
      '-Action',
      action,
      '-InstanceId',
      instanceId,
      '-Port',
      String(port)
    ]
  }
}

/** L'identifiant par defaut : propre au processus lanceur, donc distinct entre travaux paralleles. Pure. */
export function identifiantParDefaut(pid = process.pid) {
  return `preuve-${pid}`
}

/** Decoupe `--instance-id x --port n -- <cmd...>` en options + commande enfant. Pure. */
export function decouperArguments(argv, pid = process.pid) {
  const separateur = argv.indexOf('--')
  const options = separateur >= 0 ? argv.slice(0, separateur) : argv
  const enfant = separateur >= 0 ? argv.slice(separateur + 1) : []
  const lire = (nom) => {
    const i = options.indexOf(nom)
    return i >= 0 ? options[i + 1] : undefined
  }
  return {
    instanceId: lire('--instance-id') ?? identifiantParDefaut(pid),
    portDemande: Number(lire('--port') ?? 9240),
    attendreMs: Number(lire('--attendre') ?? 0) * 1000,
    enfant
  }
}

/**
 * Les arguments de l'enfant, port impose s'il ne l'a pas deja. Pure.
 * On n'ECRASE PAS un `--port` explicite : l'appelant qui vise une instance precise reste maitre.
 */
export function argumentsEnfantAvecPort(enfant, port) {
  return enfant.includes('--port') ? [...enfant] : [...enfant, '--port', String(port)]
}

/** Un PID est-il encore vivant ? `kill(pid, 0)` ne tue rien : il interroge. */
export function pidVivant(pid, sonde = (p) => process.kill(p, 0)) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    sonde(pid)
    return true
  } catch (erreur) {
    // EPERM = le processus existe mais n'est pas a nous : vivant.
    return erreur?.code === 'EPERM'
  }
}

/**
 * Les restes a ramasser : les fiches d'instance dont le processus est mort. Pure.
 * `exclure` protege l'instance en cours. On rend des FICHES, jamais des dossiers.
 */
export function restesAramasser({ fiches, exclure, vivant = pidVivant }) {
  return fiches
    .filter((f) => f.instanceId !== exclure)
    .filter((f) => !vivant(f.pid))
    .map((f) => f.fichier)
}

/**
 * Prend un fichier-verrou en creation EXCLUSIVE (`wx`) : un seul processus reussit.
 * Si le verrou existe et que son lanceur est mort, il est repris SOUS UNE GARDE (`<verrou>.reprise`,
 * elle aussi exclusive) : on relit le pid sous la garde, et on ne remplace que s'il est toujours mort.
 * Sans garde, deux lanceurs pouvaient lire le meme pid mort, et le second ecrasait le verrou VIVANT
 * du premier (les deux se croyaient proprietaires). Une garde de plus de 10 s est abandonnee.
 * Un verrou vide ou illisible compte pour TENU : son createur est peut-etre en train d'ecrire.
 * `apresLecture` n'existe que pour les tests : il ouvre la fenetre de course.
 */
export function prendreVerrou(
  fichier,
  pid = process.pid,
  vivant = pidVivant,
  { apresLecture } = {}
) {
  mkdirSync(dirname(fichier), { recursive: true })
  const creer = () => {
    try {
      const fd = openSync(fichier, 'wx')
      writeSync(fd, String(pid))
      closeSync(fd)
      return true
    } catch (erreur) {
      if (erreur.code !== 'EEXIST') throw erreur
      return false
    }
  }
  if (creer()) return true
  const garde = `${fichier}.reprise`
  if (!prendreGarde(garde)) return false
  try {
    let tenu
    try {
      tenu = Number(readFileSync(fichier, 'utf8').trim())
    } catch {
      tenu = undefined // disparu entre-temps : la creation dira qui gagne
    }
    if (apresLecture) apresLecture()
    if (tenu !== undefined) {
      if (!Number.isInteger(tenu) || tenu <= 0 || vivant(tenu)) return false
      rmSync(fichier, { force: true })
    }
    return creer()
  } finally {
    rmSync(garde, { force: true })
  }
}

function prendreGarde(garde) {
  try {
    closeSync(openSync(garde, 'wx'))
    return true
  } catch (erreur) {
    if (erreur.code !== 'EEXIST') throw erreur
  }
  try {
    if (Date.now() - statSync(garde).mtimeMs <= 10000) return false
    rmSync(garde, { force: true })
    closeSync(openSync(garde, 'wx'))
    return true
  } catch {
    return false
  }
}

/**
 * Reserve l'instance puis un port, SANS course entre lanceurs. Rend `{ instanceId, port, verrous }`
 * ou `{ refus: 'instance-occupee' | 'aucun-port' }`. `occupes` = ports deja en ecoute sur le systeme.
 */
export function reserverLancement({
  racineInstances,
  instanceId,
  portDemande,
  occupes,
  fenetre = 20,
  pid = process.pid,
  vivant = pidVivant
}) {
  const dossier = join(racineInstances, '.verrous')
  const verrouInstance = join(dossier, `instance-${instanceId}.lock`)
  if (!prendreVerrou(verrouInstance, pid, vivant)) return { refus: 'instance-occupee' }
  for (let port = portDemande; port < portDemande + fenetre; port += 1) {
    if (occupes.has(port)) continue
    const verrouPort = join(dossier, `port-${port}.lock`)
    if (prendreVerrou(verrouPort, pid, vivant))
      return { instanceId, port, verrous: [verrouInstance, verrouPort] }
  }
  libererVerrous([verrouInstance])
  return { refus: 'aucun-port' }
}

export function libererVerrous(verrous) {
  for (const fichier of verrous) rmSync(fichier, { force: true })
}

/**
 * Les applications ORPHELINES : la trace `lanceur.pid` de leur instance porte un lanceur MORT alors
 * que l'app vit encore (lanceur tue brutalement). Rend `{ instanceId, port }` avec le port de LEUR
 * fiche : le lanceur PowerShell refuse d'arreter une instance sous un autre port. Sans trace
 * (instance lancee directement par le .ps1), on ne touche a rien. Pure.
 * La trace n'est PAS le verrou : un verrou mort est repris puis libere par le lanceur suivant, meme
 * quand celui-ci echoue — il ne peut donc pas prouver qu'une orpheline existe (reproduit le 2026-09-13).
 */
export function orphelinsAarreter({ fiches, lireLanceur, vivant = pidVivant }) {
  return fiches
    .filter((f) => {
      const lanceur = lireLanceur(f.instanceId)
      return Number.isInteger(lanceur) && lanceur > 0 && !vivant(lanceur) && vivant(f.pid)
    })
    .map((f) => ({ instanceId: f.instanceId, port: f.port }))
}

const traceLanceur = (racineInstances, instanceId) =>
  join(racineInstances, instanceId, 'lanceur.pid')

function lirePidLanceur(racineInstances, instanceId) {
  try {
    return Number(readFileSync(traceLanceur(racineInstances, instanceId), 'utf8').trim())
  } catch {
    return undefined
  }
}

const AGE_PURGE_MS = 24 * 3600 * 1000
const HORS_CAPTURE = new Set(['user-data', 'appdata', 'instance.json', 'lanceur.pid'])

/**
 * Les dossiers d'instance a PURGER. Seulement : nom `preuve-<pid>` (identifiant par defaut), plus de
 * 24 h, lanceur (le pid du nom) mort, application de la fiche morte ou absente, et AUCUNE capture —
 * toute entree hors profil et fiches internes (`proof/`, une image, une fixture) protege le dossier.
 * Un pid reutilise par un autre processus passe pour vivant : on garde, jamais l'inverse. Pure.
 */
export function dossiersApurger({ dossiers, vivant = pidVivant, ageMin = AGE_PURGE_MS }) {
  return dossiers
    .filter((d) => {
      const m = /^preuve-([0-9]+)$/.exec(d.nom)
      if (!m || d.ageMs <= ageMin) return false
      if (vivant(Number(m[1])) || vivant(d.pidApp)) return false
      return d.entrees.every((e) => HORS_CAPTURE.has(e))
    })
    .map((d) => d.nom)
}

/** Purge sur disque les dossiers designes par `dossiersApurger`. Rend les noms effaces. */
export function purgerDossiersInstance(
  racineInstances,
  { vivant = pidVivant, maintenant = Date.now() } = {}
) {
  if (!existsSync(racineInstances)) return []
  const dossiers = []
  for (const entree of readdirSync(racineInstances, { withFileTypes: true })) {
    if (!entree.isDirectory() || !entree.name.startsWith('preuve-')) continue
    const chemin = join(racineInstances, entree.name)
    let pidApp = Number.NaN
    try {
      pidApp = lireEtatInstance(readFileSync(join(chemin, 'instance.json'), 'utf8')).pid
    } catch {
      // pas de fiche lisible : aucune application connue
    }
    dossiers.push({
      nom: entree.name,
      ageMs: maintenant - statSync(chemin).mtimeMs,
      entrees: readdirSync(chemin),
      pidApp
    })
  }
  const aPurger = dossiersApurger({ dossiers, vivant })
  for (const nom of aPurger) rmSync(join(racineInstances, nom), { recursive: true, force: true })
  return aPurger
}

/**
 * Lit une fiche `instance.json`. PowerShell 5 l'ecrit avec un BOM que JSON.parse refuse : sans ce
 * retrait, toute instance passait pour morte. Pure.
 */
export function lireEtatInstance(texte) {
  const etat = JSON.parse(String(texte).replace(new RegExp('^' + String.fromCharCode(0xfeff)), ''))
  return { pid: Number(etat.pid), port: Number(etat.port) }
}

/** Lit les `instance.json` presents sous la racine des instances. */
function lireFiches(racineInstances) {
  if (!existsSync(racineInstances)) return []
  const fiches = []
  for (const entree of readdirSync(racineInstances, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue
    const fichier = join(racineInstances, entree.name, 'instance.json')
    if (!existsSync(fichier)) continue
    try {
      fiches.push({
        instanceId: entree.name,
        fichier,
        ...lireEtatInstance(readFileSync(fichier, 'utf8'))
      })
    } catch {
      // Fiche illisible : un reste, justement. PID inconnu => considere mort.
      fiches.push({ instanceId: entree.name, fichier, pid: Number.NaN })
    }
  }
  return fiches
}

/**
 * Comme `reserverLancement`, mais une instance du MEME nom occupee fait PATIENTER jusqu'a
 * `attendreMs` (sondage chaque seconde) au lieu de refuser. `dormir` n'est injecte que pour les tests.
 */
export function reserverAvecAttente({ attendreMs = 0, dormir = dormirUneSeconde, ...options }) {
  const echeance = Date.now() + attendreMs
  for (;;) {
    const reservation = reserverLancement(options)
    if (reservation.refus !== 'instance-occupee' || Date.now() >= echeance) return reservation
    dormir()
  }
}

function dormirUneSeconde() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
}

function stopper(racine, instanceId, port) {
  const { commande, args } = commandeLanceur({ racine, action: 'Stop', instanceId, port })
  return spawnSync(commande, args, { cwd: racine, encoding: 'utf8', windowsHide: true })
}

/**
 * RESERVER UNE INSTANCE HEADLESS, pour l'enrobage ET pour toute sonde qui demarre la sienne.
 * Arrete les orphelines, purge les vieux dossiers, ramasse les fiches mortes, reserve le nom et un
 * port sans course, arrete un reste du MEME nom avec le port de SA fiche, pose la trace du lanceur.
 * Sur refus, SORT du processus avec un code nomme (6 instance occupee, 3 aucun port, 4 reste non
 * arrete). Verrous et trace sont liberes a la sortie du processus. Rend `{ port, racineInstances }`.
 */
export function reserverInstance({
  instanceId,
  portDemande,
  racine = racineDepot(),
  attendreMs = 0,
  prefixe = '[instance-headless]'
}) {
  const racineInstances = join(racine, 'Audit', 'headless-instances')

  // Les orphelines d'abord : arretees avec le port de LEUR fiche.
  for (const orpheline of orphelinsAarreter({
    fiches: lireFiches(racineInstances),
    lireLanceur: (id) => lirePidLanceur(racineInstances, id)
  })) {
    const stop = stopper(racine, orpheline.instanceId, orpheline.port)
    console.error(
      stop.status === 0
        ? `${prefixe} application orpheline arretee : « ${orpheline.instanceId} » (port ${orpheline.port})`
        : `${prefixe} orpheline « ${orpheline.instanceId} » non arretee : ${stop.stderr || stop.stdout}`
    )
  }

  for (const nom of purgerDossiersInstance(racineInstances))
    console.error(`${prefixe} dossier d'instance purge (plus de 24 h, sans capture) : ${nom}`)

  // Le ramassage a lieu AVANT le demarrage : un reste mort tient parfois encore le port.
  for (const fiche of restesAramasser({
    fiches: lireFiches(racineInstances),
    exclure: instanceId
  })) {
    rmSync(fiche, { force: true })
    console.error(`${prefixe} reste ramasse : ${fiche}`)
  }

  const reservation = reserverAvecAttente({
    racineInstances,
    instanceId,
    portDemande,
    occupes: portsEnEcouteSysteme(),
    attendreMs,
    dormir: () => {
      console.error(`${prefixe} « ${instanceId} » occupee — attente...`)
      dormirUneSeconde()
    }
  })
  if (reservation.refus === 'instance-occupee') {
    console.error(
      `${prefixe} l'instance « ${instanceId} » est deja utilisee par un travail vivant — refus (on ne ferme pas son application). Donne un autre identifiant, ou --attendre <secondes>.`
    )
    process.exit(6)
  }
  if (reservation.refus === 'aucun-port') {
    console.error(
      `${prefixe} aucun port libre entre ${portDemande} et ${portDemande + 19} — machine saturee.`
    )
    process.exit(3)
  }
  const { port, verrous } = reservation
  if (port !== portDemande)
    console.error(`${prefixe} port ${portDemande} occupe — repli sur ${port}`)

  const trace = traceLanceur(racineInstances, instanceId)
  const fiche = join(racineInstances, instanceId, 'instance.json')
  // La trace ne part que si la fiche est partie, c'est-a-dire si l'arret a reussi : sinon l'app vit
  // peut-etre encore, et le prochain lanceur doit pouvoir la ramasser comme orpheline.
  process.on('exit', () => {
    if (!existsSync(fiche)) rmSync(trace, { force: true })
    libererVerrous(verrous)
  })

  // Le nom est a nous : une fiche de ce nom est forcement un reste d'un lanceur mort.
  const reste = lireFiches(racineInstances).find((f) => f.instanceId === instanceId)
  if (reste && pidVivant(reste.pid)) {
    const stopReste = stopper(racine, instanceId, reste.port)
    if (stopReste.status !== 0) {
      console.error(
        `${prefixe} reste de « ${instanceId} » non arrete : ${stopReste.stderr || stopReste.stdout}`
      )
      process.exit(4)
    }
  } else if (reste) {
    // App morte : sa fiche porte peut-etre un autre port, et ferait echouer le Start.
    rmSync(reste.fichier, { force: true })
  }

  mkdirSync(join(racineInstances, instanceId), { recursive: true })
  writeFileSync(trace, String(process.pid))
  return { port, racineInstances }
}

async function main() {
  const racine = racineDepot()
  const { instanceId, portDemande, attendreMs, enfant } = decouperArguments(process.argv.slice(2))
  if (enfant.length === 0) {
    console.error(
      '[instance-headless] aucune commande a executer. Usage : --instance-id <id> [--attendre <s>] -- node scripts/xxx.mjs'
    )
    process.exit(2)
  }
  const { port } = reserverInstance({ instanceId, portDemande, racine, attendreMs })

  const lanceur = (action) => {
    const { commande, args } = commandeLanceur({ racine, action, instanceId, port })
    return spawnSync(commande, args, { cwd: racine, encoding: 'utf8', windowsHide: true })
  }

  let arrete = false
  const arreter = () => {
    if (arrete) return
    arrete = true
    const stop = lanceur('Stop')
    if (stop.status !== 0)
      console.error(`[instance-headless] arret imparfait : ${stop.stderr || stop.stdout}`)
    else console.error(`[instance-headless] instance « ${instanceId} » arretee`)
  }
  // L'arret est garanti AUSSI quand on nous interrompt : sans ceci, un Ctrl-C laisse l'app vivante.
  // `prependListener` : a la sortie, l'arret passe AVANT la liberation des verrous et de la trace.
  process.prependListener('exit', arreter)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(signal, () => {
      arreter()
      process.exit(130)
    })
  }

  const demarrage = lanceur('Start')
  if (demarrage.status !== 0) {
    console.error(
      `[instance-headless] instance non demarree :\n${demarrage.stderr || demarrage.stdout}`
    )
    process.exit(4)
  }
  console.error(`[instance-headless] instance « ${instanceId} » prete sur le port ${port}`)

  const code = await new Promise((resoudre) => {
    const fils = spawn(process.execPath, argumentsEnfantAvecPort(enfant.slice(1), port), {
      cwd: racine,
      stdio: 'inherit',
      windowsHide: true
    })
    fils.on('error', (erreur) => {
      console.error(`[instance-headless] commande illancable : ${erreur.message}`)
      resoudre(5)
    })
    fils.on('exit', (statut, signal) => resoudre(signal ? 130 : (statut ?? 1)))
  })
  arreter()
  process.exit(code)
}

if (process.argv[1] && process.argv[1].endsWith('avec-instance-headless.mjs')) {
  await main()
}
