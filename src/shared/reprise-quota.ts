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

/**
 * L'HEURE DE RETOUR QUE LE REFUS ANNONCE LUI-MÊME.
 *
 * Mesuré le 2026-09-15 sur `causal-trace/conv-539.jsonl` : le refus réellement écrit par Claude est
 * « session limit · resets 3:20pm (Europe/Paris) ». Cette heure était jusqu'ici purement décorative —
 * le disjoncteur de quota (`ProviderRegistry.quotaWalls`) gardait sa porte fermée jusqu'au
 * redémarrage de l'app, y compris onze minutes APRÈS l'heure que le refus promettait. La reprise
 * automatique (`deciderRepriseProgrammee`) partait alors dans le vide, et comme elle ne rejoue
 * jamais deux fois la même échéance, l'attente redevenait manuelle (« reprend j'ai recup mon
 * credit », relevé dans la même trace).
 *
 * Fonction PURE et bornée : elle rend l'instant en millisecondes, ou rien quand le refus n'annonce
 * aucune heure. `maintenant` est un paramètre — sans lui, les cas limites (minuit, passage à
 * l'heure d'été) ne sont pas testables, et c'est justement là que ce genre de calcul se trompe.
 *
 * Aucune sonde, aucun minuteur : le retour se constate au moment où un appel se présente.
 */
export function instantDeRetourAnnonce(
  texte: string | undefined | null,
  maintenant: Date = new Date()
): number | undefined {
  const t = (texte ?? '').trim()
  if (!t) return undefined
  const depart = maintenant.valueOf()
  if (!Number.isFinite(depart)) return undefined
  // « resets 3:20pm », « resets 6pm », « resets 2am » — les trois formes réellement relevées.
  // `(?![\w:])` : « 3:5pm » ne doit pas se lire « 3 » en laissant tomber le « :5pm ».
  const heure = /\bresets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\w:])/i.exec(t)
  if (!heure) return undefined
  let h = Number(heure[1])
  const min = heure[2] ? Number(heure[2]) : 0
  const meridien = heure[3]?.toLowerCase()
  if (h > 23 || min > 59) return undefined
  // Sur 12 heures, seules 1 à 12 existent : « 13pm » ou « 0am » sont illisibles, pas 13h ou minuit.
  if (meridien && (h < 1 || h > 12)) return undefined
  if (meridien === 'pm' && h < 12) h += 12
  if (meridien === 'am' && h === 12) h = 0
  // Le fuseau est celui que le refus cite entre parenthèses : l'heure annoncée est une heure de
  // MONTRE là-bas, pas un instant. Sans fuseau cité, on prend celui du poste.
  const fuseau = /\(([A-Za-z]+(?:\/[A-Za-z_+-]+)+)\)/.exec(t)?.[1]
  const mur = murLocal(depart, fuseau)
  if (!mur) return undefined
  // Aujourd'hui puis demain : « resets 2am » écrit à 23h désigne le lendemain.
  for (const decalageJours of [0, 1]) {
    const instant = instantDepuisMur(mur.annee, mur.mois, mur.jour + decalageJours, h, min, fuseau)
    if (instant !== undefined && instant > depart) return instant
  }
  return undefined
}

/** Décalage du fuseau (ms) à un instant donné, mesuré par `Intl` — jamais codé en dur. */
function decalageFuseau(instant: number, fuseau: string | undefined): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: fuseau,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(new Date(instant))
    const champ = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
    const h = champ('hour')
    const commeUtc = Date.UTC(
      champ('year'),
      champ('month') - 1,
      champ('day'),
      h === 24 ? 0 : h,
      champ('minute'),
      champ('second')
    )
    return Number.isFinite(commeUtc) ? commeUtc - instant : undefined
  } catch {
    // Fuseau illisible : on ne devine pas, l'appelant retombera sur « aucune heure annoncée ».
    return undefined
  }
}

/** La date de MONTRE (année/mois/jour) dans le fuseau du refus, à l'instant donné. */
function murLocal(
  instant: number,
  fuseau: string | undefined
): { annee: number; mois: number; jour: number } | undefined {
  const decalage = decalageFuseau(instant, fuseau)
  if (decalage === undefined) return undefined
  const local = new Date(instant + decalage)
  return {
    annee: local.getUTCFullYear(),
    mois: local.getUTCMonth() + 1,
    jour: local.getUTCDate()
  }
}

/**
 * Heure de MONTRE → instant. Deux passes : la première donne un décalage approché, la seconde le
 * recalcule à l'instant trouvé — c'est ce qui rend le résultat juste le jour d'un changement d'heure.
 */
function instantDepuisMur(
  annee: number,
  mois: number,
  jour: number,
  heure: number,
  minute: number,
  fuseau: string | undefined
): number | undefined {
  const commeUtc = Date.UTC(annee, mois - 1, jour, heure, minute)
  if (!Number.isFinite(commeUtc)) return undefined
  const premier = decalageFuseau(commeUtc, fuseau)
  if (premier === undefined) return undefined
  const approche = commeUtc - premier
  const second = decalageFuseau(approche, fuseau)
  return second === undefined ? approche : commeUtc - second
}
