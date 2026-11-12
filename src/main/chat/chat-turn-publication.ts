import { existsSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ConversationFileTrace } from '../activity/conversation-file-trace-spool'
import { appliquerLeTour, ouvrirCopieDeBase, type CopieDeBase } from '../git/comparaison-a-la-base'
import { exactLineFingerprint } from '../fichiers/exact-line-fingerprint'
import { titreDeCommitAuto } from '../git/titre-de-commit'
import { lireLangueReglee } from '../profil/langue-reglage'
import type { Langue } from '../../shared/langue'
import type { TypageAvantPublication } from '../verify/typage-avant-publication'
import {
  autoCloseBranch,
  autoCloseRun,
  defaultGitRunner,
  parsePorcelainPaths,
  type AutoCloseReport,
  type GitRunner,
  type PrOpener,
  type VerificationAvantPublication
} from '../runs/run-autoclose'
import {
  arbreDeLaCopie,
  garderLeTravailDuFil,
  ligneDePorte,
  type PublicationDUneCopie,
  type ResultatGarder
} from '../orchestration/garder-un-essai'
import { entrerLeTravailDeLaCopie } from '../copies/copie-de-tache'
import { dossierDeCopieDeTache, racineDesCopiesDeTaches } from '../copies/chemins-de-copies'
import { lireLaBaseDuFil } from '../git/photo-du-code'
import { memeCheminSurDisque } from '../fichiers/meme-chemin'
import { SUITE_QUAND_LA_PORTE_RETENTE_SEULE } from './reparation-du-refus'

/**
 * ENCHAÎNEMENT AUTO DU CHAT.
 *
 * Choix de l'utilisateur (2026-09-26) : « aussi le travail du chat : à la fin de chaque tour
 * qui a modifié des fichiers, commit de ces fichiers-là puis push ». Avant, l'interrupteur ne se
 * déclenchait qu'à la fin d'une tâche d'agent (`os.ts`, `closeGreenRun`). Mesuré du 24/09 20:13 au
 * 26/09 13:50 : 64 commits sur main, 1 seul publié tout seul, les 63 autres poussés à la main.
 *
 * LE DOSSIER EST PARTAGÉ PAR PLUSIEURS FILS, et le journal des fichiers attribue aussi à un tour ce
 * qu'un autre fil a écrit pendant qu'il tournait (mesuré le 2026-09-26 : `ChatComposer.tsx`, écrit
 * Attribué aussi par la comparaison avant/après). Un fichier n'est
 * donc publié que s'il est PROUVÉ au fil :
 *  1. par ses LIGNES : chaque ligne ajoutée de son diff a été écrite par un outil d'édition du fil ;
 *  2. à défaut, il était propre au début du tour ET le TOUR l'a nommé dans une commande shell
 *     d'écriture (`prettier --write`, `cat >>`, `sed -i`… — trace `nommeParCommande`) ET aucun
 *     autre fil ne l'a nommé ni réclamé par lignes pendant le tour. Qu'un autre fil l'ait seulement
 *     VU changer (sa comparaison avant/après, sans lignes), ou ait un tour en cours, n'y change rien.
 *     Mesuré le 2026-10-13 : d7af3730 (test reformaté par `prettier --write`) et dd0c3d6a
 *     (test complété par `cat >> … <<'EOF'`) ont publié le code sans son test, écarté
 *     parce que, puis, l'avaient vu changer pendant leur propre tour.
 *  3. à défaut (édition en ligne de commande non nommée, suppression, renommage) : il était propre
 *     au début du tour ET aucun autre fil ne l'a touché depuis ET aucun autre fil n'a de tour EN
 *     COURS dans le dépôt. Un tour en cours n'a encore rien écrit au journal : `agent-pilot.ts` n'y
 *     trace les éditions du modèle qu'à la FIN de son appel. Mesuré le 2026-09-30 (5fb0730d,
 *     bb8e6c0c) : un fil écrit ses fichiers pendant les tours, ses traces arrivent à
 *     10:51:52, après les deux publications (10:32:31, 10:49:54) — qui ont donc commité
 *     son travail.
 * Le reste est LAISSÉ en attente et nommé dans le rapport, avec le nombre de lignes que le fil ne
 * réclame pas (les réécrire avec l'outil d'édition suffit à le publier). Un faux négatif laisse un
 * fichier non publié, visible dans le panneau ; un faux positif pousserait le travail d'un autre fil
 * sans lui.
 */

/** Travail propre au chat. `subagent` en est exclu : une tâche d'agent publie elle-même son travail. */
const SOURCES_DU_CHAT: ReadonlySet<ConversationFileTrace['source']> = new Set([
  'chat_tool',
  'edit_file',
  'file_command'
])

/** Au-delà, un fichier non suivi n'est pas relu pour la preuve par lignes (binaire, export…). */
const TAILLE_MAX_PREUVE = 2 * 1024 * 1024

export interface ChatTurnStart {
  /** Instant de départ du tour : toute trace d'un autre fil ultérieure est du travail concurrent. */
  startedAt: number
  /** Racine du dépôt git du tour ; absente = pas de dépôt lisible, donc rien à publier. */
  repo?: string
  /** Chemins (relatifs au dépôt) déjà modifiés au départ du tour. */
  dirty: string[]
}

type Exclusion = NonNullable<AutoCloseReport['exclus']>[number]

/** Au-delà, le panneau n'en nommerait pas plus utilement : le rapport donne le total. */
const ERREURS_DE_TYPAGE_NOMMEES = 10

function cle(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function absoluDeTrace(racine: string, path: string): string {
  return resolve(
    racine,
    path
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\.\/+/, '')
  )
}

