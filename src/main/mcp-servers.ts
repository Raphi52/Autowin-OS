/**
 * REGISTRE DES SERVEURS MCP DE L'UTILISATEUR (conv-1558, plan-b0502bd3, lot 1).
 *
 * Pourquoi : le CLI Claude part toujours avec `--strict-mcp-config`, donc il n'hérite d'AUCUN serveur
 * MCP du poste. L'utilisateur veut pourtant brancher des serveurs externes (Blender d'abord) depuis
 * les réglages. Ce fichier tient la liste déclarée dans Autowin — et elle seule — dans
 * `.autowin-data/autowin-os/mcp-servers.json`, et sait la FUSIONNER dans la config passée au CLI.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autowinAppDataRoot } from './app-data'

export interface ServeurMcpUtilisateur {
  /** Identifiant : il devient le préfixe des outils `mcp__<id>__<outil>`. */
  id: string
  nom: string
  commande: string
  args: string[]
  env: Record<string, string>
  actif: boolean
}

/** `autowin` est le serveur d'outils interne (`NOM_SERVEUR_MCP`) : l'écraser couperait le chat. */
const IDS_RESERVES = new Set(['autowin'])
const MOTIF_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/

/** Pré-rempli et DÉSACTIVÉ : il faut l'add-on Blender ouvert pour qu'il serve (ahujasid/blender-mcp). */
export const SERVEURS_PAR_DEFAUT: readonly ServeurMcpUtilisateur[] = [
  { id: 'blender', nom: 'Blender', commande: 'uvx', args: ['blender-mcp'], env: {}, actif: false },
  /**
   * Génération d'images (conv-1565, lot 5 du plan tanukis). Source : serveur open source MIT
   * `image-generation-mcp` (https://github.com/pvliesdonk/image-generation-mcp, paquet PyPI du même
   * nom) — OpenAI, Google Gemini, Stable Diffusion WebUI ; transport stdio par `serve`.
   * DÉSACTIVÉ, et les clés sont nommées mais VIDES : l'utilisateur les saisit dans les réglages,
   * jamais écrites dans un fichier du dépôt.
   */
  {
    id: 'images',
    nom: 'Génération d’images',
    commande: 'uvx',
    args: ['--from', 'image-generation-mcp[all]', 'image-generation-mcp', 'serve'],
    env: { IMAGE_GENERATION_MCP_OPENAI_API_KEY: '', IMAGE_GENERATION_MCP_GOOGLE_API_KEY: '' },
    actif: false
  }
]

export function cheminServeursMcp(racine = autowinAppDataRoot()): string {
  return join(racine, 'mcp-servers.json')
}

/** Rend l'entrée validée, ou le motif du refus en français. */
export function validerServeurMcp(brut: unknown): ServeurMcpUtilisateur | string {
  if (!brut || typeof brut !== 'object') return 'entrée vide'
  const o = brut as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!MOTIF_ID.test(id)) return `identifiant invalide « ${id} » (minuscules, chiffres, - ou _)`
  if (IDS_RESERVES.has(id)) return `identifiant réservé « ${id} »`
  const commande = typeof o.commande === 'string' ? o.commande.trim() : ''
  if (!commande) return 'commande manquante'
  const args = o.args ?? []
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string'))
    return 'args doit être une liste de textes'
  const env = o.env ?? {}
  if (typeof env !== 'object' || Array.isArray(env) || env === null) return 'env doit être un objet'
  if (Object.values(env).some((v) => typeof v !== 'string')) return 'env : valeurs texte seulement'
  const nom = typeof o.nom === 'string' && o.nom.trim() ? o.nom.trim() : id
  return {
    id,
    nom,
    commande,
    args: [...(args as string[])],
    env: { ...(env as Record<string, string>) },
    actif: o.actif === true
  }
}

/** Fichier absent → la liste par défaut ; fichier illisible → liste par défaut aussi, entrées invalides écartées. */
export function lireServeursMcp(chemin = cheminServeursMcp()): ServeurMcpUtilisateur[] {
  if (!existsSync(chemin)) return SERVEURS_PAR_DEFAUT.map((s) => ({ ...s, args: [...s.args] }))
  let brut: unknown
  try {
    brut = JSON.parse(readFileSync(chemin, 'utf8'))
  } catch {
    return SERVEURS_PAR_DEFAUT.map((s) => ({ ...s, args: [...s.args] }))
  }
  if (!Array.isArray(brut)) return []
  const vus = new Set<string>()
  const sortie: ServeurMcpUtilisateur[] = []
  for (const e of brut) {
    const v = validerServeurMcp(e)
    if (typeof v === 'string' || vus.has(v.id)) continue
    vus.add(v.id)
    sortie.push(v)
  }
  return sortie
}

export function ecrireServeursMcp(
  liste: ServeurMcpUtilisateur[],
  chemin = cheminServeursMcp()
): void {
  mkdirSync(dirname(chemin), { recursive: true })
  const tmp = `${chemin}.tmp`
  writeFileSync(tmp, JSON.stringify(liste, null, 2), 'utf8')
  renameSync(tmp, chemin)
}

export type ReponseServeursMcp =
  { ok: true; serveurs: ServeurMcpUtilisateur[] } | { ok: false; erreur: string }

