import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AUTOWIN_WORKSPACE_ENV } from '../shared/app-identity'
import { signalerInterfaceVisible } from './startup-gate'
import type { AutowinOS } from './os'
import type { RunWorktreeCoordinator } from './store/run-worktree-coordinator'
import type { ProviderAdapter } from './providers/types'

/**
 * HARNAIS du e2e de chaine complete — le montage, et rien que le montage.
 *
 * Ce que ce fichier existe pour EMPECHER : la classe de defaut qui a tue la tentative precedente.
 * Elle fabriquait un faux objet `os` passe en `as never`, ce qui sautait la creation du coordinateur
 * worktrees et son injection dans l'orchestrateur — le test etait vert sans jamais atteindre le code
 * qu'il pretendait garder. Ici l'`AutowinOS` est REEL : le coordinateur arrive tout seul, et le SEUL
 * point de simulation est le provider.
 *
 * Mesures qui justifient chaque geste (sondes du 2026-08-20, cf. le RUN de la session) :
 *  - `new AutowinOS()` hors Electron : OK, ~750 ms, `os.worktrees` present.
 *  - la porte VIVANTE d'acquisition est `beginAsync()`, pas `begin()` : ce dernier n'est appele que
 *    hors mutation, ou quand le prepare asynchrone du manager manque. Une sonde dans `begin()` ne
 *    s'affiche jamais pendant un run de mutation alors que l'isolation a bien lieu.
 *  - `beginAsync()` acquiert reellement une copie en ~1 s ; le relachement la supprime sans residu.
 *  - `requireCanonicalRemote: true` JETTE sans distant `origin` -> un depot BARE LOCAL suffit, et
 *    garde le `git fetch` hors reseau.
 *  - sans `core.autocrlf false`, la copie porte CRLF quand la base porte LF : une comparaison de
 *    contenu echouerait pour une raison etrangere a ce qui est teste.
 */

/** Racine `APPDATA` d'origine, restauree au demontage (le montage la remplace par une racine propre). */
let appDataPrecedent: string | undefined

/** Un depot jetable, deja pousse sur son propre `origin` bare local. */
export interface DepotJetable {
  /** Le depot de travail — devient `os.executionWorkspace`. */
  readonly depot: string
  /** Racine temporaire a supprimer. */
  readonly racine: string
}

/**
 * Cree un depot git jetable avec son `origin` bare local et un fichier cible commite.
 *
 * UN par test, pas un partage pour la suite : `vitest.config.ts` fixe `pool: 'threads'` avec
 * isolation par fichier, mais un bare partage redeviendrait un etat mutable commun entre fichiers —
 * exactement le risque que ce montage cherche a eviter. Le cout mesure (~1 s) est borne parce que ce
 * fichier ne porte qu'UN cas.
 */
export function creerDepotJetable(cible: string, contenuInitial: string): DepotJetable {
  const racine = mkdtempSync(join(tmpdir(), 'e2e-chaine-'))
  const origin = join(racine, 'origin.git')
  const depot = join(racine, 'depot')
  mkdirSync(origin)
  mkdirSync(depot)
  const git = (args: string[], cwd: string): void => void execFileSync('git', args, { cwd })
  git(['init', '--bare', '--initial-branch=main'], origin)
  git(['init', '--initial-branch=main'], depot)
  git(['config', 'user.email', 'e2e@autowin.local'], depot)
  git(['config', 'user.name', 'E2E Chaine'], depot)
  // MESURE : sans ceci la copie isolee recoit CRLF quand la base porte LF.
  git(['config', 'core.autocrlf', 'false'], depot)
  writeFileSync(join(depot, cible), contenuInitial, 'utf8')
  git(['add', '.'], depot)
  git(['commit', '-m', 'base'], depot)
  git(['remote', 'add', 'origin', origin], depot)
  git(['push', '-u', 'origin', 'main'], depot)
  return { depot, racine }
}

/**
 * Construit un `AutowinOS` REEL pointe sur ce depot, et y branche l'adaptateur simule.
 *
 * L'ordre compte : l'environnement doit etre pose AVANT la construction, parce que le constructeur
 * resout son workspace une fois pour toutes et ne cree son coordinateur que si `<workspace>/.git`
 * existe.
 */
