import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Souveraineté sur les fichiers de contexte projet (décision : PLIER façon Hermes).
 *
 * Autowin — et non le CLI par-vendeur — est l'autorité sur le contexte injecté. On lit UNE
 * chaîne de précédence (premier-trouvé-gagne, JAMAIS empilé), on plie le fichier gagnant dans le
 * system prompt de chaque phase, puis on supprime l'auto-load du CLI (Codex `project_doc_max_bytes=0`)
 * → source UNIQUE, portable sur tous les modèles importés (c'est Autowin qui lit, pas le CLI).
 *
 * NB : en orchestration, le `system` explicite des phases porte déjà la discipline
 * (PIPELINE_DISCIPLINE_INSTRUCTION + SKILL.md + ENGINE ciblé) ; le kit-soul global du
 * ProviderRegistry n'est PAS réinjecté ici (il serait shadowé par ce `system` explicite,
 * cf. registry.ts) — décision assumée « sans overkill », les réflexes porteurs étant aussi
 * enforce par le GATE déterministe.
 *
 * Ordre calqué sur hermes-agent : `.hermes.md` (convention maison) → `AGENTS.md` (Codex/OpenAI) →
 * `CLAUDE.md` (Claude) → `.cursorrules` (Cursor). On accepte les variantes de casse usuelles.
 */
export const PROJECT_CONTEXT_CHAIN: string[] = [
  '.hermes.md',
  'HERMES.md',
  'AGENTS.md',
  'agents.md',
  'CLAUDE.md',
  'claude.md',
  '.cursorrules'
]

/** Plafond de lecture (garde-fou : un fichier de contexte géant ne doit pas noyer le system). */
export const PROJECT_CONTEXT_MAX_BYTES = 32_768

export interface ProjectContext {
  file: string
  content: string
}

/**
 * Résout le fichier de contexte projet du workspace selon la chaîne de précédence (premier gagne).
 * Rend `null` si aucun présent (cas courant). Lecture défensive : une source illisible est ignorée.
 */
export function loadProjectContext(
  workspace: string,
  chain: string[] = PROJECT_CONTEXT_CHAIN,
  maxBytes: number = PROJECT_CONTEXT_MAX_BYTES
): ProjectContext | null {
  for (const file of chain) {
    const path = join(workspace, file)
    try {
      if (!existsSync(path) || !statSync(path).isFile()) continue
      // Mesure en BYTES réels (pas raw.length = unités UTF-16) : un doc FR accentué a 1 char ≈ 2 bytes,
      // donc raw.length sous-estimerait la taille et le plafond serait silencieusement contourné.
      const buf = readFileSync(path)
      let content: string
      if (buf.byteLength > maxBytes) {
        // Décodage non-fatal du préfixe : un caractère multi-byte coupé en fin devient U+FFFD, qu'on retire
        // → jamais de surrogate isolé / octet partiel injecté dans le system prompt.
        const head = new TextDecoder('utf-8').decode(buf.subarray(0, maxBytes)).replace(/�+$/, '')
        content = `${head}\n…[tronqué]`
      } else {
        content = buf.toString('utf8')
      }
      if (content.trim().length === 0) continue
      return { file, content }
    } catch {
      // source illisible (partage hors ligne, permission) → on passe au suivant
      continue
    }
  }
  return null
}

/**
 * Bloc à plier dans le system prompt (vide si aucun fichier). Étiqueté par le fichier gagnant pour
 * la traçabilité (le juge/observabilité voit d'où vient le contexte). Jamais plus d'un fichier.
 */
export function projectContextBlock(
  workspace: string,
  chain: string[] = PROJECT_CONTEXT_CHAIN,
  maxBytes: number = PROJECT_CONTEXT_MAX_BYTES
): string {
  const ctx = loadProjectContext(workspace, chain, maxBytes)
  if (!ctx) return ''
  return `\n=== CONTEXTE PROJET (${ctx.file}) ===\n${ctx.content}\n`
}
