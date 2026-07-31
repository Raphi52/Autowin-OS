/**
 * PORTÉE DU BRAIN, DÉRIVÉE DU WORKSPACE (option O3 du cadrage `rag-brain-pertinence`).
 *
 * MESURE qui justifie ce module (index vivant du Brain, 2026-07-29) : 15 342 chunks, dont **99 %** de
 * `knowledge/domain/rigapplication-documentation` et **0,19 %** sur Autowin OS (4 documents). Une
 * question Autowin (« le bouton fork dans le chat ») ramenait donc 2 sources RIG sur 3 — appariement sur
 * le mot « bouton ». Ce n'est PAS un défaut de classement : c'est le résultat attendu d'un corpus à
 * 99 % consacré à un autre projet.
 *
 * Ce que ce module fait : restreindre les sources retenues au corpus du WORKSPACE courant. Ce qu'il ne
 * fait PAS : prétendre enrichir le Brain. Filtrer ne crée pas de connaissance — pour Autowin, la
 * connaissance vit dans le graphe de code (déjà scopé) et dans le contexte projet ; le Brain n'apporte
 * que 4 documents, qui restent atteignables.
 *
 * PRINCIPE DE PRUDENCE : un workspace SANS corpus déclaré n'est PAS filtré. On ne coupe que là où on
 * sait quoi garder — sinon on remplacerait du bruit par du vide, ce qui se déguiserait en progrès.
 */
import { basename } from 'node:path'

/** Séparateur entre deux sources dans le bloc rendu par le Brain (`brain_context.py:128`). */
const SOURCE_SEPARATOR = '\n\n---\n\n'
/** En-tête d'une source : `### Source N — <chemin>`. */
const SOURCE_HEADER = /^### Source \d+ — (.+)$/m

/**
 * Corpus Brain par workspace, indexé par SLUG de dossier. Les valeurs sont des fragments cherchés dans
 * le CHEMIN de la source — pas dans le champ `scope`, qui est vide sur 98 % des chunks et ferait donc
 * tout écarter par simple absence de métadonnée.
 *
 * Table EXPLICITE et non devinée : le slug d'un dossier ne dit pas le nom de son corpus
 * (« Code RIG » → la doc s'appelle `rigapplication-documentation`). Un workspace absent de cette table
 * n'est pas filtré.
 */
const WORKSPACE_BRAIN_CORPUS: Readonly<Record<string, readonly string[]>> = {
  'autowin-os': ['autowin-os', 'autowin'],
  'code-rig': ['rigapplication-documentation', 'rig-'],
  rig: ['rigapplication-documentation', 'rig-']
}

/** Slug comparable d'un chemin de workspace : dernier segment, minuscules, espaces en tirets. */
export function workspaceSlug(workspacePath: string): string {
  const name = basename(workspacePath.replace(/[\\/]+$/, ''))
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

/**
 * Fragments de chemin autorisés pour ce workspace, ou `undefined` si aucun corpus n'est déclaré
 * (→ AUCUN filtrage, comportement historique).
 *
 * Échappatoire opérateur : `AUTOWIN_BRAIN_CORPUS` (fragments séparés par des virgules) surclasse la
 * table ; la valeur `*` désactive explicitement le filtrage.
 */
export function brainCorpusForWorkspace(
  workspacePath: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): readonly string[] | undefined {
  const override = env.AUTOWIN_BRAIN_CORPUS?.trim()
  if (override === '*') return undefined
  if (override) {
    const fragments = override
      .split(',')
      .map((fragment) => fragment.trim().toLowerCase())
      .filter(Boolean)
    return fragments.length > 0 ? fragments : undefined
  }
  if (!workspacePath) return undefined
  return WORKSPACE_BRAIN_CORPUS[workspaceSlug(workspacePath)]
}

/** Une source appartient-elle au corpus ? Comparaison sur le chemin, insensible à la casse. */
function sourceAllowed(section: string, fragments: readonly string[]): boolean {
  const header = SOURCE_HEADER.exec(section)
  // Un fragment SANS en-tête reconnaissable est conservé : c'est le préambule (signature + consigne
  // anti-injection), pas une source. Le jeter romprait le contrat de confiance du bloc.
  if (!header) return true
  const path = header[1].toLowerCase()
  return fragments.some((fragment) => path.includes(fragment))
}

/** Même règle que le filtrage du bloc, appliquée à un chemin de navigation observé. */
export function brainSourcePathAllowed(
  path: string,
  fragments: readonly string[] | undefined
): boolean {
  if (!fragments || fragments.length === 0) return true
  const normalized = path.toLowerCase()
  return fragments.some((fragment) => normalized.includes(fragment))
}

export interface BrainScopeResult {
  /** Bloc filtré, prêt à injecter. Vide si aucune source du corpus n'a survécu. */
  block: string
  /** Nombre de sources écartées — à journaliser : un filtrage silencieux est indéfendable. */
  dropped: number
  /** Nombre de sources conservées. */
  kept: number
}

/**
 * Restreint un bloc Brain aux sources du corpus. Rend le bloc INTACT si aucun corpus n'est déclaré.
 *
 * Si plus aucune source ne survit, le bloc rendu est VIDE : mieux vaut n'injecter rien que le préambule
 * seul, qui coûterait des tokens en n'annonçant aucune connaissance.
 */
export function scopeBrainBlock(
  block: string,
  fragments: readonly string[] | undefined
): BrainScopeResult {
  if (!block.trim()) return { block: '', dropped: 0, kept: 0 }
  if (!fragments || fragments.length === 0) {
    const total = block.split(SOURCE_SEPARATOR).filter((part) => SOURCE_HEADER.test(part)).length
    return { block, dropped: 0, kept: total }
  }
  const parts = block.split(SOURCE_SEPARATOR)
  const kept: string[] = []
  let dropped = 0
  let keptSources = 0
  for (const part of parts) {
    const isSource = SOURCE_HEADER.test(part)
    if (!isSource) {
      kept.push(part)
      continue
    }
    if (sourceAllowed(part, fragments)) {
      kept.push(part)
      keptSources += 1
    } else {
      dropped += 1
    }
  }
  // Aucune source retenue → rien a injecter (le preambule seul ne porte aucune connaissance).
  if (keptSources === 0) return { block: '', dropped, kept: 0 }
  return { block: kept.join(SOURCE_SEPARATOR), dropped, kept: keptSources }
}