/**
 * Chemin RÉEL d'un dossier : git rend la forme longue (`prenom.nom`), un dossier temporaire
 * Windows peut arriver en nom court (`PRENOM~1.NOM`). Sans cette résolution, le même fichier aurait
 * deux clés et le tour ne reconnaîtrait pas le sien.
 */
async function cheminsReels(dossiers: Iterable<string>): Promise<Map<string, string>> {
  const reels = new Map<string, string>()
  for (const dossier of new Set(dossiers))
    reels.set(dossier, await realpath(dossier).catch(() => dossier))
  return reels
}

function dansLeDepot(repo: string, absolu: string): boolean {
  const rel = relative(repo, absolu)
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}

function contient(parent: string, enfant: string): boolean {
  const rel = relative(parent, enfant)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Le dossier d'un tour peut écrire dans le dépôt : il est le dépôt, en est un sous-dossier, ou le
 * contient. SAUF s'il appartient à un AUTRE arbre de travail rangé sous le dépôt : la copie d'un fil
 * vit sous `.autowin-data`, ignoré par git, mais git et le tour y travaillent dans la copie, dont le
 * travail n'entre dans le dépôt que par la porte. Comptée comme le dépôt, la copie dont un tour
 * tourne faisait mettre de côté (`autre-fil-en-cours`) le travail des fils restés dans le dépôt.
 * fix-ok: cause mesurée — `relative(dépôt, <dépôt>/.autowin-data/…/essai__…)` ne sort pas du dépôt, donc
 * `partageLeDepot` rendait vrai pour une copie liée (rouge : `partage.ts` exclu `autre-fil-en-cours`).
 */
export function partageLeDepot(repo: string, dossier: string): boolean {
  if (contient(dossier, repo)) return true
  if (!contient(repo, dossier)) return false
  // Un `.git` entre le dossier et le dépôt (fichier d'une copie liée, dossier d'un dépôt imbriqué)
  // est l'endroit où git s'arrête de remonter : en dessous, ce n'est plus l'arbre du dépôt.
  for (
    let courant = resolve(dossier);
    relative(repo, courant) && dirname(courant) !== courant;
    courant = dirname(courant)
  )
    if (existsSync(join(courant, '.git'))) return false
  return true
}

/**
 * La photo est ATTENDUE avant que le tour parte (~65 ms mesurées sur D:\AutoWinOS). Un git bloqué
 * (dossier réseau, verrou) ne doit jamais retenir la réponse : passé ce délai, le tour part sans
 * photo, donc sans publication.
 */
const DELAI_MAX_PHOTO_MS = 5_000

/** Photo prise AVANT le tour : ce qui était déjà modifié n'appartient pas au tour. */
export async function photographierDebutDeTour(
  workspaceRoot: string,
  runGit?: GitRunner,
  now: number = Date.now(),
  delaiMaxMs: number = DELAI_MAX_PHOTO_MS
): Promise<ChatTurnStart> {
  const sansPhoto: ChatTurnStart = { startedAt: now, dirty: [] }
  // Un dossier vide ferait tourner git dans le dossier courant du processus : jamais celui du tour.
  if (!workspaceRoot.trim()) return sansPhoto
  const photo = async (): Promise<ChatTurnStart> => {
    const git = runGit ?? (await defaultGitRunner())
    const repo = (await git(['rev-parse', '--show-toplevel'], workspaceRoot)).trim()
    if (!repo) return sansPhoto
    const dirty = parsePorcelainPaths(await git(['status', '--porcelain=v1', '-z', '-uall'], repo))
    return { startedAt: now, repo, dirty }
  }
  let minuteur: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      photo(),
      new Promise<ChatTurnStart>((resolveDelai) => {
        minuteur = setTimeout(() => resolveDelai(sansPhoto), delaiMaxMs)
      })
    ])
  } catch {
    // Sans photo fiable, on ne saurait pas ce qui préexistait : aucun dépôt, donc aucune publication.
    return sansPhoto
  } finally {
    if (minuteur) clearTimeout(minuteur)
  }
}

/** Lignes non vides ajoutées par rapport à HEAD (fichier suivi) ou contenu entier (non suivi). */
async function lignesAjoutees(repo: string, gitPath: string, runGit: GitRunner): Promise<string[]> {
  const diff = await runGit(
    ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=0', 'HEAD', '--', gitPath],
    repo
  )
  if (!diff.trim()) {
    const absolu = resolve(repo, gitPath)
    const info = await stat(absolu).catch(() => undefined)
    if (!info?.isFile() || info.size > TAILLE_MAX_PREUVE) return []
    return (await readFile(absolu, 'utf8')).split(/\r?\n/).filter((line) => line.trim())
  }
  const ajoutees: string[] = []
  let dansUnBloc = false
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) dansUnBloc = false
    else if (line.startsWith('@@')) dansUnBloc = true
    else if (dansUnBloc && line.startsWith('+') && line.slice(1).trim())
      ajoutees.push(line.slice(1))
  }
  return ajoutees
}

/**
 * Lignes ajoutées que le fil ne réclame pas. `0` : fichier PROUVÉ par ses lignes. `undefined` :
 * aucune preuve possible (aucune ligne ajoutée, diff illisible) — la règle de repli décide.
 * Le compte est rendu au rapport : mesuré le 2026-09-29, un fichier est resté écarté tour après
 * tour pour 2 lignes sur 146 écrites hors outil d'édition, sans que rien dise ce qui manquait.
 */
async function lignesNonReclamees(
  repo: string,
  gitPath: string,
  revendiquees: ReadonlySet<string> | undefined,
  runGit: GitRunner
): Promise<number | undefined> {
  try {
    const ajoutees = await lignesAjoutees(repo, gitPath, runGit)
    if (ajoutees.length === 0) return undefined
    return ajoutees.filter((line) => !revendiquees?.has(exactLineFingerprint(line))).length
  } catch {
    return undefined
  }
}

