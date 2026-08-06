import { graphDefects, worstCaseNodeExecutions, type WorkflowGraph } from './workflow-graph'
import { estInvocable, type WorkflowProfile } from './workflow-profiles'

/**
 * Choisir le workflow adapté à la situation — ou n'en choisir AUCUN.
 *
 * Le mode dynamique existe pour que l'utilisateur n'ait pas à deviner, avant d'écrire sa demande,
 * quelle façon de travailler elle appellera. Il ne doit surtout pas devenir une contrainte de plus :
 * « aucun » est une réponse de PLEIN DROIT, et c'est même la bonne la plupart du temps.
 *
 * Toute la décision est ici, PURE : on la teste sans provider, sans horloge et sans Electron. Le
 * reste (l'appel de modèle) n'est qu'un transport.
 */

/**
 * Plafond du pire cas pour un graphe INVENTÉ par le modèle.
 *
 * Un modèle peut proposer un graphe à cinquante exécutions sans percevoir ce qu'il engage. Le devis
 * est précisément ce que tout ce module protège : au-delà de ce plafond on refuse, plutôt que de
 * découvrir le coût une fois le run lancé. Volontairement plus bas que ce qu'un humain peut composer
 * à la main — celui-là voit son pire cas affiché à l'écran avant d'enregistrer.
 */
export const PLAFOND_GRAPHE_INVENTE = 12

export type WorkflowDecision =
  | { kind: 'existing'; profile: WorkflowProfile }
  | { kind: 'new'; graph: WorkflowGraph; name: string }
  | { kind: 'none'; reason?: string }

/**
 * Faut-il seulement POSER la question ?
 *
 * Interroger un modèle pour apprendre qu'une demande de trois mots ne mérite aucun pipeline coûte un
 * appel et une latence pour un résultat connu d'avance. Le filtre est volontairement grossier : il
 * n'écarte que l'évident, et laisse le modèle trancher tout le reste.
 */
export function meriteUneDecision(task: string): boolean {
  const propre = task.trim()
  if (propre.length < 40) return false
  // Une question pure appelle une réponse, pas un pipeline.
  if (/^(qu(i|e|el|elle|oi)|comment|pourquoi|où|quand|combien)\b/i.test(propre) && propre.endsWith('?')) {
    return false
  }
  return true
}

/**
 * Le catalogue tel qu'on le montre au modèle : ce que chacun FAIT, pas sa structure interne.
 *
 * Les workflows désactivés en sont ABSENTS. Les montrer en demandant au modèle de ne pas les choisir
 * serait une consigne, donc une chose qu'il peut manquer ; ne pas les écrire est une garantie. Le
 * filtre est doublé côté `decide()` pour un modèle qui nommerait un id qu'on ne lui a pas donné.
 */
export function catalogueBrief(profiles: WorkflowProfile[]): string {
  const invocables = profiles.filter(estInvocable)
  if (!invocables.length) return '(aucun workflow enregistré)'
  return invocables
    .map((p) => {
      const noeuds = p.graph?.nodes.map((n) => n.phase).join(' → ') ?? p.phases?.join(' → ') ?? '—'
      return `- ${p.id} « ${p.name} » : ${p.description ?? 'sans description'} [${noeuds}]`
    })
    .join('\n')
}

/**
 * La question posée au modèle. Elle insiste sur le droit de répondre « aucun » : sans cela un modèle
 * serviable en choisit toujours un, et le mode dynamique redevient exactement la laisse qu'on veut
 * éviter.
 */
export function dynamicPrompt(task: string, profiles: WorkflowProfile[]): string {
  return `Tu choisis la façon de travailler la mieux adaptée à une demande. Tu n'exécutes pas la demande.

WORKFLOWS DISPONIBLES
${catalogueBrief(profiles)}

DEMANDE
${task}

Réponds par UNE SEULE ligne, rien d'autre :
  WORKFLOW: <id>        pour reprendre un workflow existant
  WORKFLOW: aucun       si la demande ne justifie pas de pipeline, ou si aucun ne convient vraiment
  WORKFLOW: nouveau     puis, à la ligne, un objet JSON {"name": "...", "graph": {...}}

« aucun » est une réponse NORMALE et souvent la bonne : une demande simple, une question, une
correction évidente ne méritent aucun workflow. N'en choisis un que s'il fait gagner quelque chose.
Ne crée un nouveau workflow que si aucun existant n'approche du besoin — un graphe inventé coûte
plus cher à relire qu'un graphe connu.

Format d'un graphe : {"entry":"<id du 1er nœud>","nodes":[{"id":"frame-1","phase":"frame"}],
"edges":[{"from":"frame-1","to":"build-1","when":"always"}]}. Phases possibles : scout, frame,
terrain, build, clean, judge, remake. Toute arête de RETOUR (vers un nœud déjà passé) DOIT porter
"maxTraversals": <1-10>.`
}

