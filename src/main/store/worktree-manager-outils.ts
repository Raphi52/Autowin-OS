// Outils de module de worktree-manager.ts, déplacés tels quels (lot 3) : partagés par la
// classe et ses modules voisins ; ré-exportés par worktree-manager.ts pour les appelants.
import { execFile, execFileSync } from 'node:child_process'
import type { EntreeBalayage } from './balayage-retention'
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { WorktreeOperationWorkerLike } from './worktree-operation-client'
import { LIGNES } from './worktree-manager-empreintes'
import { WorktreeManager } from './worktree-manager'
import { agentIdDeCopieHeritee, agentIdDeCopieNeuve } from '../copies/chemins-de-copies'

export const SAFE_ID = /^[A-Za-z0-9_-]+$/

/** Un SHA git tel que `rev-parse` le rend : c'est ce qu'on accepte comme adresse de travail. */
export const HEX_SHA = /^[0-9a-f]{7,40}$/i
export const GIT_COMMAND_TIMEOUT_MS = Number(process.env.AUTOWIN_GIT_TIMEOUT_MS ?? 180_000)

/**
 * Budget du `git fetch` d'origine au lancement, distinct du délai d'une commande git.
 *
 * Le fetch est OPTIONNEL : son échec est toléré, le lancement repart alors d'`origin/main` déjà
 * connu. Au délai d'une commande (180 s), un origin muet tenait donc le lancement presque tout
 * entier, et la limite de l'opération (182 s) coupait un lancement qui aurait réussi. MESURÉ : un
 * fetch sain prend de 0,56 à 1,58 s sur l'origine réelle (trois essais, médiane 0,72 s), et de 0,18
 * à 0,22 s sur une origine locale. 30 s en est plus de dix-huit fois la pire mesure, et laisse 152 s
 * à l'opération pour le reste.
 */
export const FETCH_ORIGIN_TIMEOUT_MS = 30_000

/**
 * Budget de l'inventaire de récupération, distinct de celui d'une commande git.
 *
 * MESURÉ sur ce dépôt : cet inventaire balaie 52 copies, chacune avec plusieurs sous-processus git —
 * le seul balayage des copies abandonnées pesait 19,7 s, et la réconciliation complète ~23 s. Avec le
 * budget d'une commande unique (32 s), il était interrompu à mi-course et la récupération repartait en
 * échec. Rien n'attend ce résultat : il alimente une vue, pas un chemin bloquant. Cinq minutes est
 * donc large sans être infini — un worker vraiment pendu reste tué.
 */
export const INVENTAIRE_RECUPERATION_TIMEOUT_MS = 300_000

/**
 * Budget de la passe de retention confiee au worker : une commande `git cherry` PAR ref, en serie.
 * Mesure du 2026-10-16 sur ce depot : 77 refs, 12 s a vide (148 ms par `git cherry` en mediane).
 * Rien n'attend ce rapport (il alimente une vue, une fois par heure) : le budget de l'inventaire
 * de recuperation convient, et un worker vraiment pendu reste tue.
 */
export const PASSE_RETENTION_TIMEOUT_MS = INVENTAIRE_RECUPERATION_TIMEOUT_MS
/**
 * `finalize` n'est pas UNE commande git, c'est une SEQUENCE : commit dans la copie, fusion dans la
 * base, crochets du depot, puis suppression du dossier de travail. Lui donner le budget d'une seule
 * commande (32 s) est la meme erreur de CATEGORIE que celle deja corrigee pour l'inventaire de
 * recuperation. Mesure du 2026-08-27 : la fusion a bien atterri dans `main`
 * (`acfe64dd`, 09:09:50) et le client a coupe pendant le rangement, a 09:10:21 — le run est reparti
 * en `merge-failed` alors que le travail etait publie.
 */
