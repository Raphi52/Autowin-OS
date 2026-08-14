/**
 * LE SCOUT INTERNE COMME AGENT VISIBLE — pas un CLI fantôme.
 *
 * Demande utilisateur du 2026-08-13 : « le bouton en générer plus ça doit lancer une conversation
 * visible et la tâche planifiée pareil ». C'est la doctrine du cockpit : depuis le chat, on doit voir
 * chaque agent, son état, ses coûts, pouvoir l'orienter ou l'interrompre. La première version
 * spawnait un CLI invisible — techniquement correct, humainement muet.
 *
 * Le scout tourne donc comme un TOUR DE CONVERSATION ordinaire, via le même runtime que les tâches
 * planifiées (`ScheduledChatRuntime.runPrompt`) : la conversation apparaît à gauche, le fil montre le
 * travail, le tour est interruptible et son coût compté. À la fin, la sortie passe par LE MÊME
 * contrôle de citation que tout le reste (`trierCandidats`, via la passe interne) — la visibilité ne
 * détend pas la preuve.
 */
import { construirePromptScoutInterne, type ParametresScoutInterne } from './scout-interne'
import { extraireCandidats, executerPasseInterne, type ResultatPasse } from './passe'
import type { CandidatBrut } from './candidats'

export interface RuntimeConversationVisible {
  createConversation(input: { title: string; category: string; provider: string }): { id: string }
  runPrompt(
    conversationId: string,
    prompt: string,
    binding?: { provider: string; model?: string },
    policy?: { readOnly: boolean; maxIterations: number; background?: boolean }
  ): Promise<{ ok: boolean; cancelled?: boolean; error?: string; text?: string }>
}

export interface DepsScoutVisible extends ParametresScoutInterne {
  runtime: RuntimeConversationVisible
  /** Provider/modèle du scout — la config de RÔLES de l'utilisateur, jamais un défaut inventé ici. */
  binding: { provider: string; model?: string }
  chemin?: string
  maintenant?: () => string
}

export interface ResultatScoutVisible extends ResultatPasse {
  /** La conversation où le scout a travaillé — l'utilisateur peut l'ouvrir et relire le fil. */
  conversationId: string
}

export async function genererCandidatsEnConversation(
  deps: DepsScoutVisible
): Promise<ResultatScoutVisible> {
  const quand = (deps.maintenant ?? (() => new Date().toISOString()))()
  const conversation = deps.runtime.createConversation({
    title: `[veille] scout interne ${quand.slice(0, 16).replace('T', ' ')}`,
    category: deps.binding.provider,
    provider: deps.binding.provider
  })
  const resultat = await deps.runtime.runPrompt(
    conversation.id,
    construirePromptScoutInterne(deps),
    deps.binding,
    // Lecture seule : un scout n'a rien à écrire ni à exécuter. `background` : le tour ne vole pas
    // le focus d'un travail interactif en cours.
    { readOnly: true, maxIterations: 40, background: true }
  )
  if (!resultat.ok || resultat.cancelled) {
    throw new Error(
      resultat.cancelled
        ? `scout interne interrompu (conversation ${conversation.id})`
        : `scout interne en échec : ${resultat.error ?? 'sans message'} (conversation ${conversation.id})`
    )
  }
  const texte = resultat.text ?? ''
  const bruts = extraireCandidats(texte)
  if (!bruts) {
    throw new Error(
      `sortie du scout interne illisible : aucun JSON exploitable (conversation ${conversation.id})`
    )
  }
  // Mesuré sur le premier run réel (conv-1154, 13/08) : 717 tokens, 2,7 s, zéro outil — l'agent a
  // répondu « [] » sans rien lire, et la vue affichait un carré. Un tableau vide n'est acceptable
  // qu'accompagné de la synthèse d'exploration exigée par le prompt ; nu, c'est un refus de travail
  // qu'on NOMME au lieu d'écrire « 0 candidat » comme si l'app avait été réellement lue.
  if (bruts.length === 0 && texte.trim().length < 120) {
    throw new Error(
      `le scout interne a répondu vide sans exploration citée (conversation ${conversation.id}) — relance ou change le modèle du rôle`
    )
  }
  // L'estampille vient d'ICI, jamais de l'agent — même règle que la passe web.
  const internes: CandidatBrut[] = bruts.map((brut) => ({
    ...brut,
    type: 'ajout',
    concurrent: 'Autowin OS'
  }))
  const passe = await executerPasseInterne({
    candidatsInternes: async () => internes,
    ...(deps.maintenant ? { maintenant: deps.maintenant } : {}),
    ...(deps.chemin ? { chemin: deps.chemin } : {})
  })
  return { ...passe, conversationId: conversation.id }
}
