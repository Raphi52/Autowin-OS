import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { realpathSync, watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  readGitDiff,
  readGitDiffHeadBatch,
  readGitState,
  readNoIndexGitDiff
} from '../git-read-main'
import { decoderCheminGit, type GitDiffResult } from '../../shared/git-read'
import type { ExecutionEvidence } from './types'
import {
  addedLineFingerprintsFromUnifiedDiff,
  exactLineFingerprint
} from '../exact-line-fingerprint'
import {
  beginAtEnd,
  captureFileGenerationMarker,
  captureFileGenerationMarkerSync,
  readNewLines,
  type FileTailState
} from '../task-manager/watchdog-file-source'

export type WorkspaceMutationSnapshot = ReadonlyMap<string, string> & {
  generationMarkers: ReadonlyMap<string, string>
  lineFingerprints: ReadonlyMap<string, readonly string[]>
  /** Positions exactes des fichiers surveillés, y compris ignorés par Git. */
  observedTails: ReadonlyMap<string, FileTailState>
}

const watcherSessionId = randomUUID()
const watchedDirectories = new Map<string, FSWatcher>()
const pathWatchGenerations = new Map<string, number>()

/**
 * Forme CANONIQUE d'un chemin — la seule que `fs.watch` accepte sans tuer le processus.
 *
 * DÉFAUT REPRODUIT (2026-08-31, exit 127) : `fs.watch` sur un dossier dont le chemin traverse un
 * nom court 8.3 de Windows (`C:\Users\RAPHAE~1.VIL\...`, la forme que rend `os.tmpdir()` sur ce
 * poste) fait ABORTER le processus — `Assertion failed: !_wcsnicmp(filename, dir, dirlen), file
 * src\win\fs-event.c, line 72`. libuv compare le nom LONG que Windows lui rend dans l'événement au
 * chemin COURT qu'on lui a donné : ils diffèrent, il assert. Reproduit en isolation sur 5 fichiers
 * touchés : chemin court → exit 127 ; MÊME dossier via `realpathSync.native` → exit 0, événements
 * reçus. Ni le `try/catch` ci-dessous ni `watcher.on('error')` n'y peuvent quoi que ce soit : un
 * `abort()` en C n'est pas une exception JS. C'est ce qui tuait `vitest run` en cours de suite.
 *
 * On canonicalise donc AVANT de watcher, et on le fait dans `filesystemPathKey` pour que la clé de
 * lecture et la clé d'écriture des générations restent la MÊME chaîne. Un chemin encore absent
 * (cas normal : on surveille l'apparition d'un fichier) n'a pas de realpath : on canonicalise alors
 * son parent et on rattache le nom.
 */
export function realCanonique(chemin: string): string {
  try {
    return realpathSync.native(chemin)
  } catch {
    const parent = dirname(chemin)
    if (parent === chemin) return chemin
    try {
      return join(realpathSync.native(parent), basename(chemin))
    } catch {
      return chemin
    }
  }
}