export const FINALIZE_TIMEOUT_MS = 300_000
/**
 * Message du commit qui transporte le travail d'une copie isolée vers la branche de l'utilisateur.
 *
 * Le préfixe `agent <id>` est CONSERVÉ : des tests et la reprise repèrent ces commits par lui. On lui
 * ajoute le résumé de la tâche (première ligne non vide, sans caractère de contrôle, ≤ 72
 * caractères) pour que l'historique dise CE QUI a changé — `agent run-xxx-1` seul ne disait rien.
 * fix-ok: cause mesurée — les deux commits (finalize, commitCopyIfDirty) codaient en dur `agent ${agentId}` ; test rouge (3 échecs) sans ce helper, vert avec.
 */
export function messageCommitAgent(agentId: string, task?: string): string {
  const premiere = (task ?? '')
    .split(/\r?\n/)
    .map((ligne) =>
      Array.from(ligne, (c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? ' ' : c))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .find((ligne) => ligne.length > 0)
  if (!premiere) return `agent ${agentId}`
  const resume = premiere.length > 72 ? `${premiere.slice(0, 71).trimEnd()}…` : premiere
  return `agent ${agentId}: ${resume}`
}

export function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value))
    throw new Error(`${label} invalide (caractères non autorisés): ${value}`)
}

/**
 * La racine de travail `chemin` appartient-elle au dépôt dont `commonDir` est le répertoire commun ?
 *
 * Le lien `.git` d'une racine de travail pointe dans `<commonDir>\worktrees\`. On le lit sans git : une
 * coquille dont le registre a disparu reste reconnue, et une copie d'un autre dépôt ne l'est jamais.
 * Les deux côtés passent par realpath, car Git écrit le nom long Windows et Node peut rendre le nom court.
 */
export function estCopieDuDepot(chemin: string, commonDir: string | undefined): boolean {
  if (commonDir === undefined) return false
  let lien: string
  try {
    lien = readFileSync(join(chemin, '.git'), 'utf8')
  } catch {
    return false
  }
  const pointe = /^gitdir:\s*(.+?)\s*$/m.exec(lien)?.[1]
  if (pointe === undefined) return false
  // fix-ok: la racine unique est partagée entre dépôts ; ce contrôle écarte la copie d'un autre dépôt, sans appel à git, donc sans dépendre de son état.
  return (
    normaliserChemin(dirname(resolve(chemin, pointe))) ===
    normaliserChemin(join(commonDir, 'worktrees'))
  )
}

function normaliserChemin(chemin: string): string {
  let reel = resolve(chemin)
  try {
    reel = realpathSync.native(reel)
  } catch {
    // Dossier absent : on compare le chemin résolu tel quel.
  }
  return reel.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Forme COMPARABLE d'un chemin : résolue (jonctions/symlinks Windows, `C:\Users` vs `C:\USERS`,
 * chemins UNC), séparateurs unifiés, casse neutralisée, slash final retiré. Sans cette
 * normalisation, deux écritures du MÊME `.git` (une jonction, une casse différente) se comparent
 * comme différentes → la garde « copie étrangère » bloquerait une copie parfaitement légitime.
 * Si le chemin n'existe pas (encore), on retombe sur la forme brute normalisée.
 */
