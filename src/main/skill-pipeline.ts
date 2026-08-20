import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { listNativeRegistry, skillRoots } from './native-registry'

/**
 * Charge le TEXTE des skills du kit (`~/.claude/skills/<phase>/SKILL.md` + `_engine/ENGINE.md`)
 * au runtime, pour que l'orchestration in-app joue la vraie pipeline du user — quel que soit le
 * PROVIDER (le texte est injecté en system prompt de chaque phase). Si le kit est absent (app
 * packagée chez un autre), chaque loader renvoie '' → l'orchestration retombe sur la discipline
 * condensée intégrée (pipeline-discipline.ts). Aucune dépendance dure au home du dev.
 */
/**
 * RE-EXPORTÉ depuis `shared/pipeline-phases`, plus déclaré ici.
 *
 * Cette liste existait en DOUBLE : ici (huit phases) et dans `workflow-executability.ts` côté
 * renderer (sept, sans `remake`). La copie périmée faisait afficher à l'onglet Workflows un badge
 * d'anomalie sur un profil parfaitement jouable — celui-là même que `workflow-defaults.ts` livre par
 * défaut. Le renderer ne peut pas importer depuis `main/`, d'où le déplacement vers `shared/`, seul
 * endroit visible des deux côtés de la frontière Electron.
 *
 * Le re-export garde les ~10 appelants de `./skill-pipeline` inchangés.
 */
// Un `export … from` ne met PAS les noms dans la portée locale : ce fichier utilise `PipelinePhase`
// dans ses propres signatures, d'où l'import en plus du re-export.
import { type PipelinePhase } from '../shared/pipeline-phases'

export {
  PIPELINE_PHASES,
  isPipelinePhase,
  isSkillNode,
  type PipelinePhase,
  type NodePhase
} from '../shared/pipeline-phases'

export function skillsRoot(root = join(homedir(), '.claude', 'skills')): string {
  return root
}

function readIfExists(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}

/** Texte brut du SKILL.md d'une phase (vide si absent). */
export function loadSkillText(phase: PipelinePhase, root = skillsRoot()): string {
  return readIfExists(join(root, phase, 'SKILL.md'))
}

/** Texte de `_engine/ENGINE.md` (mécanique partagée ; vide si absent). */
export function loadEngineText(root = skillsRoot()): string {
  return readIfExists(join(root, '_engine', 'ENGINE.md'))
}

/**
 * Skill invoquée EN TÊTE d'un message (`/remake …`), sinon undefined.
 *
 * En tête seulement : une mention au fil du texte (« regarde /remake quand tu peux ») n'est pas une
 * invocation, et l'injecter ferait payer un corps de skill à chaque fois qu'on en parle.
 */
export function invokedSkillId(message: string): string | undefined {
  return /^\s*\/([a-z][a-z0-9-]*)\b/i.exec(message ?? '')?.[1]?.toLowerCase()
}

/**
 * Corps injectable d'une skill DÉSIGNÉE PAR SON NOM, phase du pipeline ou non.
 *
 * `phaseInstruction` ne sait servir que les 7 `PipelinePhase` : c'est ce qui rendait `/remake`
 * inatteignable alors que l'entrée slash existait — le renderer promettait un contrat que le main ne
 * chargeait jamais. « Être une phase du pipeline » et « avoir un corps injectable » sont deux
 * propriétés distinctes ; les confondre a produit une étiquette qui mentait. Vide si introuvable :
 * une skill inconnue ne jette pas, elle n'ajoute simplement rien.
 */
/**
 * Forme admise d'un identifiant de skill. C'est un NOM DE DOSSIER, rien d'autre.
 *
 * Ce module `join()` l'identifiant dans un chemin. Tant que seuls les huit `PipelinePhase` et
 * `invokedSkillId` (deja borne par sa propre regex) l'atteignaient, la question ne se posait pas.
 * Depuis qu'un NOEUD DE GRAPHE peut porter un identifiant libre, elle se pose : `normalizeGraph`
 * accepte `value.nodes` TEL QUEL, donc un profil de workflow IMPORTE peut porter
 * `phase: "../../../ailleurs"`. Verifie par sonde : le corps d'un `SKILL.md` situe hors de toute
 * racine etait lu et INJECTE dans le prompt systeme d'un agent.
 *
 * On borne donc ici, au seul endroit qui construit le chemin — pas chez les appelants, qui
 * grandiront et en oublieront un.
 */
const ID_SKILL_VALIDE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export function skillInstruction(id: string, roots = skillRoots()): string {
  if (!ID_SKILL_VALIDE.test(id)) return ''
  const root = roots.find((candidate) => readIfExists(join(candidate, id, 'SKILL.md')).length > 0)
  if (!root) return ''
  const body = stripSkillFrontmatter(readIfExists(join(root, id, 'SKILL.md')))
  return body ? `\n=== SKILL ${id.toUpperCase()} (kit) ===\n${body}\n` : ''
}

