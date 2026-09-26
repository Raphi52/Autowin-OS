import { messageCommitAgent } from './store/worktree-manager'

/**
 * Ligne qui ANNONCE, dans la réponse d'un run, le commit local qu'il a créé pour ramener son travail.
 *
 * Ce commit est le transport obligatoire de la copie isolée vers la branche de l'utilisateur. Il
 * arrivait sans un mot : l'utilisateur découvrait `agent run-xxx-1` dans son historique et croyait
 * que le run avait commité en cachette malgré la consigne (conv-710). Rend `undefined` quand aucun
 * commit n'a été créé par ce run (rien de modifié, ou issue autre qu'une fusion).
 */
export function annonceCommitLocal(
  issue: unknown,
  agentId: string,
  task: string | undefined
): string | undefined {
  if (typeof issue !== 'object' || issue === null) return undefined
  const { outcome, committed, publishedSha } = issue as {
    outcome?: unknown
    committed?: unknown
    publishedSha?: unknown
  }
  if (outcome !== 'merged' || committed !== true) return undefined
  const sha = typeof publishedSha === 'string' && publishedSha.trim() ? publishedSha.trim() : ''
  // `publishedSha` est la tête posée sur la branche (le commit lui-même ou sa fusion) : on la cite
  // comme adresse de l'intégration, et on donne le message du commit créé, sans les confondre.
  const tete = sha ? ` (tête de branche \`${sha.slice(0, 8)}\`)` : ''
  return (
    `Commit local créé : « ${messageCommitAgent(agentId, task)} », intégré dans ta branche${tete}, non poussé. ` +
    `C'est lui qui ramène le travail de la copie isolée.`
  )
}
