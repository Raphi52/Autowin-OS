// fix-ok: chemins, variables et marqueur propres à un employeur écrits en dur (mesuré par grep) ; neutralisés, anciens noms lus en secours (tests rouge→vert).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SOURCE UNIQUE des chemins du Brain et des workspaces d'equipe du main process.
 *
 * Pourquoi ce module existe : la meme racine UNC etait ecrite en dur dans QUATRE fichiers
 * (`brain-context.ts`, `brain-server-launch.ts`, `viz/fs-brains.ts` a deux endroits,
 * `behaviour-files.ts`). Trois consequences cumulees, constatees par audit le 2026-07-29 :
 *   (a) NON PORTABLE — sur une autre machine, ou hors VPN, ces chemins n'existent pas ;
 *   (b) AUCUNE source unique — corriger un site laissait les trois autres mentir ;
 *   (c) un residu de bricolage (`C:\Nouveau dossier`) tranait dans la liste blanche ANTI-TRAVERSAL
 *       de `fs-brains`, ou il ouvrait un droit de lecture sur un dossier arbitraire.
 *
 * Aucun defaut propre a une entreprise (2026-10-04) : la racine partagee et les workspaces d'equipe
 * ecrits en dur ont ete retires, chaque poste les REGLE. Noms de reglage neutres (`AUTOWIN_BRAIN_*`,
 * `AUTOWIN_WORKSPACES`) lus EN PREMIER ; les noms historiques (`AMITEL_BRAIN_*`,
 * `AUTOWIN_AMITEL_WORKSPACES`) restent lus en SECOURS — les retirer serait une regression silencieuse
 * pour les postes qui les ont deja poses (installateur Hermes-Brain compris).
 *
 * Toutes les fonctions prennent `env` en parametre (defaut `process.env`) : c'est ce qui les rend
 * testables sans toucher a l'environnement du process de test.
 */

/** Lit un reglage : le nom NEUTRE d'abord, le nom HISTORIQUE en secours. Vide ou blanc = absent. */
export function lireReglage(
  env: NodeJS.ProcessEnv,
  neutre: string,
  historique: string
): string | undefined {
  return env[neutre]?.trim() || env[historique]?.trim() || undefined
}

/**
 * Racine du Brain quand RIEN n'est regle : un dossier LOCAL propre a Autowin, jamais un partage
 * d'entreprise. Absent tant qu'on ne l'a pas cree — les lecteurs le traitent comme un Brain vide,
 * exactement comme l'ancien partage UNC hors VPN.
 */
export function defaultBrainRoot(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA?.trim() || env.HOME?.trim() || env.USERPROFILE?.trim() || '.'
  return join(base, AUTOWIN_OWN_BRAIN_STATE_DIR, 'brain')
}

/** Origine du service RAG local. Surcharge : `AUTOWIN_BRAIN_ORIGIN` (secours : `AMITEL_BRAIN_ORIGIN`). */
const DEFAULT_BRAIN_ORIGIN = 'http://127.0.0.1:8765'

/**
 * Workspaces d'equipe consultes en LECTURE quand ils existent. VIDE par defaut : un dossier ecrit en
 * dur dans une liste blanche de securite est un droit de lecture offert a n'importe quel contenu
 * qu'on y depose (`C:\Nouveau dossier`, retire le 2026-07-29). Chaque poste regle les siens.
 */
export const DEFAULT_TEAM_WORKSPACES: readonly string[] = []

/** Dossier d'etat du Brain PROPRE a Autowin, sous %LOCALAPPDATA% — voir `autowinOwnBrainRoot`. */
export const AUTOWIN_OWN_BRAIN_STATE_DIR = 'AutowinBrain'

/**
 * Racine du Brain PROPRE a Autowin, lue dans `%LOCALAPPDATA%\AutowinBrain\config.json` (`brain_root`).
 *
 * CONSTATE LE 2026-09-25 (conv-3) : sur un poste qui heberge AUSSI un Brain personnel (Hermes-Brain),
 * l'installateur de celui-ci pose `AMITEL_BRAIN_ROOT` dans les variables UTILISATEUR. Autowin en
 * heritait : il lisait ce Brain, y deposait ses lecons (`remember`, POST /ingest) et sa cloture
 * automatique y commitait. Ce dossier donne a Autowin son propre Brain : sa racine prime alors sur la
 * variable heritee, et son `config.json` porte aussi le port (cf. `origineDepuisInstallation`).
 * Absent, illisible ou sans `brain_root` (cas des postes de l'equipe) : rien ne change.
 * `AUTOWIN_BRAIN_STATE_ROOT`, reglage explicite, garde la main et sa regle d'origine.
 *
 * Seule la variable HERITEE est ecartee, et on la reconnait : elle REPETE le `brain_root` de
 * l'installation partagee (`%LOCALAPPDATA%\AmitelBrain\config.json`), puisque c'est cet installateur
 * qui l'a posee. Toute autre valeur a ete choisie pour CE process (un test, un lancement dedie) et
 * garde la priorite de l'environnement, comme partout ailleurs dans ce module.
 */
