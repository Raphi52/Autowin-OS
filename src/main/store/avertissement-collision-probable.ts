/**
 * DIRE AU DEPART CE QU'ON DECOUVRAIT A L'ARRIVEE.
 *
 * Vecu le 2026-08-27 (conv-1450) : l'utilisateur apprend la collision `base-dirty` APRES le travail,
 * avec la facture — 1,32 $ pour un « statut echoue ». L'echelle de replis fait desormais atterrir ce
 * travail, mais rien ne le prevenait AVANT, alors que l'information existait deja : la copie remise a
 * l'agent EXCLUT les fichiers sales de l'utilisateur, et cette liste (`excludedDirtyFiles`) est
 * calculee au demarrage.
 *
 * Elle etait meme AFFICHEE — dans un `<details>` du panneau Worktrees qu'il faut penser a ouvrir.
 * C'est exactement le defaut deja diagnostique pour les motifs de blocage : « rendus que dans un
 * panneau detaille qu'il faut penser a ouvrir, donc jamais lus ». Ici on la met la ou l'utilisateur
 * regarde, avec le cadrage qui manquait.
 *
 * TROIS CHOSES QUE CE MESSAGE NE FAIT PAS, et chacune est une decision :
 *
 *  1. Il ne REFUSE rien. Un pre-vol bloquant a existe du 2026-08-18 au 2026-08-25 et a ete retire
 *     pour une bonne raison (`orchestrator.ts` : « PAS DE PRE-VOL BASE-DIRTY — un run de mutation
 *     PART sur une base sale, deliberement ») : il refusait sur l'etat BRUT, alors que la garde
 *     reelle est chirurgicale, et sur un depot ou l'utilisateur travaille en continu ce refus etait
 *     la NORME. On ne renverse pas cette decision — on ajoute une phrase, pas une porte.
 *
 *  2. Il n'AFFIRME pas que ca va bloquer. Au lancement, les fichiers que l'agent va toucher ne sont
 *     pas connus, donc l'intersection est INCALCULABLE a cet instant. Le message dit « si », parce
 *     que c'est la verite. Une alerte qui crie faux est une alerte qu'on apprend a ignorer, et elle
 *     detruirait aussi la credibilite de celles qui disent vrai.
 *
 *  3. Il ne se declenche pas sur un arbre propre : rien a dire, on ne dit rien. Un bandeau permanent
 *     ne serait pas un avertissement, ce serait du decor.
 */

/** Combien de noms citer avant de resumer. Au-dela, la liste cesse d'informer et devient un mur. */
export const MAX_FICHIERS_CITES = 5

export function avertissementCollisionProbable(
  fichiersSales: readonly string[] | undefined,
  options: { tronquee?: boolean; total?: number } = {}
): string {
  const fichiers = (fichiersSales ?? []).filter((chemin) => chemin.trim().length > 0)
  if (fichiers.length === 0) return ''
  const total = options.total ?? fichiers.length
  const cites = fichiers.slice(0, MAX_FICHIERS_CITES)
  const reste = total - cites.length
  const liste = cites.join(', ') + (reste > 0 || options.tronquee ? `, et ${reste} autre(s)` : '')
  return (
    `Ton arbre a ${total} changement${total > 1 ? 's' : ''} non committé${total > 1 ? 's' : ''} : ` +
    `${liste}. Ce run part quand même. SI son travail touche un de ces fichiers, la publication ` +
    `passera par l’attente d’intégration au lieu d’atterrir tout de suite — les committer ou les ` +
    `ranger maintenant l’évite.`
  )
}
