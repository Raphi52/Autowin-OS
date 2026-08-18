import type { PipelinePhase } from './skill-pipeline'

export interface SkillRoute {
  task: string
  explicitPhase?: PipelinePhase
  reason: 'explicit-skill' | 'workspace-action'
}

const PHASE_COMMAND = /^\/(scout|frame|terrain|build|clean|judge|kaizen)(?=\s|$)(?:\s+([\s\S]*))?$/i
const WORKSPACE_TARGET =
  /(?<![\p{L}\p{N}_])(?:code|repo|d[eé]p[oô]t|fichier|classe|fonction|module|tests?|bug|ui|interface|page|vue|bouton|modal(?:e)?|barre|ic[oô]ne|css|style|workflow|skill|pipeline|worktree|git|application|app|observatory|chat|provider|model|mod[eè]le|feature|message|texte|liste|contenu|[eé]cran|conversation|[eé]tat|api)(?![\p{L}\p{N}_])|[\w.-]+\.(?:json|md|tsx?|jsx?|css|scss|html|ya?ml|toml)\b/iu
/**
 * Verbes qui declenchent une ORCHESTRATION sans passer par le modele (court-circuit deterministe).
 *
 * Retires le 2026-07-28 : `scout`, `analyse`, `audite` — et EUX SEULS. Constate en
 * essai reel — sur « Scout LECTURE SEULE dans src/main/ », l'agent lançait un pipeline (qui echouait)
 * SANS que le modele soit consulte : ce routage court-circuite `chat()` en amont, donc AUCUNE regle
 * de prompt ne pouvait le corriger (deux tentatives infructueuses avant d'identifier la cause ici).
 *
 * Ces trois verbes designent une ANALYSE PURE. Depuis que le chat dispose de Read/Grep/Glob et de
 * `verify`, analyser ne demande plus de pipeline : l'agent le fait lui-meme, pour une fraction du
 * cout.
 *
 * `teste`, `verifie` et `documente` ont ete CONSERVES apres verification : un test existant rappelle
 * que « Documente l'API dans README.md » ECRIT un fichier — c'est une modification, pas une lecture.
 * Idem pour ecrire des tests. Une premiere passe les avait retires a tort.
 */
const ACTION_VERB =
  '(?:corrig(?:e|er|ez)|fix(?:e|er)?|ajout(?:e|er|ez)|modifi(?:e|er|ez)|impl[eé]ment(?:e|er|ez)|cr[eé](?:e|er|ez)|supprim(?:e|er|ez)|retir(?:e|er|ez)|enl[eè]v(?:e|er|ez)|remplac(?:e|er|ez)|chang(?:e|er|ez)|ferm(?:e|er|ez)|ouvr(?:e|ir|ez)|d[eé]cal(?:e|er|ez)|actualis(?:e|er|ez)|affich(?:e|er|ez)|refactor(?:e|er|ez)?|renomm(?:e|er|ez)|d[eé]plac(?:e|er|ez)|int[eè]gr(?:e|er|ez)|branche|connecte|r[eé]pare|refonte|refais|rends?|mets?|mettre|fais|faire|teste|v[eé]rifie|lance|documente)'
const DIRECT_ACTION = new RegExp(`^\\s*${ACTION_VERB}\\b`, 'i')
const POLITE_ACTION = new RegExp(
  `^\\s*(?:peux-tu|est-ce que tu peux|tu peux)\\s+${ACTION_VERB}\\b`,
  'i'
)
const OBLIGATION_ACTION = new RegExp(
  `^\\s*(?:il faut|faut|ça doit|ca doit)\\s+(?:(?:la|le|les|l')\\s*)?${ACTION_VERB}\\b`,
  'i'
)
const IMPLIED_DEFECT =
  /\b(d[eé]passe(?:nt)?|ne (?:marche|fonctionne) pas|reste sticky|se remet|est cass[eé]e?|manque)\b/i