/**
 * Retire la frontmatter YAML (`---\n…\n---`) d'un SKILL.md. Ce bloc (`name:` + le long
 * `description:` d'heuristiques "Trigger on… / Do NOT use to…") sert au SÉLECTEUR de skill de
 * Claude Code, PAS à un sous-agent qui exécute déjà la phase imposée : l'injecter est du bruit
 * (tokens gaspillés + risque de confusion). On ne garde que le CORPS (les vraies instructions).
 */
export function stripSkillFrontmatter(text: string): string {
  const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return m ? text.slice(m[0].length).replace(/^\s+/, '') : text
}

/**
 * Chapitre d'ENGINE.md pertinent par phase (le doc lui-même annote « used during <phase> »).
 * Injecter ENGINE.md ENTIER (22 k chars) à chaque phase serait l'overkill qu'on combat : on ne
 * fournit que la FONDATION (les 7 concepts « keep in mind ») + le seul chapitre de la phase.
 */
const PHASE_ENGINE_CHAPTER: Record<PipelinePhase, 'Ch.1' | 'Ch.2' | 'Ch.3' | 'Ch.4' | null> = {
  scout: 'Ch.1',
  frame: 'Ch.1',
  terrain: 'Ch.3',
  build: 'Ch.4',
  clean: 'Ch.4',
  judge: 'Ch.2',
  kaizen: null,
  // `remake` PILOTE le pipeline (scout → frame → build → clean → judge) au lieu d'en occuper un
  // chapitre : aucune mécanique du moteur ne lui appartient en propre.
  remake: null
}

function engineSection(full: string, headingPattern: string, stop: string): string {
  return new RegExp(`${headingPattern}[\\s\\S]*?(?=${stop})`).exec(full)?.[0].trim() ?? ''
}

/**
 * Mécanique ENGINE ciblée pour une phase : FONDATION (toujours) + chapitre de la phase.
 * Les SKILL.md renvoient à `_engine/ENGINE.md` comme mécanique canonique ; sans ça le sous-agent
 * lit des références vers un fichier qu'il n'a pas. Ciblé pour rester sous ~2 k tokens/phase.
 */
export function engineForPhase(
  phase: PipelinePhase,
  root = skillsRoot(),
  withFoundation = true
): string {
  const full = loadEngineText(root)
  if (!full) return ''
  // La FONDATION (7 concepts) est identique à chaque phase → réinjectée 5× sur un run = gaspillage.
  // `withFoundation=false` la coupe : l'orchestrateur ne la fournit qu'à la 1ʳᵉ phase (1×/run).
  const foundation = withFoundation
    ? engineSection(full, '## ⚡ THE FOUNDATION', '\\n# REFERENCE')
    : ''
  const chap = PHASE_ENGINE_CHAPTER[phase]
  const chapter = chap
    ? engineSection(
        full,
        `## ${chap.replace('.', '\\.')}`,
        '\\n## (?:Ch\\.\\d|Telemetry|Roadmap)|$'
      )
    : ''
  const body = [foundation, chapter].filter(Boolean).join('\n\n')
  return body ? `\n=== ENGINE (mécanique partagée du kit) ===\n${body}\n` : ''
}

/**
 * Instruction system prompt pour une phase = CORPS du SKILL.md (sans frontmatter de routing)
 * + la mécanique ENGINE ciblée (fondation + chapitre de la phase).
 */
export function phaseInstruction(
  phase: PipelinePhase,
  root?: string,
  opts: { withFoundation?: boolean } = {}
): string {
  if (root) return phaseInstructionFromRoots(phase, [root], () => true, opts)
  const enabled = (id: PipelinePhase): boolean =>
    listNativeRegistry('skills').find((item) => item.id === id)?.enabled !== false
  return phaseInstructionFromRoots(phase, skillRoots(), enabled, opts)
}

/** Sélectionne la première racine qui contient la phase, en respectant son verrou d'activation. */
export function phaseInstructionFromRoots(
  phase: PipelinePhase,
  roots: string[],
  isEnabled: (id: PipelinePhase) => boolean = () => true,
  opts: { withFoundation?: boolean } = {}
): string {
  // Kaizen est un workflow NATIF Autowin : aucun fichier ~/.claude n'est lu ou injecté.
  // Son contrat purpose-built vit dans phase-briefs.ts et sa preuve dans autowin-kaizen-context.ts.
  if (phase === 'kaizen' || !isEnabled(phase)) return ''
  // Défaut true : un appel ISOLÉ (chat, phase unique) garde la fondation. L'orchestrateur multi-phases
  // passe false sur les phases ≥2 pour n'injecter la fondation qu'UNE fois par run.
  const withFoundation = opts.withFoundation ?? true
  const root = roots.find((candidate) => loadSkillText(phase, candidate).length > 0)
  if (!root) return ''
  const body = stripSkillFrontmatter(loadSkillText(phase, root))
  if (!body) return ''
  const skill = `\n=== SKILL ${phase.toUpperCase()} (kit) ===\n${body}\n`
  // A/B LEAN (env AUTOWIN_LEAN_INJECT=1) : corps du skill SEUL, sans la mécanique ENGINE.
  if (process.env.AUTOWIN_LEAN_INJECT === '1') return skill
  return skill + engineForPhase(phase, root, withFoundation)
}