const FICHIER_DE_CODE = /\.[cm]?[jt]sx?$/i
const IMPORT_RELATIF =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/gm

/** Fichiers du dépôt qu'un fichier de code importe par un chemin relatif, résolus comme Node/Vite. */
async function importsLocaux(repo: string, gitPath: string): Promise<string[]> {
  if (!FICHIER_DE_CODE.test(gitPath)) return []
  const absolu = resolve(repo, gitPath)
  const source = await readFile(absolu, 'utf8').catch(() => '')
  const cibles = new Set<string>()
  for (const [, , specificateur] of source.matchAll(IMPORT_RELATIF)) {
    const base = resolve(dirname(absolu), specificateur)
    const sansJs = base.replace(/\.[cm]?js$/i, '')
    const candidats = [
      base,
      ...['.ts', '.tsx'].map((ext) => sansJs + ext),
      ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'].map((ext) => base + ext),
      ...['index.ts', 'index.tsx', 'index.js'].map((nom) => join(base, nom))
    ]
    for (const candidat of candidats) {
      if (!(await stat(candidat).catch(() => undefined))?.isFile()) continue
      cibles.add(relative(repo, candidat).split(sep).join('/'))
      break
    }
  }
  return [...cibles]
}

/**
 * Ce qu'un fichier de code atteint par ses imports relatifs : ses imports DIRECTS, puis, en
 * profondeur, ceux des fichiers qu'il importe (`indirects`). Chaque fichier n'est lu qu'une fois par
 * publication (`dejaLus`) ; un chemin qui sort du dépôt n'est pas suivi.
 */
async function importsAtteints(
  repo: string,
  gitPath: string,
  dejaLus: Map<string, string[]>
): Promise<{ directs: string[]; indirects: string[] }> {
  const lire = async (chemin: string): Promise<string[]> => {
    const connus = dejaLus.get(chemin)
    if (connus) return connus
    const cibles = (await importsLocaux(repo, chemin)).filter((cible) => !cible.startsWith('../'))
    dejaLus.set(chemin, cibles)
    return cibles
  }
  const directs = await lire(gitPath)
  const vus = new Set([gitPath, ...directs])
  const indirects: string[] = []
  const aSuivre = [...directs]
  for (let k = 0; k < aSuivre.length; k++) {
    for (const cible of await lire(aSuivre[k])) {
      if (vus.has(cible)) continue
      vus.add(cible)
      indirects.push(cible)
      aSuivre.push(cible)
    }
  }
  return { directs, indirects }
}

/** `type(zone): phrase (conv-N)` depuis ce que le tour a FAIT (`titre-de-commit.ts`). */
function messageDeCommit(
  conversationId: string,
  request: string,
  compteRendu: string | undefined,
  fichiers: readonly string[],
  langueDuCompteRendu: Langue
): string {
  return titreDeCommitAuto({
    id: conversationId,
    demande: request,
    compteRendu,
    langueDuCompteRendu,
    fichiers,
    repli: 'travail du chat'
  })
}

/**
 * Le titre d'une entrée que la passe horaire refait seule : ni demande ni compte rendu, le titre se tire des fichiers
 * entrés, et la ligne de porte est celle de la porte de fin de tour.
 */
export function titreDeLaReprise(tache: string, fichiers: readonly string[]): string {
  return `${messageDeCommit(tache, '', undefined, fichiers, lireLangueReglee()).trim()}\n\n${ligneDePorte(tache)}`
}

/**
 * Publie les fichiers PROUVÉS d'un tour de chat terminé : commit de ces seuls fichiers, puis push
 * sur la branche courante ; si le dépôt refuse, branche dédiée + PR (même règle que les tâches
 * d'agent). Rend `undefined` quand le tour n'a laissé aucun fichier en attente : le dernier rapport
 * affiché reste alors celui d'avant, au lieu d'un « aucun changement » à chaque question.
 */