function filesystemPathKey(path: string): string {
  const normalized = realCanonique(resolve(path)).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function ensurePathGenerationWatcher(absolutePath: string): void {
  // Le dossier REELLEMENT surveille : jamais la forme courte 8.3 recue en argument.
  const parent = realCanonique(dirname(absolutePath))
  const parentKey = filesystemPathKey(parent)
  if (watchedDirectories.has(parentKey)) return
  try {
    const watcher = watch(parent, { persistent: false }, (_event, filename) => {
      if (!filename) return
      const changedPath = filesystemPathKey(resolve(parent, filename.toString()))
      const generation = (pathWatchGenerations.get(changedPath) ?? 0) + 1
      pathWatchGenerations.set(changedPath, generation)
    })
    watcher.on('error', () => {
      watcher.close()
      watchedDirectories.delete(parentKey)
    })
    watchedDirectories.set(parentKey, watcher)
  } catch {
    // Le marqueur de contenu/stat reste disponible même si le watcher n'est pas supporté.
  }
}

async function settlePathGenerationEvents(): Promise<void> {
  await new Promise<void>((resolveSettle) => setTimeout(resolveSettle, 10))
}

/**
 * Marqueur de génération du fichier de travail, distinct du contenu Git. Une réécriture externe
 * à l'identique change mtime/ctime et invalide ainsi une ancienne attribution causale.
 */
export async function captureWorkspacePathGenerationMarker(
  cwd: string,
  path: string
): Promise<string> {
  const absolute = resolve(cwd, path)
  const present = await captureFileGenerationMarker(absolute)
  if (present) return present
  try {
    ensurePathGenerationWatcher(absolute)
    await settlePathGenerationEvents()
    const restored = await captureFileGenerationMarker(absolute)
    if (restored) return restored
    return `missing:${watcherSessionId}:${pathWatchGenerations.get(filesystemPathKey(absolute)) ?? 0}`
  } catch {
    return `missing:${watcherSessionId}:${pathWatchGenerations.get(filesystemPathKey(absolute)) ?? 0}`
  }
}

function workspaceMutationSnapshot(
  entries: readonly (readonly [string, string, string, readonly string[]])[],
  observedTails: ReadonlyMap<string, FileTailState> = new Map()
): WorkspaceMutationSnapshot {
  return Object.assign(
    new Map(entries.map(([path, fingerprint]) => [path, fingerprint] as const)),
    {
      generationMarkers: new Map(
        entries.map(([path, , generationMarker]) => [path, generationMarker] as const)
      ),
      lineFingerprints: new Map(
        entries.map(([path, , , lineFingerprints]) => [path, lineFingerprints] as const)
      ),
      observedTails
    }
  )
}

function workspaceRelativePath(cwd: string, path: string): string | undefined {
  const root = resolve(cwd)
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const rel = relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined
  return rel.replaceAll('\\', '/')
}

function multisetDifference(before: readonly string[], after: readonly string[]): string[] {
  const remaining = new Map<string, number>()
  for (const fingerprint of before) {
    remaining.set(fingerprint, (remaining.get(fingerprint) ?? 0) + 1)
  }
  return after.filter((fingerprint) => {
    const count = remaining.get(fingerprint) ?? 0
    if (count === 0) return true
    if (count === 1) remaining.delete(fingerprint)
    else remaining.set(fingerprint, count - 1)
    return false
  })
}

/**
 * LA PHOTO NE DOIT PAS GROSSIR AVEC LE NOMBRE DE CONVERSATIONS (mesure 2026-10-10, conv-172).
 *
 * Le chat la prend avant ET apres chaque reponse. Elle lancait un `git diff` PAR fichier modifie
 * (deux par fichier non suivi), tous a la fois : 308 fichiers non commites = 175 processus git par
 * photo. L'attente avant envoi est passee de ~1 s (un fil) a 7-22 s (2-3 fils), et trois photos
 * rejouees ensemble sur le meme dossier prenaient ~150 s chacune. Trois corrections, sans changer
 * d'un octet les empreintes (l'onglet Fichiers les compare a celles deja enregistrees) :
 *  1. un seul `git diff HEAD` pour tous les fichiers suivis (`diffsDuLot`) ;
 *  2. au plus `PARALLELE_MAX` processus en vol pour ce qui reste fichier par fichier ;
 *  3. les demandes SIMULTANEES sur le meme dossier partagent une photo (`captureMutualisee`).
 */
const PARALLELE_MAX = 8

/**
 * Au-dela, la portion part par l'ancien chemin unitaire : `readGitDiff` a le `maxBuffer` par defaut
 * (1 Mo) et TRONQUE un tres gros diff — le lot, lui, le rendrait entier, donc une autre empreinte.
 */
const PORTION_LOT_OCTETS_MAX = 512 * 1024

/** Un chemin qui contient un joker est un MOTIF pour git : seul, il ramene d'autres fichiers. */
const CHEMIN_NON_LITTERAL = /[*?[\\]|^:/

type DiffsDuLot = {
  /** Texte exact que `git diff HEAD -- chemin` aurait rendu seul. */
  portions: Map<string, string>
  /** Chemins dont `git diff HEAD -- chemin` est PROUVE vide : il ne reste que l'etape `--no-index`. */
  vides: Set<string>
}

/**
 * Decoupe un lot `git diff --no-renames` par son entete `diff --git a/P b/P`. Sans renommage, les
 * deux cotes sont le MEME chemin : on le retrouve sans ambiguite meme s'il contient des espaces.
 *
 * ENTETE CITE (heal conv-204, 2026-10-10) : un nom non ASCII arrive cite des deux cotes,
 * `"a/accentu\303\251.ts" "b/accentu\303\251.ts"`. Tant que `git status` gardait lui aussi la forme
 * citee, aucun vrai nom accentue n'entrait dans le lot ; depuis qu'il est decode, ce bloc doit etre
 * attribue — sinon UN SEUL fichier accentue renvoyait toute la photo au diff fichier par fichier.
 * Seul l'entete est decode : la portion rendue reste le texte EXACT de git.
 */
function cheminDeLEntete(bloc: string): string | undefined {
  const finDeLigne = bloc.indexOf('\n')
  const entete = finDeLigne === -1 ? bloc : bloc.slice(0, finDeLigne)
  const cite = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/.exec(entete)
  if (cite) {
    const gauche = decoderCheminGit(cite[1] as string)
    const droite = decoderCheminGit(cite[2] as string)
    if (!gauche.startsWith('a/') || droite !== `b/${gauche.slice(2)}`) return undefined
    return gauche.slice(2) || undefined
  }
  if (!entete.startsWith('a/')) return undefined
  const reste = entete.slice(2)
  const longueur = (reste.length - 3) / 2
  if (!Number.isInteger(longueur) || longueur <= 0) return undefined
  const chemin = reste.slice(0, longueur)
  return reste.slice(longueur) === ` b/${chemin}` ? chemin : undefined
}

async function diffsDuLot(
  cwd: string,
  chemins: readonly string[]
): Promise<DiffsDuLot | undefined> {
  const litteraux = chemins.filter((chemin) => !CHEMIN_NON_LITTERAL.test(chemin))
  if (litteraux.length === 0) return undefined
  const sorties = await readGitDiffHeadBatch(cwd, litteraux)
  if (!sorties) return undefined
  const demandes = new Set(litteraux)
  const portions = new Map<string, string>()
  const tropGros = new Set<string>()
  let blocNonAttribue = false
  for (const sortie of sorties) {
    for (const bloc of sortie.split(/^diff --git /m).slice(1)) {
      const chemin = cheminDeLEntete(bloc)
      if (!chemin || !demandes.has(chemin) || portions.has(chemin) || tropGros.has(chemin)) {
        blocNonAttribue = true
        continue
      }
      const portion = `diff --git ${bloc}`
      if (Buffer.byteLength(portion, 'utf8') > PORTION_LOT_OCTETS_MAX) tropGros.add(chemin)
      else portions.set(chemin, portion)
    }
  }
  // Un seul bloc non attribue suffit a ne plus rien PROUVER vide : ces chemins repartent par
  // `readGitDiff` entier, exactement comme avant.
  const vides = blocNonAttribue
    ? new Set<string>()
    : new Set(litteraux.filter((chemin) => !portions.has(chemin) && !tropGros.has(chemin)))
  return { portions, vides }
}

/** Meme resultat que `readGitDiff(cwd, chemin)`, sans relancer ce que le lot a deja lu. */
async function diffDuChemin(
  cwd: string,
  chemin: string,
  lot: DiffsDuLot | undefined
): Promise<GitDiffResult> {
  const portion = lot?.portions.get(chemin)
  if (portion !== undefined) return { available: true, diff: portion }
  if (lot?.vides.has(chemin)) return { available: true, diff: await diffNonSuivi(cwd, chemin) }
  return readGitDiff(cwd, chemin)
}

/**
 * UNE ENTREE NON SUIVIE INCHANGEE NE SE REDIFFE PAS — heal conv-204, mesure du 2026-10-10.
 *
 * Apres le lot, une photo du depot reel lancait encore 91 `git diff --no-index` (banc sur
 * D:/Autowin : 95 processus par photo), un par entree non suivie, alors que presque toutes sont
 * identiques d'une photo a l'autre. Le texte de git est donc RE-SERVI tel quel tant que l'entree
 * garde la meme GENERATION : meme octet, donc meme empreinte. Une generation illisible (chemin
 * absent) ne se memorise jamais — elle repasse par git, comme avant.
 */
const MEMO_NON_SUIVIS_OCTETS_MAX = 16 * 1024 * 1024
const diffsNonSuivisMemorises = new Map<
  string,
  { generation: string; diff: string; octets: number }
>()
let octetsNonSuivisMemorises = 0

/**
 * Fichier : le marqueur de generation de la photo (identite, taille, dates a la nanoseconde,
 * empreinte du debut). Dossier : git n'y lit AUCUN contenu (`--no-index /dev/null dossier/` echoue
 * et rend un texte vide) — sa seule dependance est l'apparition d'une entree, qui change ses dates.
 */
async function generationDeLEntree(absolu: string): Promise<string | undefined> {
  try {
    const info = await stat(absolu, { bigint: true })
    if (info.isDirectory()) return `dossier:${info.dev}:${info.ino}:${info.mtimeNs}:${info.ctimeNs}`
  } catch {
    return undefined
  }
  return captureFileGenerationMarker(absolu)
}

function oublierDiffNonSuivi(cle: string): void {
  const ancien = diffsNonSuivisMemorises.get(cle)
  if (!ancien) return
  octetsNonSuivisMemorises -= ancien.octets
  diffsNonSuivisMemorises.delete(cle)
}

function memoriserDiffNonSuivi(cle: string, generation: string, diff: string): void {
  oublierDiffNonSuivi(cle)
  const octets = Buffer.byteLength(diff, 'utf8')
  if (octets > PORTION_LOT_OCTETS_MAX) return
  diffsNonSuivisMemorises.set(cle, { generation, diff, octets })
  octetsNonSuivisMemorises += octets
  // Budget borne : on oublie les plus anciennes d'abord (ordre d'insertion de la Map).
  for (const [plusAncienne] of diffsNonSuivisMemorises) {
    if (octetsNonSuivisMemorises <= MEMO_NON_SUIVIS_OCTETS_MAX) break
    oublierDiffNonSuivi(plusAncienne)
  }
}

async function diffNonSuivi(cwd: string, chemin: string): Promise<string> {
  const absolu = resolve(cwd, chemin)
  const cle = `${filesystemPathKey(cwd)}\u0000${chemin}`
  const avant = await generationDeLEntree(absolu)
  const memo = diffsNonSuivisMemorises.get(cle)
  if (avant && memo?.generation === avant) return memo.diff
  const diff = await readNoIndexGitDiff(cwd, chemin)
  const apres = avant ? await generationDeLEntree(absolu) : undefined
  /*
   * On ne retient que ce que git a lu d'une generation STABLE pendant toute sa lecture. Un texte
   * vide pour un FICHIER n'est jamais retenu : git rend toujours au moins l'entete d'un fichier
   * present, un vide signale donc un echec de git, qu'on ne doit pas figer.
   */
  const fiable = diff !== '' || avant?.startsWith('dossier:') === true
  if (avant && apres === avant && fiable) memoriserDiffNonSuivi(cle, avant, diff)
  else oublierDiffNonSuivi(cle)
  return diff
}

async function enParalleleBorne<T, R>(
  elements: readonly T[],
  limite: number,
  tache: (element: T) => Promise<R>
): Promise<R[]> {
  const resultats = new Array<R>(elements.length)
  let suivant = 0
  const ouvrier = async (): Promise<void> => {
    while (suivant < elements.length) {
      const index = suivant++
      resultats[index] = await tache(elements[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, elements.length) }, ouvrier))
  return resultats
}

type FileDeCapture = {
  enCours: Promise<WorkspaceMutationSnapshot>
  suivante?: Promise<WorkspaceMutationSnapshot>
}
const capturesParDossier = new Map<string, FileDeCapture>()

function lancerCapture(
  cle: string,
  capturer: () => Promise<WorkspaceMutationSnapshot>
): Promise<WorkspaceMutationSnapshot> {
  const file: FileDeCapture = { enCours: capturer() }
  capturesParDossier.set(cle, file)
  const liberer = (): void => {
    if (capturesParDossier.get(cle) === file && !file.suivante) capturesParDossier.delete(cle)
  }
  file.enCours.then(liberer, liberer)
  return file.enCours
}

/**
 * Photos SIMULTANEES d'un meme dossier : au plus une en cours et une en attente, quel que soit le
 * nombre de conversations. On ne rejoint JAMAIS la photo deja en cours — elle a pu lire le disque
 * AVANT la demande et manquer une ecriture du tour qui la demande. On rejoint la SUIVANTE, qui
 * demarre forcement apres : chaque demandeur recoit une photo prise apres sa demande.
 */
function captureMutualisee(
  cle: string,
  capturer: () => Promise<WorkspaceMutationSnapshot>
): Promise<WorkspaceMutationSnapshot> {
  const file = capturesParDossier.get(cle)
  if (!file) return lancerCapture(cle, capturer)
  if (!file.suivante) {
    const relancer = (): Promise<WorkspaceMutationSnapshot> => lancerCapture(cle, capturer)
    file.suivante = file.enCours.then(relancer, relancer)
  }
  return file.suivante
}

export function captureWorkspaceMutationSnapshot(
  cwd: string,
  observedPaths: readonly string[] = []
): Promise<WorkspaceMutationSnapshot> {
  const normalizedObserved = [
    ...new Set(
      observedPaths.flatMap((path) => {
        const relativePath = workspaceRelativePath(cwd, path)
        return relativePath ? [relativePath] : []
      })
    )
  ]
  const cle = [filesystemPathKey(cwd), ...[...normalizedObserved].sort()].join('\u0000')
  return captureMutualisee(cle, () => capturerMaintenant(cwd, normalizedObserved))
}

async function capturerMaintenant(
  cwd: string,
  normalizedObserved: readonly string[]
): Promise<WorkspaceMutationSnapshot> {
  const git = await readGitState(cwd, 0)
  const observedTails = new Map(
    await Promise.all(
      normalizedObserved.map(async (path) => [path, await beginAtEnd(resolve(cwd, path))] as const)
    )
  )
  if (!git.available || !git.state) return workspaceMutationSnapshot([], observedTails)
  const cheminsDuStatut = git.state.changes.map((change) => change.path.replaceAll('\\', '/'))
  const paths = [...new Set([...cheminsDuStatut, ...normalizedObserved])]
  // Le lot ne porte QUE les entrees du statut : ce sont des fichiers (ou des dossiers non suivis
  // entiers). Un chemin seulement OBSERVE peut etre un dossier aux fichiers suivis : seul, son diff
  // les englobe tous — il garde donc l'ancien chemin unitaire.
  const lot = await diffsDuLot(cwd, [...new Set(cheminsDuStatut)])
  const entries = await enParalleleBorne(paths, PARALLELE_MAX, async (path) => {
    const diff = await diffDuChemin(cwd, path, lot)
    const generationMarker = await captureWorkspacePathGenerationMarker(cwd, path)
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          diff: diff.available ? (diff.diff ?? '') : `unavailable:${diff.error ?? ''}`,
          generationMarker
        }),
        'utf8'
      )
      .digest('hex')
    return [
      path,
      fingerprint,
      generationMarker,
      diff.available ? addedLineFingerprintsFromUnifiedDiff(diff.diff ?? '') : []
    ] as const
  })
  return workspaceMutationSnapshot(entries, observedTails)
}

