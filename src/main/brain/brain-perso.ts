import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { sharedBrainPort } from './brain-paths'
import { racineBrainPerso } from './brain-perso-racine'
import {
  ensureBrainServerStarted,
  resolveBrainRuntime,
  type BrainLaunchResult
} from './brain-server-launch'
import { startBrainCuration } from './brain-curation-run'
import { reindexerApresMutation, startBrainIndexRebuild } from './brain-index-refresh'

/**
 * LE BRAIN PERSO, À CÔTÉ DU BRAIN D'ÉQUIPE (demande utilisateur du 2026-10-28, conv-1233 :
 * « avoir à la fois un brain d'équipe et un brain personnel »).
 *
 * Avant, Autowin ne connaissait qu'UN Brain : celui de l'équipe. Le profil local
 * (`profil-utilisateur.ts`) ne garde que 2 Ko de goûts relus à chaque tour : ni notes, ni recherche.
 *
 * Le Brain perso réutilise le MÊME moteur (même runtime Python, même jeton de service) sur un AUTRE
 * dossier et un AUTRE port. Tout le code du Brain prend déjà son environnement en paramètre :
 * `envDuBrainPerso` rend un environnement où la racine et l'origine désignent le Brain perso, et
 * les fonctions existantes (lancement, recherche, dépôt, curation, index) s'appliquent telles
 * quelles. Rien n'y passe du Brain perso vers celui de l'équipe : deux serveurs, deux dossiers.
 *
 * Choix de l'utilisateur pour le rangement : l'agent range lui-même — ce qui touche un projet ou
 * un outil de l'équipe va au Brain d'équipe, le reste au perso — et dit en une ligne où il l'a mis.
 * Les notes perso sont promues tout de suite, sans relecture humaine (lui seul les lit).
 */

/** Port du serveur du Brain perso quand rien n'est réglé (celui de l'équipe : 8765/8766). */
export const PORT_BRAIN_PERSO_PAR_DEFAUT = 8775

/**
 * Préfixe des chemins de notes du Brain perso dans ce que lit l'agent : les deux Brains ont des
 * `knowledge/…` ; sans préfixe, `brain_read` ne saurait pas lequel ouvrir.
 */
export const PREFIXE_NOTE_PERSO = 'perso:'

// Racine et dossier par défaut vivent dans `brain-perso-racine.ts` : le processus du graphe de la
// vue Knowledge les lit sans tirer le lancement du serveur, la curation ni la réindexation.
export { defaultBrainPersoRoot, racineBrainPerso, estRacineBrainPerso } from './brain-perso-racine'

/**
 * Port du Brain perso : `AUTOWIN_BRAIN_PERSO_PORT`, sinon 8775. Jamais celui de l'équipe : deux
 * serveurs sur un port, c'est le second qui ne démarre pas (verrou par port de `brain_server.py`).
 */
export function portBrainPerso(env: NodeJS.ProcessEnv = process.env): number {
  const brut = env.AUTOWIN_BRAIN_PERSO_PORT?.trim() ?? ''
  const voulu = /^\d{1,5}$/.test(brut) ? Number(brut) : PORT_BRAIN_PERSO_PAR_DEFAUT
  const port = voulu > 0 && voulu < 65536 ? voulu : PORT_BRAIN_PERSO_PAR_DEFAUT
  let portEquipe = ''
  try {
    portEquipe = sharedBrainPort(env)
  } catch {
    // Origine de l'équipe invalide : elle ne peut pas entrer en collision.
  }
  return String(port) === portEquipe ? port + 1 : port
}

export function origineBrainPerso(env: NodeJS.ProcessEnv = process.env): string {
  return `http://127.0.0.1:${portBrainPerso(env)}`
}

/**
 * L'environnement qui fait viser le Brain PERSO à tout le code du Brain, ou `undefined` sans Brain
 * perso. Le runtime (code Python, interpréteur) est épinglé sur celui de l'équipe : la racine perso
 * ne porte que des notes, jamais du code exécutable.
 */