export async function publierTourDeChat(input: {
  conversationId: string
  turnId: string
  /** Demande de l'utilisateur : repli du message de commit quand le tour n'a pas dit ce qu'il a fait. */
  request: string
  /** Texte final du tour : son bloc « ✅ Fait » donne le titre du commit. */
  compteRendu?: string
  /**
   * Langue de `compteRendu` ; absent = celle réglée dans Settings · Interface, qui est celle de la
   * réponse. Une réponse en anglais n'est pas recopiée dans le titre.
   */
  langueDuCompteRendu?: Langue
  debut: ChatTurnStart
  traces: readonly ConversationFileTrace[]
  /**
   * Dossiers de travail des tours d'AUTRES fils encore en cours, relevés AVANT de lire `traces` :
   * un tour fini avant ce relevé a déjà tout écrit au journal, un tour encore en cours n'y a peut-être
   * rien écrit. Absent = aucun.
   */
  autresToursEnCours?: readonly string[]
  /**
   * Rejoue les tests des fichiers que le tour va publier, AVANT le commit, dans `racine` : une copie
   * propre de CE QUI PART (dernier commit + ces seuls fichiers), jamais l'arbre partagé — voir
   * `verifierCeQuiPart`. Mesuré le 2026-10-01 : `b6d2a3fc` a été poussé sans aucun test
   * et a laissé main rouge 20 h. Absent = comportement d'avant (aucune vérification).
   */
  verifierAvantPublication?: (
    racine: string,
    fichiers: readonly string[]
  ) => Promise<VerificationAvantPublication>
  /** Copie propre du dernier commit où les tests se rejouent (défaut : `ouvrirCopieDeBase`). */
  ouvrirCopie?: (repo: string) => Promise<CopieDeBase>
  /**
   * Type ce qui PART (copie propre du dernier commit + fichiers du tour), AVANT les tests. Vécu le
   * 2026-10-15 (`9d6bb850`) : un fichier publié sans son appelant, écarté, a cassé la
   * compilation de main ; les tests, rejoués dans l'arbre partagé où l'appelant était encore là,
   * étaient verts. Absent = aucun typage (voir `typage-avant-publication.ts`).
   */
  typerAvantPublication?: (
    repo: string,
    fichiers: readonly string[]
  ) => Promise<TypageAvantPublication>
  runGit?: GitRunner
  openPr?: PrOpener
  /**
   * LA PORTE VERS MAIN d'un fil qui travaille dans SA copie (`garderLeTravailDuFil`) : `depot` est le
   * dépôt DU FIL (celui où sa copie a été ouverte, noté sur le fil), que `publication` fait avancer. Un tour
   * dont le dossier est une copie détachée de ce dépôt passe par elle, et par elle seule. Absent = publication
   * d'avant pour tous les dossiers.
   */
  porte?: { depot: string; publication: PublicationDUneCopie; dossierDeDonnees?: string }
}): Promise<AutoCloseReport | undefined> {
  const { conversationId, turnId, debut } = input
  if (!debut.repo) return undefined
  const runGit = input.runGit ?? (await defaultGitRunner())
  if (input.porte) {
    // Le dépôt de la porte est celui DU FIL (sa copie notée, `porte.depot`), jamais le premier `worktree` lu dans la
    // copie : une copie liée nomme le dépôt principal, pas le projet qui l'a ouverte.
    // fix-ok: lu dans la copie, le premier worktree est le dépôt principal : le travail d'un projet lié partirait sur sa branche.
    if (await estUneCopieDetacheeDuDepot(debut.repo, input.porte.depot, runGit))
      return passerLaPorte(input, debut.repo, input.porte, runGit)
  }
  const autresToursEnCours = (input.autresToursEnCours ?? []).filter((dossier) => dossier.trim())
  const racines = await cheminsReels([
    debut.repo,
    ...autresToursEnCours,
    ...input.traces
      .map((trace) => trace.workspaceRoot)
      .filter((root): root is string => typeof root === 'string' && Boolean(root.trim()))
  ])
  const repo = racines.get(debut.repo) ?? debut.repo
  const autreFilEnCours = autresToursEnCours.some((dossier) =>
    partageLeDepot(repo, racines.get(dossier) ?? dossier)
  )

  const duTour = new Set<string>()
  /** Tracés par CE fil, à ce tour ou à un précédent : son travail, publié ou encore en attente. */
  const duFil = new Set<string>()
  const revendiquees = new Map<string, Set<string>>()
  const concurrents = new Set<string>()
  /** Pour chaque fichier touché par un autre fil pendant le tour : QUELS fils. */
  const filsConcurrents = new Map<string, Set<string>>()
  /** Nommés par une commande shell d'écriture de CE tour. */
  const nommesParLeTour = new Set<string>()
  /**
   * Écrits par un autre fil pendant le tour : nommés par sa commande, réclamés par ses lignes, ou
   * tracés par une autre source que le chat. Le reste de ses traces (sa comparaison avant/après,
   * sans lignes) dit seulement qu'il a VU le fichier changer.
   */
  const ecritsParUnAutreFil = new Set<string>()
  /** Écrits par CE tour : commande nommée, lignes réclamées, ou source autre que la comparaison. */
  const ecritsParLeTour = new Set<string>()
  /** Passages (empreinte avant → après) que CE tour a seulement VUS, par sa comparaison avant/après. */
  const vusParLeTour = new Map<string, Array<[string | null | undefined, string | undefined]>>()
  /** Passages (empreinte avant → après) tracés par les AUTRES fils pendant le tour, avec leur fil. */
  const passagesDesAutres = new Map<
    string,
    Array<{ fil: string; avant: string | null; apres: string }>
  >()
  /** Pour chaque fichier, les autres fils qui l'ont ÉCRIT pendant le tour. */
  const auteursAutres = new Map<string, Set<string>>()
  for (const trace of input.traces) {
    if (typeof trace.workspaceRoot !== 'string' || !trace.workspaceRoot.trim()) continue
    const racine = racines.get(trace.workspaceRoot) ?? trace.workspaceRoot
    const autreFil = trace.conversationId !== conversationId
    const pendantLeTour = Date.parse(trace.timestamp) >= debut.startedAt
    // Ni la trace d'un autre fil d'avant le tour, ni celle de ce fil hors chat ne comptent ici.
    if (autreFil ? !pendantLeTour : !SOURCES_DU_CHAT.has(trace.source)) continue
    /*
     * Valeurs par chemin rangées UNE fois par trace, la première d'une clé gagnant comme le
     * `Object.entries(...).find(...)` d'avant. Chercher chaque chemin parmi tous ceux de la trace
     * coûtait chemins² : six gels de 31 à 58 s de la fenêtre le 06/11/2026, à chaque fin de tour,
     * sur un lot de 2 344 chemins. Garde : `chat-turn-publication.sans-gel.test.ts`.
     */
    const parChemin = <T>(valeurs: Record<string, T> | undefined): Map<string, T> => {
      const index = new Map<string, T>()
      for (const [candidate, valeur] of Object.entries(valeurs ?? {})) {
        const key = cle(absoluDeTrace(racine, candidate))
        if (!index.has(key)) index.set(key, valeur)
      }
      return index
    }
    const lignesParChemin = parChemin(trace.pathLineFingerprints)
    const avantParChemin = parChemin(trace.pathBaseFingerprints)
    const apresParChemin = parChemin(trace.pathFingerprints)
    for (const path of trace.paths) {
      const absolu = absoluDeTrace(racine, path)
      if (!dansLeDepot(repo, absolu)) continue
      const key = cle(absolu)
      const lignes = lignesParChemin.get(key)
      const ecrit = Boolean(
        trace.nommeParCommande || lignes?.length || trace.source !== 'chat_tool'
      )
      const avant = avantParChemin.get(key)
      const apres = apresParChemin.get(key)
      if (autreFil) {
        concurrents.add(key)
        filsConcurrents.set(key, (filsConcurrents.get(key) ?? new Set()).add(trace.conversationId))
        if (ecrit) {
          ecritsParUnAutreFil.add(key)
          auteursAutres.set(key, (auteursAutres.get(key) ?? new Set()).add(trace.conversationId))
        }
        if (avant !== undefined && apres !== undefined)
          passagesDesAutres.set(key, [
            ...(passagesDesAutres.get(key) ?? []),
            { fil: trace.conversationId, avant, apres }
          ])
        continue
      }
      duFil.add(key)
      if (trace.turnId === turnId) {
        duTour.add(key)
        if (trace.nommeParCommande) nommesParLeTour.add(key)
        if (ecrit) ecritsParLeTour.add(key)
        else vusParLeTour.set(key, [...(vusParLeTour.get(key) ?? []), [avant, apres]])
      }
      if (lignes?.length) {
        const set = revendiquees.get(key) ?? new Set<string>()
        for (const line of lignes) set.add(line)
        revendiquees.set(key, set)
      }
    }
  }
  if (duTour.size === 0) return undefined

  /**
   * Les fils qui ont ÉCRIT ce fichier pendant le tour ont-ils tracé, marche après marche, tout le
   * chemin de `avant` à `apres` ? Un fil qui l'a seulement vu changer n'explique rien : le passage
   * vu peut être celui de ce tour.
   */
  const expliqueParLesAutres = (
    key: string,
    avant: string | null | undefined,
    apres: string | undefined
  ): boolean => {
    const auteurs = auteursAutres.get(key)
    if (!auteurs || avant === undefined || apres === undefined) return false
    const passages = new Map<string | null, Set<string>>()
    for (const passage of passagesDesAutres.get(key) ?? []) {
      if (!auteurs.has(passage.fil)) continue
      passages.set(passage.avant, (passages.get(passage.avant) ?? new Set()).add(passage.apres))
    }
    const vus = new Set<string | null>([avant])
    const aVisiter: Array<string | null> = [avant]
    while (aVisiter.length > 0) {
      for (const suivant of passages.get(aVisiter.pop() ?? null) ?? []) {
        if (suivant === apres) return true
        if (!vus.has(suivant)) {
          vus.add(suivant)
          aVisiter.push(suivant)
        }
      }
    }
    return false
  }
  /*
   * SEULEMENT VU CHANGER, ET L'AUTEUR EST CONNU (2026-11-05). Le fil n'avait fait que
   * lire ; pendant son appel, un fil a publié sa part de `git-apres-fil.ts` (commande nommée,
   * empreinte du diff 83a7a601 → bcb7dcce). La comparaison avant/après a vu ce même
   * passage, le fichier est entré dans SES « laissés en attente », et un `/git` est parti dans un fil
   * qui n'avait rien écrit. Un fichier que le tour n'a pas écrit, qu'un autre fil a ÉCRIT pendant le
   * tour, et dont chaque passage vu est tracé de bout en bout par les autres fils n'est donc pas à ce
   * tour : ni publié, ni laissé en attente à son nom. Un passage que personne d'autre n'explique, ou
   * une comparaison sans empreinte, garde la règle d'avant (en attente, l'auteur reste à trouver).
   */
  const seulementVuChangerParUnAutreFil = (key: string): boolean => {
    if (ecritsParLeTour.has(key) || !ecritsParUnAutreFil.has(key)) return false
    const vus = vusParLeTour.get(key) ?? []
    return vus.length > 0 && vus.every(([avant, apres]) => expliqueParLesAutres(key, avant, apres))
  }

  let enAttente: string[]
  let changesDuDepot: string[] = []
  try {
    changesDuDepot = parsePorcelainPaths(
      await runGit(['status', '--porcelain=v1', '-z', '-uall'], repo)
    )
    enAttente = changesDuDepot.filter((gitPath) => {
      const key = cle(resolve(repo, gitPath))
      return duTour.has(key) && !seulementVuChangerParUnAutreFil(key)
    })
  } catch (error) {
    return rapport(input, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    })
  }
  // Tout est déjà commité (le tour l'a fait lui-même) : rien à publier au nom du tour.
  if (enAttente.length === 0) return undefined

  const salesAuDepart = new Set(debut.dirty.map((gitPath) => cle(resolve(repo, gitPath))))
  const publier: string[] = []
  const exclus: Exclusion[] = []
  for (const gitPath of enAttente) {
    const key = cle(resolve(repo, gitPath))
    const nonReclamees = await lignesNonReclamees(repo, gitPath, revendiquees.get(key), runGit)
    const detail = nonReclamees ? { lignesNonReclamees: nonReclamees } : {}
    if (nonReclamees === 0) publier.push(gitPath)
    else if (salesAuDepart.has(key))
      exclus.push({ path: gitPath, motif: 'modifie-avant-le-tour', ...detail })
    else if (nommesParLeTour.has(key) && !ecritsParUnAutreFil.has(key)) publier.push(gitPath)
    else if (concurrents.has(key))
      exclus.push({
        path: gitPath,
        motif: 'touche-par-un-autre-fil',
        // Le fil qui tient le fichier, nommé : c'est lui qu'il faut finir ou commiter.
        fils: [...(filsConcurrents.get(key) ?? [])].sort(),
        ...detail
      })
    else if (autreFilEnCours) exclus.push({ path: gitPath, motif: 'autre-fil-en-cours', ...detail })
    else publier.push(gitPath)
  }
  /*
   * UN FICHIER PUBLIÉ N'IMPORTE AUCUN FICHIER LOCAL RESTÉ HORS DU COMMIT. Vécu le 2026-10-01
   * (a7602f5c) : `commands.ts` partait, `src/shared/heredocs.ts` qu'il importe restait non suivi —
   * main ne compilait plus. Point fixe : écarter un fichier peut laisser dehors ce qu'un autre importe.
   *
   * NI, PAR UN INTERMÉDIAIRE, LE TRAVAIL DU FIL RESTÉ EN ATTENTE. Vécu le 2026-10-19 (
   * ba71a03e) : `ChatView.cadrage-hypotheses.test.tsx` est parti seul ; `ChatView.tsx`, qu'il
   * vérifie, était le travail du même fil, écarté (« modifie-avant-le-tour »), et le test ne
   * l'atteint que par `ChatView.harness.tsx`, propre. main a reçu un test rouge sans son code.
   * Au-delà des imports directs, seul le travail DU FIL retient : un fichier sale d'un AUTRE fil,
   * quelque part sous une grande vue, retiendrait presque tout test de cette vue, et ferait revenir
   * le code publié sans son test (d7af3730, dd0c3d6a).
   */
  const dehors = new Set(changesDuDepot.map((gitPath) => cle(resolve(repo, gitPath))))
  const importsDejaLus = new Map<string, string[]>()
  for (let ecarte = true; ecarte;) {
    ecarte = false
    const partants = new Set(publier.map((gitPath) => cle(resolve(repo, gitPath))))
    const resteDehors = (cible: string): boolean => {
      const key = cle(resolve(repo, cible))
      return dehors.has(key) && !partants.has(key)
    }
    // Aucun travail du fil en attente : les imports directs suffisent, rien à lire en profondeur.
    const filEnAttente = [...duFil].some((key) => dehors.has(key) && !partants.has(key))
    for (const gitPath of [...publier]) {
      const { directs, indirects } = filEnAttente
        ? await importsAtteints(repo, gitPath, importsDejaLus)
        : { directs: await importsLocaux(repo, gitPath), indirects: [] }
      const manquants = [
        ...directs.filter(resteDehors),
        ...indirects.filter((cible) => resteDehors(cible) && duFil.has(cle(resolve(repo, cible))))
      ]
      if (!manquants.length) continue
      publier.splice(publier.indexOf(gitPath), 1)
      exclus.push({ path: gitPath, motif: 'import-hors-commit', importsHorsCommit: manquants })
      ecarte = true
    }
  }
  // GARDE-FOU : `autoCloseRun` sans chemins publierait TOUT l'arbre (`add -A`).
  if (publier.length === 0)
    return rapport(input, { status: 'skipped', reason: 'unattributed' }, exclus)
  // Une erreur de typage NOUVELLE dans ce qui part ne se pousse pas : les fichiers restent en
  // attente, nommés avec les erreurs. Un typage qui n'a pas pu se jouer laisse partir, et le DIT.
  const typage = await input.typerAvantPublication?.(repo, publier)
  if (typage?.statut === 'echec') {
    const rouges = publier.map<Exclusion>((path) => ({
      path,
      motif: 'typage-rouge',
      erreursDeTypage: typage.erreurs.slice(0, ERREURS_DE_TYPAGE_NOMMEES)
    }))
    const n = typage.erreurs.length
    return rapport(
      input,
      {
        status: 'skipped',
        reason: 'typage-rouge',
        detail: `${n} erreur${n > 1 ? 's' : ''} de typage nouvelle${n > 1 ? 's' : ''} dans ce qui part (${typage.commande})`
      },
      [...exclus, ...rouges],
      undefined,
      typage
    )
  }
  // Un rouge (ou un plafond de temps) ne se pousse pas : les fichiers restent en attente, nommés
  // avec les tests en échec. Un fichier qu'aucun test ne juge part comme avant, mais le rapport le dit.
  const verification = input.verifierAvantPublication
    ? await verifierCeQuiPart(repo, publier, input.verifierAvantPublication, input.ouvrirCopie)
    : undefined
  if (verification?.statut === 'echec') {
    const rouges = publier.map<Exclusion>((path) => ({
      path,
      motif: 'tests-rouges',
      testsEnEchec: verification.testsEnEchec
    }))
    return rapport(
      input,
      { status: 'skipped', reason: 'tests-rouges', detail: verification.detail },
      [...exclus, ...rouges],
      verification,
      typage
    )
  }
  const project = await autoCloseRun({
    repo,
    branch: brancheDuTour(conversationId, turnId),
    message: messageDeCommit(
      conversationId,
      input.request,
      input.compteRendu,
      publier,
      input.langueDuCompteRendu ?? lireLangueReglee()
    ),
    paths: publier,
    runGit,
    direct: true,
    ...(input.openPr ? { openPr: input.openPr } : {})
  })
  return rapport(input, project, exclus, verification, typage)
}