/**
 * Le verdict du modèle sur un graphe qu'il a inventé.
 *
 * Deux refus, et ils ne se valent pas : un graphe INVALIDE ne peut pas tourner (le moteur le
 * refuserait de toute façon), un graphe TROP COÛTEUX tournerait très bien — c'est justement le
 * danger. Dans les deux cas on retombe sur « aucun workflow », jamais sur un graphe dégradé.
 */
export function acceptProposedGraph(
  graph: WorkflowGraph
): { ok: true } | { ok: false; reason: string } {
  const defauts = graphDefects(graph)
  if (defauts.length) return { ok: false, reason: `graphe invalide : ${defauts[0].message}` }
  const pire = worstCaseNodeExecutions(graph)
  if (pire > PLAFOND_GRAPHE_INVENTE) {
    return { ok: false, reason: `pire cas ${pire} > plafond ${PLAFOND_GRAPHE_INVENTE}` }
  }
  return { ok: true }
}

/**
 * Lit la réponse du modèle. TOUT ce qui n'est pas compris rend « aucun » : devant une réponse
 * ambiguë, ne rien piloter est le repli sûr — c'est le comportement d'avant le mode dynamique.
 */
export function readWorkflowDecision(
  text: string,
  profiles: WorkflowProfile[]
): WorkflowDecision {
  const ligne = text.split('\n').find((l) => /^\s*WORKFLOW\s*:/i.test(l))
  if (!ligne) return { kind: 'none', reason: 'aucune décision lisible' }
  const valeur = ligne.replace(/^\s*WORKFLOW\s*:/i, '').trim()

  if (!valeur || /^(aucun|none|rien)$/i.test(valeur)) return { kind: 'none' }

  if (/^nouveau$/i.test(valeur)) {
    const json = extraireJson(text)
    if (!json) return { kind: 'none', reason: 'graphe annoncé mais illisible' }
    const propose = json as { name?: unknown; graph?: unknown }
    const graph = propose.graph as WorkflowGraph | undefined
    if (!graph?.nodes?.length) return { kind: 'none', reason: 'graphe vide' }
    const verdict = acceptProposedGraph(graph)
    if (!verdict.ok) return { kind: 'none', reason: verdict.reason }
    const name = typeof propose.name === 'string' && propose.name.trim() ? propose.name.trim() : 'Composé à la volée'
    return { kind: 'new', graph, name }
  }

  // Deuxième barrière du drapeau `enabled` : le catalogue ne montre déjà que les invocables, mais un
  // modèle peut nommer un id qu'il a vu ailleurs (un run précédent, la demande de l'utilisateur).
  // Désactiver doit EMPÊCHER, pas seulement s'abstenir de suggérer.
  const trouve = profiles.filter(estInvocable).find((p) => p.id === valeur)
  if (!trouve && profiles.some((p) => p.id === valeur)) {
    return { kind: 'none', reason: `workflow désactivé : ${valeur}` }
  }
  // Un id inconnu n'est pas un incident : le modèle a pu inventer un nom. On ne pilote rien plutôt
  // que de choisir un workflow au hasard parce qu'il ressemblait.
  return trouve ? { kind: 'existing', profile: trouve } : { kind: 'none', reason: `id inconnu : ${valeur}` }
}

/** Extrait le premier objet JSON équilibré du texte — un modèle encadre souvent son JSON de prose. */
function extraireJson(text: string): unknown {
  const debut = text.indexOf('{')
  if (debut < 0) return undefined
  let profondeur = 0
  for (let i = debut; i < text.length; i++) {
    if (text[i] === '{') profondeur++
    else if (text[i] === '}') {
      profondeur--
      if (profondeur === 0) {
        try {
          return JSON.parse(text.slice(debut, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}