export function autowinOwnBrainRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.AUTOWIN_BRAIN_STATE_ROOT?.trim()) return undefined
  const localAppData = env.LOCALAPPDATA?.trim()
  if (!localAppData) return undefined
  const own = brainRootOfInstallation(join(localAppData, AUTOWIN_OWN_BRAIN_STATE_DIR))
  if (!own) return undefined
  // Une racine posee sous le nom NEUTRE est un choix explicite pour CE poste : elle garde la main.
  if (env.AUTOWIN_BRAIN_ROOT?.trim()) return undefined
  const inherited = env.AMITEL_BRAIN_ROOT?.trim()
  if (inherited) {
    // Nom de dossier HISTORIQUE de l'installation partagee : c'est la qu'elle est posee sur disque.
    const shared = brainRootOfInstallation(join(localAppData, 'AmitelBrain'))
    if (!shared || !sameRoot(inherited, shared)) return undefined
  }
  return own
}

function brainRootOfInstallation(stateRoot: string): string | undefined {
  try {
    const config = JSON.parse(readFileSync(join(stateRoot, 'config.json'), 'utf8')) as {
      brain_root?: unknown
    }
    const root = typeof config.brain_root === 'string' ? config.brain_root.trim() : ''
    return root || undefined
  } catch {
    return undefined
  }
}

/** Meme dossier Windows, quelle que soit l'ecriture : barres obliques, casse, barre finale. */
function sameRoot(left: string, right: string): boolean {
  const normalize = (value: string): string =>
    value.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return normalize(left) === normalize(right)
}

export function sharedBrainRoot(env: NodeJS.ProcessEnv = process.env): string {
  const own = autowinOwnBrainRoot(env)
  if (own) return own
  const configured = lireReglage(env, 'AUTOWIN_BRAIN_ROOT', 'AMITEL_BRAIN_ROOT')
  if (configured) return configured
  return racineDepuisInstallation(env) ?? defaultBrainRoot(env)
}

/**
 * Racine lue dans la CONFIGURATION POSEE PAR L'INSTALLATION (`config.json`, cle `brain_root`),
 * quand l'environnement est muet — meme logique que `origineDepuisInstallation` plus bas.
 *
 * DEFAUT VECU (conv-2, 2026-09-10) : le moteur de requete (`resolveBrainRuntime`) lisait deja
 * `config.json` et repondait depuis le brain local, pendant que la vue Knowledge
 * (`listBrains` → `scanBrainGraphs`) ne lisait QUE l'environnement et retombait sur le partage
 * reseau — inexistant hors VPN, donc AUCUN coffre de savoir affiche alors que les requetes,
 * elles, marchaient. Deux resolutions pour la meme racine = deux verites ; ce repli realigne les
 * deux sur le fichier d'installation.
 */
function racineDepuisInstallation(env: NodeJS.ProcessEnv): string | undefined {
  const stateRoot = sharedBrainStateRoot(env)
  if (!stateRoot) return undefined
  return brainRootOfInstallation(stateRoot)
}

export function requireLoopbackBrainOrigin(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Origine Brain invalide : loopback HTTP requis')
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  if (
    parsed.protocol !== 'http:' ||
    !loopbackHosts.has(parsed.hostname.toLowerCase()) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Origine Brain invalide : loopback HTTP requis')
  }
  return parsed.origin
}