export function canonicalPath(path: string): string {
  let resolved = path
  try {
    resolved = realpathSync.native ? realpathSync.native(path) : realpathSync(path)
  } catch {
    resolved = path
  }
  return resolve(resolved).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function shellPath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/** Exécuteur git injectable (tests) : renvoie stdout ; jette avec {status, stdout, stderr} si échec. */
export interface GitRunner {
  (repo: string, args: string[]): string
}

// fix-ok: cause mesurée — aucune commande git du worker n'était signalée au fil principal (test rouge : observerGit absent, 4 échecs sur 4 dans worktree-manager-outils.etapes-git.test.ts) ; sans ce signal, un délai ne peut pas dire ce qui attendait.
/**
 * Une commande git vue du dehors : son début, puis sa fin avec son code. Le worker installe un
 * observateur (`observerGit`) qui renvoie ces signaux au fil principal pendant que la commande tourne.
 */
export type EvenementGit =
  | { phase: 'debut'; id: number; commande: string; ms: number }
  | { phase: 'fin'; id: number; commande: string; ms: number; code: number }

let observateurGit: ((evenement: EvenementGit) => void) | undefined

/**
 * Identifiant d'une commande, unique dans le thread. Les commandes asynchrones tournent en parallèle :
 * sans identifiant, la fin de l'une passerait pour la fin de l'autre, et le délai nommerait à tort
 * une commande déjà terminée (fix-ok: cause mesurée — voir worktree-operation-client.test.ts).
 */
let prochainIdGit = 0

/**
 * Installe l'observateur des commandes git DE CE THREAD. Un module est chargé une fois par thread :
 * le worker l'installe sans toucher au fil principal, qui le laisse à `undefined` et ne change pas.
 */
export function observerGit(observateur: ((evenement: EvenementGit) => void) | undefined): void {
  observateurGit = observateur
}

/** Étiquette lisible d'une commande : ses premiers arguments, sans les options `-c clé=valeur`. */
export function libelleCommandeGit(args: string[]): string {
  let sansOption = args
  while (sansOption[0] === '-c') sansOption = sansOption.slice(2)
  return `git ${sansOption.slice(0, 4).join(' ')}`.slice(0, 120)
}

export const defaultGit: GitRunner = (repo, args) => {
  const commande = libelleCommandeGit(args)
  const id = ++prochainIdGit
  observateurGit?.({ phase: 'debut', id, commande, ms: Date.now() })
  let stdout: string
  try {
    stdout = execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    observateurGit?.({
      phase: 'fin',
      id,
      commande,
      ms: Date.now(),
      code: (err as { status?: number }).status ?? 1
    })
    throw err
  }
  observateurGit?.({ phase: 'fin', id, commande, ms: Date.now(), code: 0 })
  return args.includes('-z') ? stdout : stdout.trim()
}

export function parseNullSeparatedPaths(stdout: string): string[] {
  return stdout.split('\0').filter((path) => path.length > 0)
}

/**
 * Comme defaultGit mais ne jette PAS : renvoie code + sorties (pour détecter un conflit de merge).
 * `options.timeoutMs` remplace le délai d'une commande pour un appel qui a son propre budget.
 */
export function tryGit(
  repo: string,
  args: string[],
  options: { timeoutMs?: number } = {}
): { code: number; stdout: string; stderr: string } {
  const commande = libelleCommandeGit(args)
  const id = ++prochainIdGit
  observateurGit?.({ phase: 'debut', id, commande, ms: Date.now() })
  let resultat: { code: number; stdout: string; stderr: string }
  try {
    const stdout = execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeoutMs ?? GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    resultat = { code: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string }
    resultat = {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? ''
    }
  }
  // Après le try : un observateur qui jetterait ne doit pas être lu comme un échec de git.
  observateurGit?.({ phase: 'fin', id, commande, ms: Date.now(), code: resultat.code })
  return resultat
}

/**
 * MEME CONTRAT QUE `tryGit`, MAIS SANS TENIR LA BOUCLE D'EVENEMENTS.
 *
 * Mesure du 2026-09-08 (`gels.jsonl`, ligne 10:23:55) : le premier passage du balayage de retention
 * lance UN `git cherry` par ref de secours -- 97 appels ce jour-la -- en `execFileSync`. Total :
 * 11 720 ms de fenetre figee, pendant la construction de la fenetre, donc en plein demarrage. Le
 * travail lui-meme est legitime ; c'est sa forme SYNCHRONE sur le thread principal qui gele l'app.
 *
 * Rien d'autre ne change : memes arguments, meme repertoire, meme timeout, meme forme de reponse.
 * L'observateur voit aussi cette commande (début, fin, même identifiant) : sans lui, un délai qui
 * attend une commande asynchrone nommerait « aucune commande en cours », à tort.
 */
export function tryGitAsync(
  repo: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const commande = libelleCommandeGit(args)
    const id = ++prochainIdGit
    observateurGit?.({ phase: 'debut', id, commande, ms: Date.now() })
    execFile(
      'git',
      args,
      { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: GIT_COMMAND_TIMEOUT_MS },
      (erreur, stdout, stderr) => {
        const statut = (erreur as { code?: number } | null)?.code
        const code = erreur ? (typeof statut === 'number' ? statut : 1) : 0
        try {
          observateurGit?.({ phase: 'fin', id, commande, ms: Date.now(), code })
        } finally {
          resolve({
            code,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? '')
          })
        }
      }
    )
  })
}

