import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SOURCE UNIQUE des chemins d'entreprise (Amitel) du main process.
 *
 * Pourquoi ce module existe : la meme racine UNC etait ecrite en dur dans QUATRE fichiers
 * (`amitel-context.ts`, `brain-server-launch.ts`, `viz/fs-brains.ts` a deux endroits,
 * `behaviour-files.ts`). Trois consequences cumulees, constatees par audit le 2026-07-29 :
 *   (a) NON PORTABLE — sur une autre machine, ou hors VPN, ces chemins n'existent pas ;
 *   (b) AUCUNE source unique — corriger un site laissait les trois autres mentir ;
 *   (c) un residu de bricolage (`C:\Nouveau dossier`) tranait dans la liste blanche ANTI-TRAVERSAL
 *       de `fs-brains`, ou il ouvrait un droit de lecture sur un dossier arbitraire.
 *
 * Ce que ce module NE fait PAS : retirer le defaut Amitel. Il fonctionne sur les postes de l'equipe
 * et le retirer casserait leur usage. Le but est la source UNIQUE et la SURCHARGEABILITE — chaque
 * valeur reste pilotable par variable d'environnement, avec les MEMES noms qu'avant (toute
 * renomination serait une regression silencieuse pour qui les utilise deja).
 *
 * Toutes les fonctions prennent `env` en parametre (defaut `process.env`) : c'est ce qui les rend
 * testables sans toucher a l'environnement du process de test.
 */

/** Racine du Brain partage. Surcharge : `AMITEL_BRAIN_ROOT` (nom historique, preserve). */
export const DEFAULT_BRAIN_ROOT = '\\\\ged2\\rig\\Projets IA\\Amitel Brain'

/** Origine du service RAG local. Surcharge : `AMITEL_BRAIN_ORIGIN` (nom historique, preserve). */
export const DEFAULT_BRAIN_ORIGIN = 'http://127.0.0.1:8765'

/**
 * Workspaces d'entreprise consultes en LECTURE quand ils existent. `C:\Nouveau dossier` a ete RETIRE :
 * un nom de dossier generique dans une liste blanche de securite est un droit de lecture offert a
 * n'importe quel contenu qu'on y depose.
 */
export const DEFAULT_AMITEL_WORKSPACES: readonly string[] = ['C:\\Amitel', 'C:\\Code RIG']

export function amitelBrainRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AMITEL_BRAIN_ROOT?.trim()
  return configured ? configured : DEFAULT_BRAIN_ROOT
}

export function requireLoopbackBrainOrigin(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Origine Amitel Brain invalide : loopback HTTP requis')
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
    throw new Error('Origine Amitel Brain invalide : loopback HTTP requis')
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
  const stateRoot = amitelBrainStateRoot(env)
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

export function amitelBrainOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const parEnv = env.AMITEL_BRAIN_ORIGIN?.trim()
  const parPort = env.AMITEL_BRAIN_PORT?.trim()
  const configured =
    parEnv || (/^\d{1,5}$/.test(parPort ?? '') ? `http://127.0.0.1:${parPort}` : '')
  return requireLoopbackBrainOrigin(
    configured || origineDepuisInstallation(env) || DEFAULT_BRAIN_ORIGIN
  )
}

/** Port du service, derive de la MEME origine : le serveur lance ne peut plus viser un autre port. */
export function amitelBrainPort(env: NodeJS.ProcessEnv = process.env): string {
  const { port } = new URL(amitelBrainOrigin(env))
  return port || '80'
}

/** Etat et runtime installes localement par Hermes-Brain. Le partage ne contient que les donnees. */
export function amitelBrainStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AUTOWIN_BRAIN_STATE_ROOT?.trim()
  if (configured) return configured
  const localAppData = env.LOCALAPPDATA?.trim()
  return localAppData ? join(localAppData, 'AmitelBrain') : ''
}

/** Racine du runtime Python LOCAL. Elle ne dérive jamais du partage de données du Brain. */
export function amitelBrainTooling(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AUTOWIN_BRAIN_TOOLING?.trim()
  if (configured) return configured
  const installed = env.AMITEL_BRAIN_CODE_ROOT?.trim()
  if (installed) return installed
  const stateRoot = amitelBrainStateRoot(env)
  return stateRoot ? join(stateRoot, 'tooling') : ''
}

/**
 * Workspaces d'entreprise, surchargeables par `AUTOWIN_AMITEL_WORKSPACES` (liste separee par `;`).
 * Sert au repli de `defaultBehaviourWorkspace` et aux racines de lecture autorisees.
 */
export function amitelWorkspaces(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.AUTOWIN_AMITEL_WORKSPACES?.trim()
  if (configured) {
    const parsed = configured
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (parsed.length > 0) return parsed
  }
  return [...DEFAULT_AMITEL_WORKSPACES]
}