/**
 * LES TESTS JUGENT CE QUI PART, COMME LE TYPAGE : une copie propre du dernier commit, avec les seuls
 * fichiers publiés posés dessus (mêmes `ouvrirCopieDeBase` et `appliquerLeTour` que
 * `typerCeQuiPart`).
 *
 * Vécu le 2026-10-22 : `973b70e2` a publié un test de style sans le
 * CSS qu'il lit, et `b86a144e` du code sans son test. Les fichiers restés dehors avaient
 * aussi été modifiés par d'autres fils. Rejoués dans l'arbre partagé, où ces fichiers étaient encore
 * là, les tests étaient verts. Même défaut déjà vu le 2026-10-15 (`b0c4c099`).
 *
 * Une copie impossible à ouvrir ne bloque pas la publication : comme pour le typage, elle part et le
 * rapport dit `non-verifie` avec la raison. Coût mesuré le 2026-10-22 : 1,7 s pour copier ce dépôt.
 */
export async function verifierCeQuiPart(
  repo: string,
  fichiers: readonly string[],
  verifier: (racine: string, fichiers: readonly string[]) => Promise<VerificationAvantPublication>,
  ouvrirCopie: (repo: string) => Promise<CopieDeBase> = ouvrirCopieDeBase
): Promise<VerificationAvantPublication> {
  const message = (erreur: unknown): string =>
    erreur instanceof Error ? erreur.message : String(erreur)
  let copie: CopieDeBase
  try {
    copie = await ouvrirCopie(repo)
  } catch (erreur) {
    return {
      statut: 'non-verifie',
      raison: `copie propre du dernier commit impossible : ${message(erreur)}`
    }
  }
  try {
    try {
      appliquerLeTour(repo, copie.chemin, fichiers)
    } catch (erreur) {
      return {
        statut: 'non-verifie',
        raison: `fichiers du tour non posés sur la copie propre : ${message(erreur)}`
      }
    }
    return await verifier(copie.chemin, fichiers)
  } finally {
    await copie.fermer()
  }
}