/** `git status` de la base — une seule source, partagée par la lecture sync et async. */
export const ARGS_STATUT_DE_LA_BASE = [
  'status',
  '--porcelain=v1',
  '-z',
  '--untracked-files=all'
] as const

/** `git worktree remove` d'une copie — une seule source, partagee par le retrait sync et async. */
export function argsDeRetraitDeCopie(path: string, force: boolean): string[] {
  return ['worktree', 'remove', ...(force ? ['--force'] : []), path]
}

/** Les refs que le balayage de retention examine — une seule source, partagee sync/async. */
export const ARGS_REFS_RETENTION = [
  'for-each-ref',
  '--format=%(refname) %(objectname) %(committerdate:unix)',
  'refs/heads/autowin/',
  /*
   * LES BRANCHES DE SECOURS VIVENT SUR LE SERVEUR, pas en local : ZERO `refs/heads/autowin/` sur ce
   * depot le 2026-09-08, et 62 sous `refs/remotes/origin/autowin/`. Sans cette ligne le balayage
   * ignorait exactement le stock qui a motive ce chantier. Un motif a etoile ne filtre PAS avec
   * `for-each-ref` (verifie : rend 0) -- on prend tout `refs/remotes/` et le filtre de famille
   * ecarte le reste.
   */
  'refs/remotes/',
  'refs/autowin/'
]

export type CandidatRetention = { nom: string; sha: string; famille: string; ageMs?: number }

/** Ce que git sait d'une ref de retention — la forme qui traverse le worker (aucune fonction). */
export type VerdictRetention = { candidat: CandidatRetention; apporteQuelqueChose: boolean }

/** Lit la sortie de `for-each-ref` et rend les refs retenues, avec leur famille et leur age. */
export function refsDeRetention(stdout: string, maintenant: number): CandidatRetention[] {
  const candidats: CandidatRetention[] = []
  for (const ligne of stdout.split(LIGNES)) {
    const [refname, sha, ts] = ligne.trim().split(' ')
    if (!refname || !sha) continue
    const estBranche =
      refname.startsWith('refs/heads/autowin/') ||
      /^refs[/]remotes[/][^/]+[/]autowin[/]/.test(refname)
    const famille = estBranche ? 'branche' : (WorktreeManager.familleDeRefAutowin(refname) ?? '')
    if (!famille) continue
    const secondes = Number(ts)
    candidats.push({
      nom: refname,
      sha,
      famille,
      ...(Number.isFinite(secondes) ? { ageMs: maintenant - secondes * 1_000 } : {})
    })
  }
  return candidats
}

/** Compose l'entree de balayage — meme forme quelle que soit la voie qui a pose la question a git. */
export function entreeDeRetention(
  candidat: CandidatRetention,
  apporteQuelqueChose: boolean,
  consigne: (sha: string) => boolean
): EntreeBalayage {
  return {
    nom: candidat.nom,
    famille: candidat.famille,
    apporteQuelqueChose,
    shaConsigne: consigne(candidat.sha),
    ...(candidat.ageMs === undefined ? {} : { ageMs: candidat.ageMs })
  }
}