export async function appendWorkspaceMutationEvidence(
  before: WorkspaceMutationSnapshot,
  cwd: string,
  evidence: ExecutionEvidence[]
): Promise<void> {
  try {
    const observedPaths = [...before.observedTails.keys()]
    const observedReadings = new Map(
      await Promise.all(
        observedPaths.map(
          async (path) =>
            [path, await readNewLines(resolve(cwd, path), before.observedTails.get(path)!)] as const
        )
      )
    )
    const after = await captureWorkspaceMutationSnapshot(cwd, observedPaths)
    const paths = [...after.entries()]
      .filter(([path, fingerprint]) => before.get(path) !== fingerprint)
      .map(([path]) => path)
      .sort()
    if (paths.length === 0) return
    const pathGenerationMarkers = Object.fromEntries(
      paths.map((path) => [path, after.generationMarkers.get(path) as string])
    )
    const writtenLineFingerprintsByPath = Object.fromEntries(
      paths.flatMap((path) => {
        const observedLines = observedReadings.get(path)?.lines
        const fingerprints = observedLines
          ? observedLines.map(exactLineFingerprint)
          : multisetDifference(
              before.lineFingerprints.get(path) ?? [],
              after.lineFingerprints.get(path) ?? []
            )
        return fingerprints.length ? [[path, fingerprints]] : []
      })
    )
    evidence.push({
      type: 'workspace_delta',
      kind: 'mutation',
      status: 'completed',
      ok: true,
      summary: `${paths.length} fichier(s) modifié(s) dans le worktree isolé`,
      paths,
      workspaceRoot: cwd,
      pathFingerprints: Object.fromEntries(paths.map((path) => [path, after.get(path) as string])),
      pathBaseFingerprints: Object.fromEntries(
        paths.map((path) => [path, before.get(path) ?? null])
      ),
      pathBaseGenerationMarkers: Object.fromEntries(
        paths.map((path) => [path, before.generationMarkers.get(path) ?? null])
      ),
      pathGenerationMarkers,
      ...(Object.keys(writtenLineFingerprintsByPath).length > 0
        ? { writtenLineFingerprintsByPath }
        : {})
    })
  } catch {
    // Une preuve best-effort ne doit jamais transformer un tour réussi en échec.
  }
}

