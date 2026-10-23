import { graphDefects, worstCaseNodeExecutions, type WorkflowGraph } from './workflow-graph'
import { demandeEstUnSymptome } from './option-lecture-ou-solution'
import { estInvocable, workflowProfileIssues, type WorkflowProfile } from './workflow-profiles'

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
  /** Mode `choisir` : le petit modèle juge qu'il faut un graphe neuf ; un autre le COMPOSERA. */
  | { kind: 'a-composer' }
  | { kind: 'none'; reason?: string }

/**
 * QUI FAIT QUOI DANS LA DÉCISION (conv-1097, 2026-10-22).
 *
 * La décision part sur le modèle des PETITES TÂCHES (Haiku par défaut, `roles.ts`), réservé aux
 * appels à réponse unique. Or « WORKFLOW: nouveau » suivi d'un graphe JSON n'est pas un choix :
 * c'est de la génération, et les garde-fous de `acceptProposedGraph` bornent son COÛT, pas sa
 * pertinence. D'où deux modes :
 * - `choisir` (petit modèle) : un id, « aucun » ou « nouveau » — une ligne, rien d'autre ; un JSON
 *   joint est ignoré, jamais exécuté ;
 * - `composer` (modèle du chat) : seulement quand le petit modèle a répondu « nouveau ».
 */