/**
 * Rend une exception de finalisation LISIBLE par celui qui devra reparer le run.
 *
 * Mesure le 2026-08-27 : un `catch` sans parametre remplacait l'erreur reelle par une
 * phrase constante. Le run - vert, juge VALIDE, 2,47 $ - s'est clos en `red` sur « La finalisation
 * Git a echoue de facon inattendue. », et plus personne, ni l'utilisateur ni la trace, ne pouvait
 * savoir ce qui avait echoue. La categorie (`merge-failed`) survivait ; la cause etait jetee.
 *
 * On garde la phrase - elle nomme la categorie - et on lui rend son complement : le message, puis
 * le premier cadre de pile, qui suffit a situer le point de rupture. Borne a 600 caracteres : ce
 * `detail` traverse le ledger et l'UI, une pile entiere y serait illisible.
 */
export function detailFinalisationJetee(erreur: unknown): string {
  const prefixe = 'La finalisation Git a échoué de façon inattendue'
  const message =
    erreur instanceof Error
      ? erreur.message
      : typeof erreur === 'string'
        ? erreur
        : (() => {
            try {
              return JSON.stringify(erreur) ?? String(erreur)
            } catch {
              return String(erreur)
            }
          })()
  const cadre =
    erreur instanceof Error && erreur.stack
      ? (erreur.stack
          .split(/\r?\n/)
          .map((ligne) => ligne.trim())
          .find((ligne) => ligne.startsWith('at ')) ?? '')
      : ''
  const corps = [message, cadre].filter((part) => part.length > 0).join(' — ')
  if (!corps) return prefixe + '.'
  const texte = prefixe + ' : ' + corps
  return texte.length > 600 ? texte.slice(0, 597) + '...' : texte
}

export interface WorktreeManagerOptions {
  baseRepo: string
  worktreeRoot: string
  /**
   * La racine unique des copies de tâche : toute copie d'agent naît sous elle. Une copie déjà née sous
   * `worktreeRoot` reste là où elle est et se reprend par son ancien nom.
   */
  racineCopiesDeTaches: string
  /** Branche de base sur laquelle fusionner (défaut : la branche courante du repo). */
  baseBranch?: string
  /** En production, refuse un job de mutation si origin/main|master ne peut pas être vérifié. */
  requireCanonicalRemote?: boolean
  git?: GitRunner
  /** tryGit injectable (tests) ; défaut = wrapper execFileSync non-jetant. */
  tryGitFn?: typeof tryGit
  /**
   * Pendant ASYNCHRONE de `tryGitFn`, pour les gestes qui ne doivent pas tenir la boucle (retrait
   * d'une copie par le balayage horaire). Défaut : `tryGitAsync` — sauf si un `tryGitFn` a été
   * injecté seul, auquel cas c'est LUI qui répond : un test qui simule git le simule partout.
   */
  tryGitAsyncFn?: typeof tryGitAsync
  /** Suppression disque injectable pour simuler les verrous Windows dans les tests. */
  removeDirFn?: (path: string) => void
  /**
   * Pendant ASYNCHRONE de `removeDirFn`, pour le retrait disque du balayage horaire (heal :
   * 153,8 s de fenêtre figée sur une copie supprimée en synchrone). Défaut : `supprimerArbreAsync` —
   * sauf si un `removeDirFn` a été injecté seul, auquel cas c'est LUI qui répond : un test qui
   * simule le disque le simule partout (même règle que `tryGitAsyncFn`).
   */
  removeDirAsyncFn?: (path: string) => Promise<void>
  /** Publication atomique du verrou index, injectable pour les tests de crash. */
  linkFileFn?: (existingPath: string, newPath: string) => void
  /** Suppression du verrou index, injectable pour les tests de contention Windows. */
  removeIndexLockFn?: (path: string) => void
  /** Identité stable du processus (démarrage + exécutable), injectable pour les tests. */
  processIdentityFn?: (pid: number) => string | null | undefined
  nowFn?: () => number
  /** Désactive le client worker à l'intérieur du worker lui-même. */
  disableAsyncOperations?: boolean
  /**
   * Fabrique du worker d'opérations, injectable (tests) : fournie, elle crée le client même sans
   * fichier worker compilé et même avec un git simulé — c'est le test qui décide ce que répond le
   * worker.
   */
  operationWorkerFactory?: () => WorktreeOperationWorkerLike
  operationTimeoutMs?: number
}