const EXPLANATION_REQUEST =
  /^\s*(?:explique|je (?:voudrais|veux|souhaite) comprendre|aide-moi [àa] comprendre|dis-moi comment|montre-moi comment|comment\b|pourquoi\b|pk\b)/i
const QUESTION_PREFIX =
  /^\s*(?:est-ce que|quel(?:le)?s?\b|(?:ou|où)(?:\s|$)|qui\b|quoi\b|quand\b|combien\b)/i

function isActionClause(text: string): boolean {
  return DIRECT_ACTION.test(text) || POLITE_ACTION.test(text) || OBLIGATION_ACTION.test(text)
}

/** Route les demandes d'action claires, sans transformer une question en orchestration coûteuse. */
export function routeSkillRequest(message: string): SkillRoute | undefined {
  const text = message.trim()
  if (!text) return undefined

  const explicit = PHASE_COMMAND.exec(text)
  if (explicit) {
    const phase = explicit[1].toLowerCase() as PipelinePhase
    const body = explicit[2]?.trim()
    return {
      task: body ? `/${phase} ${body}` : `/${phase}`,
      explicitPhase: phase,
      reason: 'explicit-skill'
    }
  }

  // « scout » NU en tete de message nomme la phase, comme `/scout` le fait avec le slash.
  //
  // Defaut vecu le 2026-08-18 (conv-1297) : « scout des ameliorations de l'experience utilisateur » a
  // produit un rapport de BUILD — trois lignes « Implemente » au lieu d'une shortlist. Seule la forme
  // avec slash etait routee ; le mot nu partait au modele, qui a choisi build.
  //
  // Le mot avait ete retire du court-circuit le 2026-07-28 (voir ACTION_VERB ci-dessus), mais pour une
  // AUTRE raison : il declenchait alors une ORCHESTRATION MUTANTE sans consulter le modele. Ici il
  // designe une phase READ-ONLY explicitement demandee. Un faux positif coute une shortlist, pas une
  // ecriture — c'est ce qui rend la regle acceptable la ou l'ancienne ne l'etait pas.
  //
  // Ancree en TETE et bornee par une frontiere de mot : « le scout est pas score » et « scouting »
  // ne declenchent rien. Une question ne declenche rien non plus — le bloc ci-dessous la traite avant.
  const scoutNu = /^scout(?=\s|$)([\s\S]*)$/i.exec(text)
  if (scoutNu && !text.includes('?')) {
    return { task: text, explicitPhase: 'scout', reason: 'explicit-skill' }
  }

  const target = WORKSPACE_TARGET.test(text) || /^corriger[.!]?$/.test(text)
  const questionEnd = text.indexOf('?')
  if (questionEnd >= 0) {
    const actionAfterQuestion = text.slice(questionEnd + 1).trim()
    if (actionAfterQuestion && isActionClause(actionAfterQuestion) && target) {
      return { task: text, reason: 'workspace-action' }
    }
    if ((DIRECT_ACTION.test(text) || POLITE_ACTION.test(text)) && target) {
      return { task: text, reason: 'workspace-action' }
    }
    return undefined
  }
  if (EXPLANATION_REQUEST.test(text)) return undefined
  if (POLITE_ACTION.test(text) && target) {
    return { task: text, reason: 'workspace-action' }
  }
  if (QUESTION_PREFIX.test(text)) {
    if (/^\s*quand\b/i.test(text)) {
      const clauseEnd = text.search(/[,;]/)
      const obligation = text.search(/\b(?:ça doit|ca doit)\b/i)
      const suffix =
        clauseEnd >= 0
          ? text.slice(clauseEnd + 1).trim()
          : obligation >= 0
            ? text.slice(obligation).trim()
            : ''
      if (suffix && isActionClause(suffix) && target) {
        return { task: text, reason: 'workspace-action' }
      }
    }
    return undefined
  }
  const actionable = isActionClause(text) || IMPLIED_DEFECT.test(text)
  if (actionable && target) {
    return { task: text, reason: 'workspace-action' }
  }
  return undefined
}