export type ModeDecision = 'choisir' | 'composer'

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
  // fix-ok: la regex exigeait un « ? » final ; « c'est quoi la meilleure option… » sans « ? » passait (test rouge 1/22 dans workflow-dynamic.test.ts).
  // Le « ? » final est souvent omis (« c'est quoi la meilleure option ») : une phrase interrogative
  // UNIQUE compte comme question ; une ponctuation interne signale une consigne qui suit.
  const interrogative =
    /^(qu(i|e|el|els|elle|elles|oi)|comment|pourquoi|où|quand|combien|c'est quoi|est-ce que)(?![\p{L}\d])/iu
  const phraseUnique = !/[.!:;\n]/.test(propre.replace(/[?.!\s]+$/, ''))
  if (interrogative.test(propre) && (propre.endsWith('?') || phraseUnique)) {
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
export function dynamicPrompt(
  task: string,
  profiles: WorkflowProfile[],
  mode: ModeDecision = 'composer'
): string {
  const entete = `Tu choisis la façon de travailler la mieux adaptée à une demande. Tu n'exécutes pas la demande.

WORKFLOWS DISPONIBLES
${catalogueBrief(profiles)}

DEMANDE
${task}
`
  if (mode === 'choisir') {
    return `${entete}
Réponds par UNE SEULE ligne, rien d'autre :
  WORKFLOW: <id>        pour reprendre un workflow existant
  WORKFLOW: aucun       si la demande ne justifie pas de pipeline, ou si aucun ne convient vraiment
  WORKFLOW: nouveau     si aucun existant n'approche du besoin (tu n'écris PAS le workflow)

« aucun » est une réponse NORMALE et souvent la bonne : une demande simple, une question, une
correction évidente ne méritent aucun workflow. N'en choisis un que s'il fait gagner quelque chose.
« nouveau » est rare : un workflow inventé coûte plus cher à relire qu'un workflow connu.`
  }
  return `${entete}
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
build, clean, judge, remake. Toute arête de RETOUR (vers un nœud déjà passé) DOIT porter
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
  // Un graphe INVENTÉ n'est jamais une demande de l'utilisateur, et `terrain` ne se joue que sur sa
  // demande depuis le 2026-10-15 (constitution, « Le pipeline »). Refus déterministe : la consigne
  // seule laisserait le modèle le remettre. Une demande explicite reste servie par le routage.
  if (graph.nodes.some((node) => node.phase === 'terrain')) {
    return { ok: false, reason: 'terrain ne se joue que si l’utilisateur le demande' }
  }
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
  profiles: WorkflowProfile[],
  mode: ModeDecision = 'composer'
): WorkflowDecision {
  const ligne = text.split('\n').find((l) => /^\s*WORKFLOW\s*:/i.test(l))
  if (!ligne) return { kind: 'none', reason: 'aucune décision lisible' }
  const valeur = ligne.replace(/^\s*WORKFLOW\s*:/i, '').trim()

  if (!valeur || /^(aucun|none|rien)$/i.test(valeur)) return { kind: 'none' }

  // Le petit modèle CHOISIT : un graphe qu'il joindrait quand même n'est ni lu ni exécuté.
  if (mode === 'choisir' && /^nouveau$/i.test(valeur)) return { kind: 'a-composer' }

  if (/^nouveau$/i.test(valeur)) {
    const json = extraireJson(text)
    if (!json) return { kind: 'none', reason: 'graphe annoncé mais illisible' }
    const propose = json as { name?: unknown; graph?: unknown }
    const graph = propose.graph as WorkflowGraph | undefined
    if (!graph?.nodes?.length) return { kind: 'none', reason: 'graphe vide' }
    const verdict = acceptProposedGraph(graph)
    if (!verdict.ok) return { kind: 'none', reason: verdict.reason }
    const name =
      typeof propose.name === 'string' && propose.name.trim()
        ? propose.name.trim()
        : 'Composé à la volée'
    return { kind: 'new', graph, name }
  }

  // Deuxième barrière de l'invocabilité : le catalogue ne montre déjà que les profils autorisés ET
  // exécutables, mais un modèle peut nommer un id vu ailleurs. On refuse alors avec la cause réelle.
  const nomme = profiles.find((p) => p.id === valeur)
  if (nomme?.enabled === false) return { kind: 'none', reason: `workflow désactivé : ${valeur}` }
  const issues = nomme ? workflowProfileIssues(nomme) : []
  if (issues.length) {
    return {
      kind: 'none',
      reason: `workflow non exécutable : ${valeur} — ${issues.join(' ; ')}`
    }
  }
  const trouve = nomme && estInvocable(nomme) ? nomme : undefined
  // Un id inconnu n'est pas un incident : le modèle a pu inventer un nom. On ne pilote rien plutôt
  // que de choisir un workflow au hasard parce qu'il ressemblait.
  return trouve
    ? { kind: 'existing', profile: trouve }
    : { kind: 'none', reason: `id inconnu : ${valeur}` }
}

/** Ce que la décision a donné, en une ligne lisible dans `cost.jsonl` (`petites-taches-trace.ts`). */
export function issueDeDecision(decision: WorkflowDecision): string {
  switch (decision.kind) {
    case 'existing':
      return `existant : ${decision.profile.id}`
    case 'new':
      return `nouveau : ${decision.name}`
    case 'a-composer':
      return 'nouveau — composition confiée au modèle du chat'
    case 'none':
      return decision.reason ? `aucun — ${decision.reason}` : 'aucun'
  }
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

/**
 * UN PROFIL DE RÉPARATION DOIT-IL S'EFFACER DEVANT LE RÉGIME ?
 *
 * Mesuré le 2026-08-23 : sur 205 demandes libres, 9 seulement ont joué une phase `frame` — 4 %.
 * La cause n'est PAS l'absence de workflow, et c'est le point contre-intuitif : répondre « aucun »
 * aurait donné `frame`+`build`, puisque sans profil le régime s'applique (`orchestrator.ts:1264`).
 * C'est le CHOIX d'un profil de réparation qui supprime le cadrage — `correctif` vaut
 * `[build, judge]`, `eclair` vaut `[build]`, et le graphe d'un profil ÉCRASE le régime
 * (`orchestrator.ts:1262`). Dit autrement : « fais le correctif » sur une cause inconnue fait sauter
 * l'étape qui aurait dit QUOI corriger. Le prompt du sélecteur, plus haut, ne distingue nulle part
 * un symptôme d'une correction évidente — il l'invite même à n'en choisir aucun pour « une
 * correction évidente », ce qu'un bug non diagnostiqué n'est pas.
 *
 * On ne crée donc AUCUN profil et on n'en modifie aucun : on rend simplement la main au régime, qui
 * portait déjà la bonne réponse. Et on se tait dès que l'utilisateur a nommé sa cible — il a
 * tranché, lui imposer une enquête serait le sur-traiter.
 */
export function profilEcraseLeCadrage(task: string, phases: readonly string[]): boolean {
  if (!phases.length) return false
  if (phases.some((phase) => phase === 'frame' || phase === 'scout')) return false
  return demandeEstUnSymptome(task)
}