export function envDuBrainPerso(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv | undefined {
  const racine = racineBrainPerso(env)
  if (!racine) return undefined
  const equipe = resolveBrainRuntime(env)
  const perso: NodeJS.ProcessEnv = {
    ...env,
    AUTOWIN_BRAIN_ROOT: racine,
    AUTOWIN_BRAIN_ORIGIN: origineBrainPerso(env)
  }
  delete perso.AUTOWIN_BRAIN_PORT
  if (equipe.tooling) perso.AUTOWIN_BRAIN_CODE_ROOT = equipe.tooling
  if (equipe.python) perso.AUTOWIN_BRAIN_PYTHON = equipe.python
  return perso
}

/**
 * Crée les deux dossiers que le moteur attend : `knowledge/` (notes promues, indexées) et `inbox/`
 * (faits déposés avant promotion). Sans `knowledge/`, la construction de l'index n'a rien à lire.
 */
export function preparerDossierBrainPerso(racine: string): void {
  mkdirSync(join(racine, 'knowledge'), { recursive: true })
  mkdirSync(join(racine, 'inbox'), { recursive: true })
}

/** Vrai si le Brain perso a déjà au moins une note promue (sinon, rien à indexer). */
export function brainPersoADesNotes(racine: string): boolean {
  const lire = (dossier: string, profondeur: number): boolean => {
    if (profondeur > 6) return false
    let entrees: import('node:fs').Dirent[]
    try {
      entrees = readdirSync(dossier, { withFileTypes: true })
    } catch {
      return false
    }
    return entrees.some((e) =>
      e.isDirectory()
        ? lire(join(dossier, e.name), profondeur + 1)
        : e.name.toLowerCase().endsWith('.md')
    )
  }
  return lire(join(racine, 'knowledge'), 0)
}

/** Vrai si l'index du Brain perso a déjà été construit. */
export function indexBrainPersoExiste(racine: string): boolean {
  return existsSync(join(racine, 'tooling', 'index'))
}

/** Un chemin rendu par la recherche perso, ou demandé par l'agent avec le préfixe `perso:`. */
export function estCheminPerso(chemin: string): boolean {
  return chemin.trim().toLowerCase().startsWith(PREFIXE_NOTE_PERSO)
}

/** Retire le préfixe `perso:` pour l'envoyer au serveur perso, qui ne connaît que `knowledge/…`. */
export function cheminSansPrefixePerso(chemin: string): string {
  const net = chemin.trim()
  return estCheminPerso(net) ? net.slice(PREFIXE_NOTE_PERSO.length).trim() : net
}

/**
 * FUSIONNE la liste des notes candidates de l'équipe et celle du Brain perso, dans ce que lit
 * l'agent. Les chemins perso reçoivent le préfixe `perso:` — c'est ce que `brain_read` reconnaît
 * pour ouvrir la note dans le BON Brain. Les chemins sont ceux écrits entre accents graves par le
 * serveur (« `knowledge/…md` · 1 Ko · decision »).
 */
export function fusionnerListesBrain(equipe: string, perso: string): string {
  const listePerso = perso.trim()
  if (!listePerso) return equipe.trim()
  const marquee = listePerso.replace(/`([^`\s][^`]*?\.md)`/g, (_tout, chemin: string) =>
    estCheminPerso(chemin) ? `\`${chemin}\`` : `\`${PREFIXE_NOTE_PERSO}${chemin}\``
  )
  const entete =
    '## BRAIN PERSO — notes privées de l’utilisateur (jamais partagées). ' +
    `Ouvre-les avec brain_read en GARDANT le préfixe \`${PREFIXE_NOTE_PERSO}\`.`
  const blocEquipe = equipe.trim()
  return blocEquipe
    ? `## BRAIN D’ÉQUIPE\n\n${blocEquipe}\n\n${entete}\n\n${marquee}`
    : `${entete}\n\n${marquee}`
}

/**
 * Ping du serveur perso : GET `/`, corps lu jusqu'au bout (sinon WinError 10053 côté serveur).
 * TOUTE réponse HTTP vaut « debout », comme la sonde de l'équipe (`preflight-probes.ts`) :
 * `brain_server.py` répond 403 à `GET /` (mesuré le 2026-10-28 : exiger un 200 voyait le serveur
 * perso éteint alors qu'il écoutait sur 8775).
 */
export async function pingBrainPerso(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1500) // sleep-ok: borne d'abort d'un fetch local
  try {
    const reponse = await fetchFn(`${origineBrainPerso(env)}/`, { signal: ctrl.signal })
    await reponse.arrayBuffer().catch(() => undefined)
    return true
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

/**
 * Démarre le serveur du Brain perso s'il ne répond pas. Ne throw jamais. `undefined` : aucun Brain
 * perso réglé. Mêmes gardes que le serveur d'équipe (délai et plafond d'essais), comptés à part.
 */
export async function demarrerBrainPerso(
  env: NodeJS.ProcessEnv = process.env
): Promise<BrainLaunchResult | undefined> {
  const envPerso = envDuBrainPerso(env)
  const racine = racineBrainPerso(env)
  if (!envPerso || !racine) return undefined
  try {
    preparerDossierBrainPerso(racine)
  } catch {
    // Dossier non créable (droits, partage absent) : le lancement dira lui-même ce qui manque.
  }
  return ensureBrainServerStarted(() => pingBrainPerso(env), envPerso)
}

/**
 * Faits déjà déposés au Brain perso dans cette session. À part de ceux de l'équipe : un fait rangé
 * au Brain d'équipe ne doit pas empêcher de le ranger ensuite au perso (et inversement).
 */
export const depotsBrainPerso = new Map<string, string>()

/**
 * Le fait vient d'arriver dans `inbox/` du Brain perso : on le PROMEUT tout de suite (curation
 * mécanique, sans relecture humaine — l'utilisateur est seul lecteur), puis on reconstruit l'index
 * pour qu'il soit trouvable. En fond : le tour n'attend ni l'un ni l'autre.
 */
export function promouvoirBrainPerso(envPerso: NodeJS.ProcessEnv): void {
  const journal = (etape: string, r: { status: string; detail: string }): void => {
    if (r.status !== 'not-needed' && r.status !== 'nothing-to-do') {
      console.log('[brain-perso]', etape, r.status, '—', r.detail)
    }
  }
  const reindexer = (): void => {
    const racine = envPerso.AUTOWIN_BRAIN_ROOT ?? ''
    // Premier index : le serveur n'en a encore aucun à déclarer périmé, on le construit d'office.
    if (racine && !indexBrainPersoExiste(racine)) {
      journal('index', startBrainIndexRebuild(envPerso))
      return
    }
    void reindexerApresMutation({ env: envPerso })
      .then((r) => journal('index', r))
      .catch((e) => console.warn('[brain-perso] sonde impossible —', String(e)))
  }
  journal('curation', startBrainCuration(envPerso, undefined, reindexer, false, false))
}

/**
 * Au démarrage de l'app : lance le serveur perso, et construit son premier index s'il a déjà des
 * notes sans index (Brain copié d'un autre poste, dépôt cloné). Ne throw jamais.
 */
export async function demarrerBrainPersoAuLancement(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const envPerso = envDuBrainPerso(env)
  const racine = racineBrainPerso(env)
  if (!envPerso || !racine) return
  const lancement = await demarrerBrainPerso(env)
  if (lancement) console.log('[brain-perso] serveur', lancement.status, '—', lancement.detail)
  if (brainPersoADesNotes(racine) && !indexBrainPersoExiste(racine)) {
    const r = startBrainIndexRebuild(envPerso)
    console.log('[brain-perso] index', r.status, '—', r.detail)
  }
}