function brancheDuTour(conversationId: string, turnId: string): string {
  return autoCloseBranch(`${conversationId}-${turnId.slice(0, 8)}`)
}

function rapport(
  input: { conversationId: string; turnId: string },
  project: AutoCloseReport['project'],
  exclus: Exclusion[] = [],
  verification?: VerificationAvantPublication,
  typage?: TypageAvantPublication
): AutoCloseReport {
  return {
    runId: `${input.conversationId} · tour ${input.turnId.slice(0, 8)}`,
    branch: brancheDuTour(input.conversationId, input.turnId),
    project,
    at: new Date().toISOString(),
    source: 'chat',
    ...(exclus.length ? { exclus } : {}),
    ...(verification ? { verification } : {}),
    // `sans-objet` (aucun fichier TypeScript) ne dit rien d'utile : il n'encombre pas le rapport.
    ...(typage && typage.statut !== 'sans-objet' ? { typage } : {})
  }
}

/**
 * Le dossier du tour est-il une COPIE DÉTACHÉE de `depot` : copie git liée (`worktree`), sans
 * branche courante, qui partage les objets du dépôt ? C'est la copie d'un fil : sans branche, la
 * publication d'avant poussait une branche du tour vers le distant. Le dépôt lui-même, une copie qui
 * a sa branche ou la copie d'un autre dépôt gardent la publication d'avant. Un git illisible vaut
 * « non » : la publication d'avant relit le dépôt elle-même, et refuse seule ce qu'elle ne lit pas.
 */
