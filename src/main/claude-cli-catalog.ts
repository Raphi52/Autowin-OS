import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { CLAUDE_MODEL_RE } from './model-aliases'

/**
 * Catalogue Claude lu dans le BINAIRE DU CLI INSTALLE — la source de verite locale.
 *
 * Pourquoi ici et pas ailleurs (2026-07-30) : la liste venait d'un service PERSONNEL
 * (`claude-bridge/bridge.py` sur 127.0.0.1:8787, dans le %LOCALAPPDATA% d'un seul poste). Un collegue
 * sans ce projet perso ne voyait aucun modele recent — Opus 5 lui etait parfaitement disponible, mais
 * l'app ne savait pas le nommer. Le CLI, lui, est present par construction : l'app le spawne pour
 * TOUT appel Claude. Il embarque ses identifiants de modeles, donc il peut les dire.
 *
 * MESURE (2026-07-30) : le binaire installe contient bien `claude-opus-5` et `claude-sonnet-5`, parmi
 * 34 chaines de forme modele — dont des variantes qu'il ne faut PAS proposer (`-v1`, `-fast`,
 * `claude-fable-5-mythos-5`). Le filtre est `CLAUDE_MODEL_RE`, deja la regex canonique du depot : elle
 * n'accepte que `claude-<famille>-<majeur>[-<mineur>][-<date>]` et rejette donc ces variantes.
 *
 * POURQUOI UN SCAN EN FLUX : ce binaire pese ~255 Mo (node + JS empaquetes). Le charger en memoire a
 * chaque demarrage serait inacceptable. On lit par blocs avec un CHEVAUCHEMENT, sinon un identifiant a
 * cheval sur deux blocs serait perdu — un modele manquerait au hasard de sa position dans le fichier.
 */

/** Assez grand pour amortir les lectures, assez petit pour ne pas peser en memoire. */
const CHUNK_BYTES = 4 * 1024 * 1024
/** Aucun identifiant de modele n'approche cette longueur ; garantit qu'aucun ne soit coupe en deux. */
const OVERLAP_BYTES = 128

export interface ClaudeCliIdentity {
  /** Taille du binaire — change a chaque mise a jour du CLI. */
  size: number
  /** Date de modification (ms) — deuxieme discriminant, pour une taille identique. */
  modifiedMs: number
}

/** Identite du binaire, qui sert de CLE DE CACHE : on ne rescanne qu'apres une mise a jour du CLI. */
export function claudeCliIdentity(binPath: string): ClaudeCliIdentity | undefined {
  try {
    const stat = statSync(binPath)
    if (!stat.isFile()) return undefined
    return { size: stat.size, modifiedMs: stat.mtimeMs }
  } catch {
    return undefined
  }
}

/** Deux identites designent-elles le MEME binaire ? */
export function sameClaudeCli(
  a: ClaudeCliIdentity | undefined,
  b: ClaudeCliIdentity | undefined
): boolean {
  if (!a || !b) return false
  return a.size === b.size && a.modifiedMs === b.modifiedMs
}

/**
 * Scan MEMOISE sur l'identite du binaire. Indispensable : le rafraichisseur de catalogue re-interroge
 * les sources toutes les 60 s, et un scan mesure a ~300 ms sur un binaire de 265 Mo. On ne rescanne
 * donc qu'apres une mise a jour du CLI (taille ou date changee), ce qui est exactement le seul moment
 * ou la liste peut avoir bouge.
 */
let memo: { identity: ClaudeCliIdentity; path: string; ids: string[] } | undefined

export function claudeCliModelIds(binPath: string): string[] {
  const identity = claudeCliIdentity(binPath)
  if (!identity) return []
  if (memo && memo.path === binPath && sameClaudeCli(memo.identity, identity)) return memo.ids
  const ids = scanClaudeCliModelIds(binPath)
  memo = { identity, path: binPath, ids }
  return ids
}

/** Vide la memoisation — pour les tests, et pour un rescan force apres reinstallation du CLI. */
export function resetClaudeCliCatalogMemo(): void {
  memo = undefined
}

/**
 * Extrait les identifiants de modeles du binaire. PUR vis-a-vis du reste de l'app : ne rend que des
 * chaines, triees et dedoublonnees, sans jamais en inventer une. Rend `[]` sur toute erreur de lecture
 * — un binaire illisible ne doit pas empecher l'app de demarrer.
 */
export function scanClaudeCliModelIds(binPath: string): string[] {
  let fd: number | undefined
  try {
    fd = openSync(binPath, 'r')
    const found = new Set<string>()
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES)
    // `carry` = queue du bloc precedent, re-presentee devant le bloc suivant pour recoller un
    // identifiant coupe par la frontiere de lecture.
    let carry = ''
    let position = 0
    for (;;) {
      const read = readSync(fd, buffer, 0, CHUNK_BYTES, position)
      if (read <= 0) break
      position += read
      // `latin1` : on cherche de l'ASCII dans un binaire. Un decodage UTF-8 remplacerait les octets
      // invalides et pourrait donc DETRUIRE un identifiant adjacent a du binaire non-texte.
      const text = carry + buffer.toString('latin1', 0, read)
      for (const match of text.matchAll(/claude-[a-z0-9-]+/g)) {
        if (CLAUDE_MODEL_RE.test(match[0])) found.add(match[0])
      }
      carry = text.slice(-OVERLAP_BYTES)
      if (read < CHUNK_BYTES) break
    }
    return [...found].sort()
  } catch {
    return []
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* deja ferme */
      }
    }
  }
}