/**
 * Decoupe un diff unifie MULTI-FICHIERS en portions, indexees par le chemin d'apres (`+++ b/...`).
 *
 * Le chemin d'APRES est le bon : c'est celui que l'appelant a demande, et il survit a un renommage.
 * Un fichier supprime (`+++ /dev/null`) n'apporte aucune ligne ajoutee — il est simplement absent.
 */
export function decouperDiffParFichier(diff: string): Map<string, string> {
  const portions = new Map<string, string>()
  if (!diff) return portions
  for (const bloc of diff.split(/^diff --git /m).slice(1)) {
    const entete = /^\+\+\+ b\/(.+)$/m.exec(bloc)
    const chemin = entete?.[1]?.trim()
    if (!chemin || chemin === '/dev/null') continue
    portions.set(chemin, `diff --git ${bloc}`)
  }
  return portions
}

/**
 * Preuve causale issue du commit IMMUTABLE préparé par WorktreeManager. Contrairement au snapshot
 * du répertoire vivant, cette plage ne peut pas rater une écriture arrivée juste avant `git add`, ni
 * attribuer une écriture arrivée après le commit (elle n'est alors pas publiée dans cette SHA).
 */
export function preparedCommitMutationEvidence(
  cwd: string,
  baseSha: string,
  agentSha: string,
  observedPaths: readonly string[]
): ExecutionEvidence[] {
  if (!/^[0-9a-f]{40,64}$/i.test(baseSha) || !/^[0-9a-f]{40,64}$/i.test(agentSha)) return []
  const paths = [
    ...new Set(
      observedPaths.flatMap((path) => {
        const relativePath = workspaceRelativePath(cwd, path)
        return relativePath ? [relativePath] : []
      })
    )
  ]
  if (paths.length === 0) return []
  /*
   * UN SEUL `git diff` POUR TOUS LES FICHIERS, pas un par fichier.
   *
   * Mesure du 2026-09-03 (`gels.jsonl`, 536 gels) : `execFileSync` coute 145 ms par appel EN
   * MOYENNE sur ce depot, et il est lance ici sur le thread qui dessine la fenetre, une fois par
   * fichier touche — un run qui touche dix fichiers figeait donc la fenetre pres d'une seconde et
   * demie, a chaque preuve de mutation. `git diff` accepte tous les chemins d'un coup ; il ne reste
   * qu'a decouper sa sortie par fichier, ce que ses entetes `diff --git` permettent exactement.
   */
  const diffParFichier = new Map<string, string>()
  try {
    const stdout = execFileSync(
      'git',
      [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--text',
        '--unified=0',
        `${baseSha}...${agentSha}`,
        '--',
        ...paths
      ],
      { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }
    )
    for (const [path, portion] of decouperDiffParFichier(stdout)) diffParFichier.set(path, portion)
  } catch {
    // Une preuve best-effort ne doit jamais transformer un tour reussi en echec.
  }
  const entries = paths.map((path) => {
    try {
      const portion = diffParFichier.get(path)
      if (portion === undefined) return undefined
      const fingerprints = addedLineFingerprintsFromUnifiedDiff(portion)
      if (!fingerprints.length) return undefined
      const generationMarker = captureFileGenerationMarkerSync(resolve(cwd, path))
      if (!generationMarker) return undefined
      return [path, fingerprints, generationMarker] as const
    } catch {
      return undefined
    }
  })
  const claimed = entries.filter(
    (entry): entry is readonly [string, string[], string] => entry !== undefined
  )
  if (claimed.length === 0) return []
  return [
    {
      type: 'workspace_delta',
      kind: 'mutation',
      status: 'completed',
      ok: true,
      summary: `${claimed.length} fichier(s) causal(aux) confirmé(s) dans le commit publié`,
      paths: claimed.map(([path]) => path),
      workspaceRoot: cwd,
      pathGenerationMarkers: Object.fromEntries(
        claimed.map(([path, , generationMarker]) => [path, generationMarker])
      ),
      writtenLineFingerprintsByPath: Object.fromEntries(
        claimed.map(([path, fingerprints]) => [path, fingerprints])
      )
    }
  ]
}
