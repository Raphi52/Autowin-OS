import { Worker } from 'node:worker_threads'

/**
 * EXÉCUTER UNE COMMANDE SANS TENIR LE FIL PRINCIPAL (heal « les lags », conv-1413, 2026-10-31).
 *
 * `execFile` n'est asynchrone que pour la suite : la CRÉATION du processus (CreateProcess) bloque le
 * fil qui l'appelle. Sur ce poste elle attend au-dessus du disque (note Brain « les blocages de 10 s
 * ne viennent pas du SSD »), et un seul `git` a tenu la fenêtre jusqu'à 22,9 s. Mesure `gels.jsonl`
 * du 2026-10-31 19:33 → 20:22 UTC, une seule session : 456,7 s de fenêtre figée, dont
 * `git diff`/`git fetch` de la vérification de mise à jour (`git-update.ts`, 86,6 s), les `git` de la
 * publication des tours (`run-autoclose.ts`, 65 s), `tasklist`/`cmd.exe` de la mise à jour du CLI
 * (37 s) et `git config` du journal des besoins (19,3 s).
 *
 * `lancement-hors-fil.ts` règle le cas d'un processus DÉTACHÉ (on n'attend pas sa sortie). Ici on
 * attend la sortie : un fil dédié, créé à la demande et gardé ensuite, porte les créations ; le fil
 * principal n'échange que des messages. Le code du fil tient dans une chaîne, comme
 * `lancement-hors-fil.ts` : aucun fichier de plus à construire ni à empaqueter.
 */
/*
 * UN PROCESSUS SORTI EST FINI, MÊME SI SON TUYAU RESTE OUVERT AILLEURS (kaizen conv-1432, 2026-11-02).
 *
 * `execFile` ne rend la main qu'à la FIN DE FICHIER de stdout/stderr. Or ce fil crée ses processus
 * en même temps que le fil principal crée les siens, et sous Windows CreateProcess hérite de TOUTES
 * les poignées héritables du processus : un enfant lancé au même instant par l'autre fil reçoit une
 * copie de l'extrémité d'écriture de notre tuyau, et la fin de fichier n'arrive qu'à SA sortie.
 * Mesuré : un `git status` du 2026-11-02 08:02:41 UTC tenu 52 min par le CLI Claude de conv-1433,
 * lancé à la même seconde ; derrière lui, toutes les photos git du dossier, et quatre tours coupés
 * par le veilleur d'inactivité sans que le modèle ait démarré (conv-1429, conv-1432).
 *
 * La sortie du processus est le vrai signal de fin. Après elle, on laisse le tuyau se vider tant que
 * des octets arrivent ; au bout de FIN_SANS_EOF_MS sans un octet, on ferme nos extrémités, ce qui
 * déclenche le rappel d'execFile avec tout ce qui a été lu. Le contrôle passe par setImmediate :
 * après un fil figé, le minuteur expire AVANT la lecture des octets en attente ; l'immédiat, lui,
 * vient après cette lecture, donc on ne coupe jamais une sortie déjà écrite.
 */
const FIN_SANS_EOF_MS = 1500

const CODE_DU_FIL = `const { execFile } = require('node:child_process')
const { parentPort } = require('node:worker_threads')
const FIN_SANS_EOF_MS = ${FIN_SANS_EOF_MS}
function finirApresSortie(enfant) {
  let dernierOctet = Date.now()
  const noter = () => { dernierOctet = Date.now() }
  if (enfant.stdout) enfant.stdout.on('data', noter)
  if (enfant.stderr) enfant.stderr.on('data', noter)
  enfant.once('exit', () => {
    let minuteur
    const fermer = () => {
      if (enfant.stdout) enfant.stdout.destroy()
      if (enfant.stderr) enfant.stderr.destroy()
    }
    const verifier = () => setImmediate(() => {
      const calme = Date.now() - dernierOctet
      if (calme >= FIN_SANS_EOF_MS) fermer()
      else minuteur = setTimeout(verifier, FIN_SANS_EOF_MS - calme)
    })
    noter()
    minuteur = setTimeout(verifier, FIN_SANS_EOF_MS)
    enfant.once('close', () => clearTimeout(minuteur))
  })
}
parentPort.on('message', ({ id, fichier, args, options }) => {
  try {
    const enfant = execFile(fichier, args, options, (erreur, stdout, stderr) => {
      parentPort.postMessage({
        id,
        stdout,
        stderr,
        erreur: erreur
          ? { message: erreur.message, code: erreur.code, signal: erreur.signal, killed: erreur.killed }
          : undefined
      })
    })
    finirApresSortie(enfant)
  } catch (erreur) {
    parentPort.postMessage({ id, stdout: '', stderr: '', erreur: { message: String(erreur && erreur.message || erreur) } })
  }
})`