async function estUneCopieDetacheeDuDepot(
  dossier: string,
  depot: string,
  runGit: GitRunner
): Promise<boolean> {
  try {
    const [gitDir, commun, tete] = (
      await runGit(
        [
          'rev-parse',
          '--path-format=absolute',
          '--git-dir',
          '--git-common-dir',
          '--abbrev-ref',
          'HEAD'
        ],
        dossier
      )
    )
      .split(/\r?\n/u)
      .map((ligne) => ligne.trim())
    if (!gitDir || !commun || tete !== 'HEAD') return false
    const communDuDepot = (
      await runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], depot)
    ).trim()
    const reels = await cheminsReels([gitDir, commun, communDuDepot])
    const reel = (chemin: string): string => cle(reels.get(chemin) ?? chemin)
    return reel(gitDir) !== reel(commun) && reel(commun) === reel(communDuDepot)
  } catch {
    return false
  }
}

/** La copie d'un fil est-elle celle de la racine unique (`copies-de-taches\<fil>`) ? */
// fix-ok: comparaison de chemins réels (nom court tmpdir contre nom long git).
async function estLaCopieDeLaRacineUnique(
  copie: string,
  tache: string,
  dossierDeDonnees: string
): Promise<boolean> {
  const attendue = dossierDeCopieDeTache(racineDesCopiesDeTaches(dossierDeDonnees), tache)
  if (attendue === null) return false
  // Chemins réels : un nom court de Windows (tmpdir) et le nom long que git rend désignent le même dossier.
  const reels = await cheminsReels([copie, attendue])
  return memeCheminSurDisque(reels.get(copie) ?? copie, reels.get(attendue) ?? attendue)
}

// textes de conflit et de base absente : phrases que l'utilisateur lit, mot pour mot.
/**
 * Le texte d'un refus de la passe, dit à l'utilisateur tel quel. Les autres refus gardent le texte de la
 * primitive, qui nomme la cause.
 */
function texteDuRefusDeLaPorte(refus: {
  motif: string
  raison: string
  fichiers?: readonly string[]
}): string {
  if (refus.motif === 'conflit') {
    const liste = refus.fichiers?.length ? refus.fichiers.join(', ') : 'fichiers non nommés'
    return `Ce fil change les mêmes lignes que main depuis son dernier passage : ${liste}. Rien n’est entré dans main ; le travail reste dans la copie du fil.`
  }
  if (refus.motif === 'base-absente')
    return 'La base de ce fil n’existe plus : la porte ne peut pas dire ce que le fil a changé depuis son dernier passage. Rien n’est entré dans main, et jamais toute la copie à la place.'
  // la passe horaire refait cette entrée seule (menage-des-copies-de-fil.ts) : « Autowin retentera » dit vrai.
  // la même phrase est relue par la réparation automatique, qui ne lance alors aucun tour.
  if (refus.motif === 'modifie-non-commite')
    return `${refus.raison} ${SUITE_QUAND_LA_PORTE_RETENTE_SEULE}`
  return refus.raison
}