export const SPAWN_INTENT_MAX_AGE_MS = 2 * 60 * 1_000
export const COMPENSATION_INDEX_ACQUIRE_MAX_AGE_MS = 5 * 60 * 1_000
export const COMPENSATION_INDEX_MARKER_SWEEP_LIMIT = 256

/**
 * Âge minimal avant qu'une copie agent SANS aucun travail récupérable soit considérée abandonnée.
 * Marge délibérément large : un run vivant qui n'a pas encore posé son lease (fenêtre acquire →
 * markSpawnIntent) reste hors de portée du balayage.
 */
export const ABANDONED_AGENT_MIN_AGE_MS = 24 * 60 * 60 * 1_000

/**
 * Age minimal pour une copie qui ne retient RIEN : aucun fichier non publie, et un HEAD deja
 * contenu par une reference du depot. La supprimer ne peut donc rien perdre.
 *
 * POURQUOI CE SECOND SEUIL EXISTE. Mesure du 20/08 sur l'installation de l'utilisateur : 25 copies
 * pour 670 Mo, dont 14 propres et entierement contenues dans `main` — donc sans le moindre enjeu.
 * Aucune n'etait ramassable : creees entre 07:57 et 19:01, toutes avaient moins de 24 h. Une journee
 * de travail produit une copie par `edit_file` (~33 Mo) et le seul mecanisme capable de les rendre
 * refusait de les regarder avant le lendemain. L'utilisateur l'a nomme : « une usine a worktrees
 * abandonnes ».
 *
 * POURQUOI 3 H ET NON 30 MIN. Le delai de 24 h ne protege pas seulement la fenetre
 * `acquire → markSpawnIntent` : il couvre aussi un run VIVANT mais momentanement inactif, dont la
 * mtime cesse d'avancer. Une copie propre et deja publiee est indiscernable d'un residu SAUF par le
 * bail PID (`hasActiveProcesses`). Descendre a quelques minutes ferait donc reposer la securite sur
 * la seule fraicheur de ce bail — et un bail perime apres un crash supprimerait le bureau d'un agent
 * au travail, ce qui serait bien pire que du disque perdu. Trois heures laissent une marge large
 * au-dessus de toute verification longue, tout en vidant l'usine dans la journee.
 */
export const RESIDU_SANS_ENJEU_MIN_AGE_MS = 3 * 60 * 60 * 1_000

/**
 * L'isolation des opérations Git dans un worker : ACTIVE, et il a fallu deux correctifs pour ça.
 *
 * Elle était éteinte depuis un moment, par ACCIDENT : le chemin du worker était calculé depuis
 * `__dirname`, qui vaut `out/main/chunks` pour ce module (le bundler l'émet dans son propre morceau)
 * alors que le worker vit dans `out/main`. `existsSync` échouait donc toujours, et comme cette présence
 * est la condition de l'isolation, tout le travail Git repassait sur le fil principal sans un mot.
 *
 * Une fois la résolution corrigée, l'activer CASSAIT la récupération : un run restauré au lieu de 215.
 * Deux causes, mesurées et corrigées séparément :
 *  - une seule copie au lien Git mort faisait échouer l'inventaire ENTIER — `recoveryInventory` ne
 *    tolérait pas la panne copie par copie, contrairement au chemin synchrone ;
 *  - l'inventaire recevait le budget d'UNE commande git (32 s) alors qu'il balaie 52 copies. Il était
 *    interrompu à mi-course, avec le message exact « interrompu après 32000 ms » : la mesure disait
 *    vrai, c'est la limite qui était de la mauvaise catégorie.
 *
 * PREUVE d'équivalence, faite AVANT d'activer : les deux chemins restaurent exactement les mêmes 215
 * runs, identifiant par identifiant — 0 manquant, 0 en plus, comparé par différence d'ensembles et non
 * par un compte. Et la latence IPC retombe au plancher : médiane 2 ms, max 1,3 s, contre 3,9 s avec le
 * travail sur le fil principal et 23,9 s avant tout report.
 *
 * Le drapeau qui figeait l'isolation a été RETIRÉ plutôt que passé à `true` : une constante que rien ne
 * bascule est un faux réglage. La vraie porte de sortie existe déjà et sert aux tests —
 * `disableAsyncOperations`.
 */