/** Options d'`execFile` qui traversent un message (aucune fonction, aucun signal d'annulation). */
export interface OptionsHorsFil {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeout?: number
  maxBuffer?: number
  windowsHide?: boolean
  shell?: boolean | string
  encoding?: BufferEncoding
}

interface Reponse {
  id: number
  stdout: string | Uint8Array
  stderr: string | Uint8Array
  erreur?: { message: string; code?: number | string; signal?: string | null; killed?: boolean }
}

/** L'erreur que rendrait `execFile`, avec ses champs lus par les appelants (`code`, `stderr`…). */
export interface ErreurHorsFil extends Error {
  code?: number | string
  signal?: string | null
  killed?: boolean
  stdout: string
  stderr: string
}

let fil: Worker | null = null
let prochainId = 1
const enAttente = new Map<number, { resolve: (r: Reponse) => void; reject: (e: Error) => void }>()

/** Le fil ne retient l'application que tant qu'une commande attend sa sortie. */
function ajusterRetenue(): void {
  if (!fil) return
  if (enAttente.size > 0) fil.ref()
  else fil.unref()
}

function filDExecution(): Worker {
  if (fil) return fil
  const nouveau = new Worker(CODE_DU_FIL, { eval: true })
  const abandonner = (motif: Error): void => {
    if (fil === nouveau) fil = null
    for (const attente of enAttente.values()) attente.reject(motif)
    enAttente.clear()
  }
  nouveau.on('message', (reponse: Reponse) => {
    const attente = enAttente.get(reponse.id)
    if (!attente) return
    enAttente.delete(reponse.id)
    ajusterRetenue()
    attente.resolve(reponse)
  })
  nouveau.on('error', (erreur) => abandonner(erreur))
  nouveau.on('exit', (code) =>
    abandonner(new Error(`fil d'exécution arrêté (code ${code}) avant la fin de la commande`))
  )
  nouveau.unref()
  fil = nouveau
  return nouveau
}

function enTexte(valeur: string | Uint8Array | undefined, encodage: BufferEncoding): string {
  if (valeur === undefined) return ''
  if (typeof valeur === 'string') return valeur
  return Buffer.from(valeur.buffer, valeur.byteOffset, valeur.byteLength).toString(encodage)
}

/**
 * Équivalent de `promisify(execFile)` : rend `{ stdout, stderr }`, et rejette comme lui (code de
 * sortie non nul, programme absent, délai dépassé) avec une erreur qui porte `code`, `signal`,
 * `killed`, `stdout` et `stderr`. L'environnement est celui du fil principal AU MOMENT de l'appel.
 */
export function execFileHorsFil(
  fichier: string,
  args: readonly string[],
  options: OptionsHorsFil = {}
): Promise<{ stdout: string; stderr: string }> {
  const encoding = options.encoding ?? 'utf8'
  const optionsDuFil = { ...options, encoding, env: { ...(options.env ?? process.env) } }
  return new Promise<Reponse>((resolve, reject) => {
    const id = prochainId++
    enAttente.set(id, { resolve, reject })
    const cible = filDExecution()
    ajusterRetenue()
    try {
      cible.postMessage({ id, fichier, args: [...args], options: optionsDuFil })
    } catch (erreur) {
      enAttente.delete(id)
      ajusterRetenue()
      reject(erreur instanceof Error ? erreur : new Error(String(erreur)))
    }
  }).then((reponse) => {
    const stdout = enTexte(reponse.stdout, encoding)
    const stderr = enTexte(reponse.stderr, encoding)
    if (!reponse.erreur) return { stdout, stderr }
    const erreur = new Error(reponse.erreur.message) as ErreurHorsFil
    erreur.code = reponse.erreur.code
    erreur.signal = reponse.erreur.signal
    erreur.killed = reponse.erreur.killed
    erreur.stdout = stdout
    erreur.stderr = stderr
    throw erreur
  })
}

/** Pour les tests : arrête le fil (il sera recréé au prochain appel). */
export async function arreterFilDExecution(): Promise<void> {
  const courant = fil
  fil = null
  if (courant) await courant.terminate()
}