/**
 * Origine lue dans la CONFIGURATION POSEE PAR L'INSTALLATION, quand l'environnement est muet.
 *
 * DEFAUT VECU (conv-8, 2026-09-03) : le serveur a jour ecoutait 8766 (c'est lui qui porte l'echange
 * de defi du protocole 2 ; un binaire plus ancien squattait 8765). Cote client, l'origine ne vivait
 * QUE dans la variable `AMITEL_BRAIN_ORIGIN` du shell ou elle avait ete tapee : le processus
 * principal, lance sans elle, retombait sur le defaut 8765 et chaque lecture du savoir rendait
 * « indisponible » en 15 ms (connexion refusee). Persister la variable ne suffit pas — un
 * redemarrage qui herite de l'ancien environnement la perd a nouveau, ce qui a ete MESURE : l'app
 * relancee a demarre un second serveur sur 8765.
 *
 * `config.json` est deja la source de verite des chemins de l'installation (`brain_root`,
 * `code_root`, `python`, lus par `brain-server-launch`). Le PORT y appartient au meme titre : un
 * seul fichier decide, client et serveur le lisent, et plus rien ne depend de ce qu'un shell a
 * exporte. `origin` est prioritaire ; `port` est accepte comme raccourci.
 */
function origineDepuisInstallation(env: NodeJS.ProcessEnv): string | undefined {
  const stateRoot = sharedBrainStateRoot(env)
  if (!stateRoot) return undefined
  let config: { origin?: unknown; port?: unknown }
  try {
    config = JSON.parse(readFileSync(join(stateRoot, 'config.json'), 'utf8')) as typeof config
  } catch {
    // Installation absente ou inachevee : le defaut reste valide, on ne fait pas echouer la lecture.
    return undefined
  }
  const origin = typeof config.origin === 'string' ? config.origin.trim() : ''
  if (origin) return origin
  const brut =
    typeof config.port === 'number'
      ? String(config.port)
      : typeof config.port === 'string'
        ? config.port.trim()
        : ''
  if (!/^\d{1,5}$/.test(brut)) return undefined
  const port = Number(brut)
  return port > 0 && port < 65536 ? `http://127.0.0.1:${port}` : undefined
}

export function sharedBrainOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const parEnv = lireReglage(env, 'AUTOWIN_BRAIN_ORIGIN', 'AMITEL_BRAIN_ORIGIN')
  const parPort = lireReglage(env, 'AUTOWIN_BRAIN_PORT', 'AMITEL_BRAIN_PORT')
  const configured =
    parEnv || (/^\d{1,5}$/.test(parPort ?? '') ? `http://127.0.0.1:${parPort}` : '')
  return requireLoopbackBrainOrigin(
    configured || origineDepuisInstallation(env) || DEFAULT_BRAIN_ORIGIN
  )
}

/** Port du service, derive de la MEME origine : le serveur lance ne peut plus viser un autre port. */
export function sharedBrainPort(env: NodeJS.ProcessEnv = process.env): string {
  const { port } = new URL(sharedBrainOrigin(env))
  return port || '80'
}

/** Etat et runtime installes localement par Hermes-Brain. Le partage ne contient que les donnees. */
export function sharedBrainStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AUTOWIN_BRAIN_STATE_ROOT?.trim()
  if (configured) return configured
  const localAppData = env.LOCALAPPDATA?.trim()
  if (!localAppData) return ''
  // Le Brain propre a Autowin porte son port dans SON config.json : l'etat le suit.
  if (autowinOwnBrainRoot(env)) return join(localAppData, AUTOWIN_OWN_BRAIN_STATE_DIR)
  // Nom de dossier HISTORIQUE de l'installation partagee (Hermes-Brain) : il existe deja sur les postes.
  return join(localAppData, 'AmitelBrain')
}

/** Racine du runtime Python LOCAL. Elle ne dérive jamais du partage de données du Brain. */
export function sharedBrainTooling(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AUTOWIN_BRAIN_TOOLING?.trim()
  if (configured) return configured
  const installed = lireReglage(env, 'AUTOWIN_BRAIN_CODE_ROOT', 'AMITEL_BRAIN_CODE_ROOT')
  if (installed) return installed
  const stateRoot = sharedBrainStateRoot(env)
  return stateRoot ? join(stateRoot, 'tooling') : ''
}

/**
 * Workspaces d'equipe, regles par `AUTOWIN_WORKSPACES` (secours : `AUTOWIN_AMITEL_WORKSPACES`), liste
 * separee par `;` ; entrees vides et doublons ignores.
 * Sert au repli de `defaultBehaviourWorkspace` et aux racines de lecture autorisees.
 */
export function teamWorkspaces(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = lireReglage(env, 'AUTOWIN_WORKSPACES', 'AUTOWIN_AMITEL_WORKSPACES')
  if (configured) {
    const parsed = [
      ...new Set(
        configured
          .split(';')
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    ]
    if (parsed.length > 0) return parsed
  }
  return [...DEFAULT_TEAM_WORKSPACES]
}
