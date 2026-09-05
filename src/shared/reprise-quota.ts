/**
 * REPRISE DES CONVERSATIONS COUPÉES PAR LE QUOTA.
 *
 * Demande du 2026-09-05 : « travaille pour reprendre les convers à pastille rouge qui viennent de
 * perdre leur quota ». La pastille ROUGE de la liste, c'est `deriveConversationState` → `failed`
 * (src/renderer/src/components/chat-view-model.ts). Mais toutes les pastilles rouges ne se valent
 * pas : un tour tombé sur une erreur de code se relancerait dans le vide. Seul le mur de QUOTA se
 * reprend — le travail était bon, c'est l'abonnement qui a dit non.
 *
 * Ce module ne fait QUE trier. Il ne relance rien : la vue applique sa décision.
 *
 * Le discriminant reprend celui de `quotaWallReason` (src/main/providers/registry.ts) — même
 * vocabulaire, même exclusion du rate-limit passager. Il est recopié ici parce que `registry.ts`
 * vit côté processus principal et n'est pas importable depuis l'interface.
 */

/**
 * Le message décrit-il un QUOTA D'ABONNEMENT ÉPUISÉ — et lui seul ?
 *
 * Le discriminant est le VOCABULAIRE du refus, pas le code HTTP : un quota épuisé et un
 * rate-limit passager arrivent tous deux en 429. Confondre les deux ferait relancer en boucle des
 * conversations sur un mur qui n'a pas bougé.
 */
export function estMurDeQuota(texte: string | undefined | null): boolean {
  const t = (texte ?? '').trim()
  if (!t) return false
  // Une attente ANNONCÉE dit « reviens dans un instant » : c'est un rate-limit, pas un quota mort.
  if (/retry after|try again in|rate limit exceeded/i.test(t)) return false
  // « session limit » est le texte RÉELLEMENT enregistré par Claude dans conversations.json
  // (mesuré le 2026-09-05 : 3 fils sur 12 rouges). Il annonce une remise à zéro à heure fixe
  // (« resets 2am »), pas une attente de quelques secondes : c'est bien un quota mort.
  return /usage[_ ]limit|session limit|purchase more credits|hit your (?:usage|session)|insufficient_quota|quota (?:exceeded|épuisé|epuise)|plan limit/i.test(
    t
  )
}

/** Ce que la liste des conversations sait d'un fil, et qui suffit à trancher. */
export interface ConversationCandidateQuota {
  id: string
  title?: string
  /** État du DERNIER tour assistant — `failed` = la pastille rouge. */
  lastAssistantStatus?: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  /** Erreur du dernier tour assistant, telle que stockée. */
  lastAssistantError?: string
}

/**
 * Les conversations à relancer : pastille ROUGE **et** mur de quota, en excluant celles dont un
 * tour tourne déjà (relancer par-dessus serait refusé côté principal, sans bruit).
 *
 * L'ordre d'entrée est conservé : la reprise est séquentielle, et l'utilisateur voit repartir ses
 * fils dans l'ordre où il les lit.
 */
export function conversationsCoupeesParQuota<T extends ConversationCandidateQuota>(
  conversations: readonly T[],
  enCours: ReadonlySet<string> = new Set()
): T[] {
  return conversations.filter(
    (c) =>
      c.lastAssistantStatus === 'failed' &&
      !enCours.has(c.id) &&
      estMurDeQuota(c.lastAssistantError)
  )
}