/**
 * Où trouver `worktree-operation-worker.js` depuis le module qui le lance.
 *
 * Ce n'est pas de la défense excessive, c'est un défaut CONSTATÉ. `WorktreeManager` est assez gros pour
 * que le bundler l'émette dans son propre morceau, `out/main/chunks/worktree-manager-*.js`, tandis que
 * le worker reste à `out/main/worktree-operation-worker.js`. Le chemin calculé depuis `__dirname`
 * désignait donc `out/main/chunks/worktree-operation-worker.js`, qui n'existe pas — et comme la
 * présence du worker est justement la CONDITION de l'isolation, celle-ci était silencieusement
 * éteinte. Aucune erreur, aucun avertissement : tout le travail git repassait sur le fil principal.
 *
 * MESURÉ, c'était l'origine des ~23 s de blocage au démarrage : avec l'isolation réellement active,
 * l'inventaire de récupération est calculé dans le worker et la réconciliation n'exécute plus un seul
 * `git` sur le fil principal.
 *
 * On remonte d'un cran, pas plus : `out/main/chunks` → `out/main` couvre la mise en morceaux sans
 * transformer une résolution en recherche à l'aveugle.
 */
export function resoudreCheminWorker(
  dossierModule: string,
  existe: (chemin: string) => boolean
): string {
  const candidats = [
    join(dossierModule, 'worktree-operation-worker.js'),
    join(dossierModule, '..', 'worktree-operation-worker.js')
  ]
  return candidats.find((candidat) => existe(candidat)) ?? candidats[0]
}

/**
 * Le CHEMIN d'une ligne `git status --porcelain`, sans son statut.
 *
 * Couper trois caracteres en dur ne marche pas : la sortie est trimee globalement, donc la PREMIERE
 * ligne perd son espace de tete et se retrouve decalee d'un cran. Defaut introduit puis mesure le
 * 2026-08-26 — l'apercu rendait « rc/renderer/... » au lieu de « src/renderer/... », soit un chemin
 * qui n'existe nulle part. Un renommage (`R  ancien -> nouveau`) rend le NOUVEAU nom, seul utile.
 */
export function cheminDeStatutPorcelain(ligne: string): string {
  const sansStatut = ligne.replace(/^[ADMRCU?! ]{1,2}[ ]+/, '')
  const fleche = sansStatut.lastIndexOf(' -> ')
  return (fleche >= 0 ? sansStatut.slice(fleche + 4) : sansStatut).trim()
}

/**
 * Rattache des fonctions `function f(this: WorktreeManager, ...)` au prototype comme le ferait une
 * méthode de classe (non énumérable, modifiable), pour découper la classe sans changer ses appels
 * (lot 3).
 */
export function attacherMethodes(proto: object, methodes: Record<string, unknown>): void {
  for (const [nom, fn] of Object.entries(methodes)) {
    if (typeof fn !== 'function') continue
    Object.defineProperty(proto, nom, {
      value: fn,
      writable: true,
      enumerable: false,
      configurable: true
    })
  }
}