/** Ajoute ou remplace (même id). */
export function enregistrerServeurMcp(
  brut: unknown,
  chemin = cheminServeursMcp()
): ReponseServeursMcp {
  const v = validerServeurMcp(brut)
  if (typeof v === 'string') return { ok: false, erreur: v }
  const liste = lireServeursMcp(chemin)
  const i = liste.findIndex((s) => s.id === v.id)
  if (i >= 0) liste[i] = v
  else liste.push(v)
  ecrireServeursMcp(liste, chemin)
  return { ok: true, serveurs: liste }
}

export function supprimerServeurMcp(id: unknown, chemin = cheminServeursMcp()): ReponseServeursMcp {
  const liste = lireServeursMcp(chemin)
  const reste = liste.filter((s) => s.id !== id)
  if (reste.length === liste.length)
    return { ok: false, erreur: `serveur inconnu « ${String(id)} »` }
  ecrireServeursMcp(reste, chemin)
  return { ok: true, serveurs: reste }
}

export function basculerServeurMcp(
  id: unknown,
  actif: unknown,
  chemin = cheminServeursMcp()
): ReponseServeursMcp {
  const liste = lireServeursMcp(chemin)
  const s = liste.find((x) => x.id === id)
  if (!s) return { ok: false, erreur: `serveur inconnu « ${String(id)} »` }
  s.actif = actif === true
  ecrireServeursMcp(liste, chemin)
  return { ok: true, serveurs: liste }
}

/**
 * Fusionne les serveurs ACTIFS dans une config `--mcp-config` (JSON texte) et rend les noms à
 * autoriser (`mcp__<id>__*`). Config illisible → rendue telle quelle, sans ajout : on ne casse pas
 * le serveur interne pour un serveur externe. Un id déjà présent dans la config n'est pas écrasé.
 */
export function fusionnerServeursMcp(
  config: string,
  serveurs: readonly ServeurMcpUtilisateur[]
): { config: string; autorises: string[] } {
  const actifs = serveurs.filter((s) => s.actif)
  if (actifs.length === 0) return { config, autorises: [] }
  let objet: { mcpServers?: Record<string, unknown> }
  try {
    objet = JSON.parse(config)
  } catch {
    return { config, autorises: [] }
  }
  if (!objet || typeof objet !== 'object') return { config, autorises: [] }
  const mcpServers = { ...(objet.mcpServers ?? {}) }
  const autorises: string[] = []
  for (const s of actifs) {
    if (s.id in mcpServers) continue
    mcpServers[s.id] = { type: 'stdio', command: s.commande, args: s.args, env: s.env }
    autorises.push(`mcp__${s.id}__*`)
  }
  return { config: JSON.stringify({ ...objet, mcpServers }), autorises }
}

/** Les serveurs actifs du poste, sans jamais jeter (lancement d'un agent). */
export function serveursMcpActifs(chemin?: string): ServeurMcpUtilisateur[] {
  try {
    return lireServeursMcp(chemin).filter((s) => s.actif)
  } catch {
    return []
  }
}

interface IpcMainMinimal {
  handle(canal: string, f: (event: unknown, ...args: unknown[]) => unknown): void
}

export interface OptionsIpcServeursMcp {
  ipc: IpcMainMinimal
  /**
   * Garde d'expéditeur, INJECTÉ (`assertTrustedRendererSender` depuis `index.ts`) comme pour
   * tickets et veille : ce module reste testable sans Electron. Il manquait aux 4 canaux
   * (conv-1575, rouge de `security-critical-fixes.test.ts`) alors que `save` déclare une commande
   * que le CLI lancera et que `list` rend les clés d'API saisies dans `env`.
   */
  assertTrusted(event: unknown, portee: string): void
  /** Injecté pour les tests : sinon on écrirait dans la racine de données réelle. */
  chemin?: () => string
}

/** IPC `os:mcpServers:*` — branché depuis `index.ts`, exposé par le preload. */
export function enregistrerIpcServeursMcp({
  ipc,
  assertTrusted,
  chemin
}: OptionsIpcServeursMcp): void {
  const c = (): string => (chemin ? chemin() : cheminServeursMcp())
  const proteger = (f: () => ReponseServeursMcp): ReponseServeursMcp => {
    try {
      return f()
    } catch (e) {
      return { ok: false, erreur: e instanceof Error ? e.message : String(e) }
    }
  }
  // Le garde vient AVANT `proteger` : un refus doit rejeter l'appel, pas devenir un `{ ok: false }`.
  const portee = 'Serveurs MCP'
  ipc.handle('os:mcpServers:list', (event) => {
    assertTrusted(event, portee)
    return proteger(() => ({ ok: true, serveurs: lireServeursMcp(c()) }))
  })
  ipc.handle('os:mcpServers:save', (event, s) => {
    assertTrusted(event, portee)
    return proteger(() => enregistrerServeurMcp(s, c()))
  })
  ipc.handle('os:mcpServers:delete', (event, id) => {
    assertTrusted(event, portee)
    return proteger(() => supprimerServeurMcp(id, c()))
  })
  ipc.handle('os:mcpServers:toggle', (event, id, actif) => {
    assertTrusted(event, portee)
    return proteger(() => basculerServeurMcp(id, actif, c()))
  })
}