/**
 * LA PORTE D'UNE COPIE DE LA RACINE UNIQUE, par la primitive (`entrerLeTravailDeLaCopie`) : le travail de la
 * copie entre dans la branche du dépôt, sans file de publication. Le titre du commit se tire des fichiers du
 * passage, lus d'avance ; un passage sans écart rend `undefined`, comme pour une copie d'avant. Une base absente est
 * laissée à la primitive, qui la refuse et le dit.
 *
 * Un fichier visé modifié et non commité dans le dossier partagé est refusé par la primitive : rien n'y est écrit,
 * la copie reste, et la passe horaire du ménage le refait seule dès que ce fichier est commité (sans nouveau tour).
 */
async function passerLaPorteParLaPrimitive(
  input: {
    conversationId: string
    turnId: string
    request: string
    compteRendu?: string
    langueDuCompteRendu?: Langue
  },
  copie: string,
  depot: string,
  dossierDeDonnees: string,
  runGit: GitRunner
): Promise<AutoCloseReport | undefined> {
  let issue: Awaited<ReturnType<typeof entrerLeTravailDeLaCopie>>
  try {
    const base = await lireLaBaseDuFil({
      dossier: copie,
      conversationId: input.conversationId,
      runGit
    })
    const fichiers = base
      ? (
          await runGit(
            [
              'diff',
              '--name-only',
              '--no-renames',
              '-z',
              base,
              await arbreDeLaCopie(copie, runGit)
            ],
            copie
          )
        )
          .split('\0')
          .filter(Boolean)
      : []
    if (base && fichiers.length === 0) return undefined
    const titre = messageDeCommit(
      input.conversationId,
      input.request,
      input.compteRendu,
      fichiers,
      input.langueDuCompteRendu ?? lireLangueReglee()
    )
    const messageDuCommit = `${titre.trim()}\n\n${ligneDePorte(input.conversationId)}`
    issue = await entrerLeTravailDeLaCopie({
      dossierDeDonnees,
      depot,
      tache: input.conversationId,
      sansDistant: true,
      runGit,
      messageDuCommit
    })
  } catch (error) {
    return rapport(input, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    })
  }
  if (!issue.ok)
    return rapport(input, {
      status: 'skipped',
      reason: 'porte-refusee',
      detail: texteDuRefusDeLaPorte(issue)
    })
  if (issue.etat === 'rien-a-entrer') return undefined
  return rapport(input, {
    status: 'committed',
    files: issue.fichiers.length,
    ...(issue.avertissement ? { detail: issue.avertissement } : {})
  })
}

/**
 * FIN DE TOUR D'UN FIL EN COPIE. Tout ce que sa copie porte est à lui : aucune preuve fichier par
 * fichier, aucun fichier mis de côté pour un autre fil. Son travail entre dans main LOCAL par la
 * porte (« Garder », fusion à trois voies depuis la base du fil). Rien n'est poussé : l'envoi vers le
 * distant reste celui de la publication après le fil. Un passage sans changement rend `undefined`,
 * comme un tour qui n'a rien laissé en attente.
 * fix-ok: cause mesurée — la copie détachée allait à `autoCloseRun`, qui faute de branche courante
 * poussait `auto/<fil>-<tour>` (rouge : `push origin <sha>:refs/heads/auto/conv-A-tour-A-0`), et
 * l'attribution du dossier partagé mettait de côté son travail (trois motifs, même rouge).
 */
async function passerLaPorte(
  input: {
    conversationId: string
    turnId: string
    request: string
    compteRendu?: string
    langueDuCompteRendu?: Langue
  },
  copie: string,
  porte: NonNullable<Parameters<typeof publierTourDeChat>[0]['porte']>,
  runGit: GitRunner
): Promise<AutoCloseReport | undefined> {
  const { publication } = porte
  // La racine unique passe par la primitive ; une copie d'avant, encore là, garde son chemin jusqu'à son retrait.
  // un fichier visé modifié dans le dossier partagé est un refus de la primitive (« la copie reste »), pas une file d'attente.
  if (
    porte.dossierDeDonnees &&
    (await estLaCopieDeLaRacineUnique(copie, input.conversationId, porte.dossierDeDonnees))
  ) {
    return passerLaPorteParLaPrimitive(input, copie, porte.depot, porte.dossierDeDonnees, runGit)
  }
  let issue: ResultatGarder
  try {
    issue = await garderLeTravailDuFil({
      copie,
      conversationId: input.conversationId,
      titre: (fichiers) =>
        messageDeCommit(
          input.conversationId,
          input.request,
          input.compteRendu,
          fichiers,
          input.langueDuCompteRendu ?? lireLangueReglee()
        ),
      publication,
      runGit
    })
  } catch (error) {
    return rapport(input, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    })
  }
  if (!issue.ok)
    return issue.motif === 'rien-a-garder'
      ? undefined
      : rapport(input, { status: 'skipped', reason: 'porte-refusee', detail: issue.raison })
  if (issue.etat !== 'publie')
    return rapport(input, { status: 'skipped', reason: 'porte-en-attente', detail: issue.detail })
  // Ce que la porte dit de plus : le contrôle des noms n'a pas pu tourner, ou la base n'a pas avancé.
  const dePlus = [
    issue.avertissement,
    issue.base && !issue.base.ok ? issue.base.raison : undefined
  ].filter((texte): texte is string => Boolean(texte))
  return rapport(input, {
    status: 'committed',
    files: issue.fichiers.length,
    ...(dePlus.length ? { detail: dePlus.join(' ') } : {})
  })
}
