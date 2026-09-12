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
 *      mort. On ne supprime JAMAIS les dossiers d'instance : ils portent des captures ;
 *   5. un code de sortie HONNETE : celui de la sonde, ou un code nomme si le demarrage a echoue.
 *
 * Usage : node scripts/avec-instance-headless.mjs [--instance-id <id>] [--port <depart>]
 *                -- node scripts/cdp-xxx.mjs [args...]
 * Le `--port <port choisi>` est ajoute a la commande enfant si elle ne le porte pas deja.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { racineDepot } from './racine-depot.mjs'
import { choisirPortLibre } from './port-libre.mjs'

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

/** Decoupe `--instance-id x --port n -- <cmd...>` en options + commande enfant. Pure. */
export function decouperArguments(argv) {
  const separateur = argv.indexOf('--')
  const options = separateur >= 0 ? argv.slice(0, separateur) : argv
  const enfant = separateur >= 0 ? argv.slice(separateur + 1) : []
  const lire = (nom) => {
    const i = options.indexOf(nom)
    return i >= 0 ? options[i + 1] : undefined
  }
  return {
    instanceId: lire('--instance-id') ?? 'preuve-headless',
    portDemande: Number(lire('--port') ?? 9240),
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

/** Lit les `instance.json` presents sous la racine des instances. */
function lireFiches(racineInstances) {
  if (!existsSync(racineInstances)) return []
  const fiches = []
  for (const entree of readdirSync(racineInstances, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue
    const fichier = join(racineInstances, entree.name, 'instance.json')
    if (!existsSync(fichier)) continue
    try {
      const etat = JSON.parse(readFileSync(fichier, 'utf8'))
      fiches.push({ instanceId: entree.name, fichier, pid: Number(etat.pid) })
    } catch {
      // Fiche illisible : un reste, justement. PID inconnu => considere mort.
      fiches.push({ instanceId: entree.name, fichier, pid: Number.NaN })
    }
  }
  return fiches
}

async function main() {
  const racine = racineDepot()
  const { instanceId, portDemande, enfant } = decouperArguments(process.argv.slice(2))
  if (enfant.length === 0) {
    console.error(
      '[instance-headless] aucune commande a executer. Usage : --instance-id <id> -- node scripts/xxx.mjs'
    )
    process.exit(2)
  }
  const racineInstances = join(racine, 'Audit', 'headless-instances')

  // Le ramassage a lieu AVANT le demarrage : un reste mort tient parfois encore le port.
  for (const fiche of restesAramasser({
    fiches: lireFiches(racineInstances),
    exclure: instanceId
  })) {
    rmSync(fiche, { force: true })
    console.error(`[instance-headless] reste ramasse : ${fiche}`)
  }

  const port = choisirPortLibre(portDemande)
  if (port === undefined) {
    console.error(
      `[instance-headless] aucun port libre entre ${portDemande} et ${portDemande + 19} — machine saturee.`
    )
    process.exit(3)
  }
  if (port !== portDemande)
    console.error(`[instance-headless] port ${portDemande} occupe — repli sur ${port}`)

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
  process.on('exit', arreter)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(signal, () => {
      arreter()
      process.exit(130)
    })
  }

  lanceur('Stop') // ferme un eventuel reste de la MEME instance avant d'ouvrir
  arrete = false
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