/**
 * Un run dont le point de reprise vit encore garde sa copie : la retirer rend sa reprise impossible.
 * Tout retrait de copie passe par cette garde (`cleanupWorktree`, `cleanupWorktreeAsync`, et les
 * retraits par le disque), sauf un retrait voulu qui la déclare par `passeOutre`.
 */
export const DETAIL_POINT_DE_REPRISE_VIVANT =
  'un point de reprise vit encore pour ce run : la copie est gardée'

/**
 * Options d'un retrait de copie. `raison` nomme la sortie dans le journal ; `passeOutre` est le motif
 * d'un retrait voulu qui ignore la garde du point de reprise.
 */
export type OptionsDeRetrait = { raison?: string; passeOutre?: string }

export const RAISON_NON_NOMMEE = 'retrait sans raison nommée'

/**
 * Journal des retraits, à la racine des copies. C'est un fichier, pas un dossier `agent__` : le balayage
 * ne retient que ces dossiers, il ne touche donc jamais ce journal.
 */
export const JOURNAL_DES_RETRAITS = '.retraits.jsonl'

/**
 * Journal des lancements qui ont repris une base LOCALE faute de fetch d'origine. Même place et même
 * raison d'être que le journal des retraits : un fichier à la racine, que le balayage ne touche pas.
 */
export const JOURNAL_DES_LANCEMENTS = '.lancements.jsonl'

export function copieGardeeParUnPointDeReprise(
  copiesProtegees: ReadonlySet<string>,
  path: string
): boolean {
  // fix-ok: une copie sous la racine unique porte l'identifiant du run pour nom : la garde le lit comme l'ancien nom `agent__<run>`.
  const nom = basename(path)
  const agentId = agentIdDeCopieHeritee(nom) ?? agentIdDeCopieNeuve(nom)
  return agentId !== undefined && copiesProtegees.has(agentId)
}

function ligneDeRetrait(path: string, raison: string): string {
  const nom = basename(path)
  const run = nom.startsWith('agent__') ? nom.slice('agent__'.length) : nom
  return `${JSON.stringify({ quand: new Date().toISOString(), run, raison })}\n`
}

/**
 * Trace un retrait DÉJÀ RÉUSSI : la copie est partie, la trace ne peut plus l'empêcher. Un échec
 * d'écriture est donc rendu au lieu d'être avalé, pour que le blocage soit nommé.
 */
export function tracerRetraitDeCopie(
  racine: string,
  path: string,
  raison: string
): string | undefined {
  try {
    appendFileSync(join(racine, JOURNAL_DES_RETRAITS), ligneDeRetrait(path, raison))
    return undefined
  } catch (error) {
    return `trace du retrait non écrite : ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Trace un REPLI DÉJÀ DÉCIDÉ : le lancement part d'`origin/main` local, le fetch ayant échoué. La
 * trace ne peut plus l'empêcher ; un échec d'écriture est donc rendu, pour que le lancement le nomme.
 */
export function tracerRepliDeLancement(
  racine: string,
  agentId: string,
  ref: string,
  cause: string
): string | undefined {
  try {
    mkdirSync(racine, { recursive: true })
    appendFileSync(
      join(racine, JOURNAL_DES_LANCEMENTS),
      `${JSON.stringify({ quand: new Date().toISOString(), run: agentId, repli: ref, cause })}\n`
    )
    return undefined
  } catch (error) {
    return `trace du repli non écrite : ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Même trace, sans tenir la boucle : seule la forme de l'écriture change. */
export async function tracerRetraitDeCopieAsync(
  racine: string,
  path: string,
  raison: string
): Promise<string | undefined> {
  try {
    await appendFile(join(racine, JOURNAL_DES_RETRAITS), ligneDeRetrait(path, raison))
    return undefined
  } catch (error) {
    return `trace du retrait non écrite : ${error instanceof Error ? error.message : String(error)}`
  }
}