export async function monterOsReel(depot: string, adaptateur: ProviderAdapter): Promise<AutowinOS> {
  process.env[AUTOWIN_WORKSPACE_ENV] = depot
  /**
   * RACINE DE DONNEES PROPRE A CETTE EXECUTION — sinon ce test se suicide d'une passe a l'autre.
   *
   * `vitest.config.ts` fixe `APPDATA` a un chemin STABLE et partage par toute la suite, ce qui est
   * voulu. Mais un run d'orchestration y depose un etat NON TERMINAL (`run-state/<runId>.json`) qui
   * survit au depot temporaire : mesure du 2026-08-21, cinq etats `conv-1` portant la tache exacte
   * de ce e2e dormaient la depuis le 20/08. La passe suivante en REPREND un, exige sa copie durable
   * — disparue avec le tmp — et la chaine sort en `red` (« Reprise du worktree impossible … copie
   * durable absente ou incomplete »), sans lancer une seule phase d'execution.
   *
   * On ne desarme donc rien du produit : on donne a CE montage sa propre racine, sous le depot
   * jetable, que `demonterOs` emporte avec le reste. Elle est posee AVANT la construction, qui
   * resout `run-state` une fois pour toutes.
   */
  const racineDonnees = join(dirname(depot), 'appdata')
  mkdirSync(racineDonnees, { recursive: true })
  appDataPrecedent = process.env.APPDATA
  process.env.APPDATA = racineDonnees
  const { AutowinOS } = await import('./os')
  const os = new AutowinOS()
  /**
   * LA RECONCILIATION EST DECLENCHEE TOUT DE SUITE, et ce n'est pas un detail de confort.
   *
   * Le coordinateur differe son inventaire des copies jusqu'a `interfaceVisible`, qui en production
   * est la fenetre Electron — et qui, sans fenetre, se resout d'office au bout de son filet de
   * securite de 20 s (`startup-gate.ts:20`). Or ce test dure ~15-17 s : le filet tombait donc pile
   * PENDANT le demontage, l'inventaire enumerait les copies avec pour `cwd` un depot temporaire
   * DEJA supprime, et `execFileSync('git', ...)` levait `ENOENT` dans une promesse que le
   * constructeur `void`-e sans `catch`. Resultat mesure : une « Unhandled Rejection » imputee a ce
   * fichier, faisant sortir la suite complete en exit 1 alors que 7183 tests passaient — et,
   * probablement, les rouges intermittents que deux relecteurs ont observes.
   *
   * On ne rallonge donc aucun delai : on ORDONNE. La reconciliation se fait ici, tant que le depot
   * existe, au lieu de courir contre un filet de 20 s. `signalerInterfaceVisible` est idempotent.
   */
  signalerInterfaceVisible()
  os.registry.register(adaptateur)
  // Un provider absent de `PROVIDER_DEFAULT_SELECTIONS` traverse `normalizeRoleBinding` intact
  // (`roles.ts:76`), donc l'id simule survit tel quel sur les quatre roles.
  for (const role of ['orchestrator', 'subagent', 'judge', 'scout'] as const) {
    os.roles.setBinding(role, { provider: adaptateur.id })
  }
  return os
}

/**
 * Remet l'environnement en etat. A appeler meme quand le test echoue.
 *
 * MESURE du 2026-08-20 : sans le relachement des copies, cinq worktrees ORPHELINS sont restes dans
 * le store apres cinq executions — leur `.git` pointant vers un depot temporaire deja supprime. Un
 * test qui laisse des copies derriere lui a chaque passe fait exactement ce que ce depot combat, et
 * l'arbre de cette machine en porte deja quinze. On relache donc les runs encore tenus AVANT de
 * supprimer le depot, sinon la copie perd sa base et devient inatteignable par son propre proprietaire.
 */
export async function demonterOs(
  os?: { worktrees?: Pick<RunWorktreeCoordinator, 'activity' | 'endAsync'> },
  jetable?: DepotJetable
): Promise<void> {
  const coordinateur = os?.worktrees
  if (coordinateur) {
    for (const copie of coordinateur.activity()) {
      // Best-effort assume : on demonte, un refus ici ne doit pas masquer l'echec du test lui-meme.
      try {
        await coordinateur.endAsync(copie.agentId)
      } catch {
        /* la suppression du depot ci-dessous emporte le reste */
      }
    }
  }
  delete process.env[AUTOWIN_WORKSPACE_ENV]
  if (appDataPrecedent === undefined) delete process.env.APPDATA
  else process.env.APPDATA = appDataPrecedent
  appDataPrecedent = undefined
  if (jetable) rmSync(jetable.racine, { recursive: true, force: true })
}
