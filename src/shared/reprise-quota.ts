/**
 * REPRISE DES CONVERSATIONS COUPÉES PAR LE QUOTA.
 *
 * Demande du 2026-09-05 : « travaille pour reprendre les convers à pastille rouge qui viennent de
 * perdre leur quota ». La pastille ROUGE de la liste, c'est `deriveConversationState` → `failed`
 * (src/renderer/src/components/chat-view-model.ts). Mais toutes les pastilles rouges ne se valent
 * pas : un tour tombé sur une erreur de code se relancerait dans le vide. Seul le mur de QUOTA se
 * reprend — le travail était bon, c'est l'abonnement qui a dit non.
 *
 * Ce module ne fait QUE trier. Il ne relance rien : la vue applique sa décision, et le processus
 * principal repart seul à l'heure annoncée (`src/main/chat/reprise-fil-apres-quota.ts`).
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
  // « weekly limit » (2026-10-22) : même mur, autre fenêtre. Sur disque 355 fois
  // (« You've hit your weekly limit · resets 5am (Europe/Paris) », run-stdout/ et causal-trace/) ;
  // ignoré, il rendait le run `…mvi7i58s` définitif au lieu de le suspendre. Seule la
  // forme « hit your … » est reconnue : nu, « weekly limit » attraperait un nom de test ou un titre.
  // « Opus limit » est EXCLU à dessein : c'est la limite d'UN modèle, alors que
  // le mur que ce vocabulaire ferme est celui du COMPTE entier (`quotaWallKey`, registry.ts) — il
  // refuserait aussi Sonnet et Haiku jusqu'à l'heure annoncée. Sa vraie réponse est de changer de
  // modèle, ce qu'aucun code ne sait faire aujourd'hui.
  // « 5-hour limit » (2026-10-28) : la limite de session du compte sous sa formulation
  // actuelle (« You've hit your 5-hour limit · resets 11pm »), relevée dans 14 journaux de tour.
  // Ignorée, un plan de lots notait ses lots coupés « fait » et brûlait son plafond sur le mur.
  return /usage[_ ]limit|session limit|purchase more credits|hit your (?:usage|session|weekly|\d+-hour)|insufficient_quota|quota (?:exceeded|épuisé|epuise)|plan limit/i.test(
    t
  )
}

/**
 * LA MARQUE DE L'ESSAI AUTOMATIQUE. Elle s'écrit dans le fil, ce qui la fait survivre au redémarrage :
 * c'est la borne « un seul essai ». L'en-tête seul ne suffit pas : la reprise d'une tâche de fond
 * porte le même (`relance-taches-de-fond.ts`), et elle a le droit d'être coupée par le quota. Copie de
 * `ENTETE_REPRISE_AUTOMATIQUE`, épinglée par le test : l'interface et le Board lisent aussi ce texte.
 */
export const MARQUE_REPRISE_APRES_QUOTA =
  '[Reprise automatique] Ton tour précédent a été coupé par la limite du compte.'

/** Ce message est-il l'essai automatique, et non une phrase de l'utilisateur qui en parle ? */
export function estUneRepriseApresQuota(message: string | undefined | null): boolean {
  return (message ?? '').trimStart().startsWith(MARQUE_REPRISE_APRES_QUOTA)
}

/**
 * Le tour qui porte l'attente : le dernier message HORS consignes. Une consigne écrite pendant un tour
 * ne répond à rien ; une demande arrivée après la coupure a repris la main.
 *
 * fix-ok: une consigne écrite sous une réponse déjà commencée passe en fin de fil (`append`,
 * `store/conversations.ts`) ; lu par `at(-1)`, ce fil passait pour « pas coupé », sans départ et sans
 * raison affichée (5 tests rouges sur cet ordre réel).
 */
export function tourDuFil<T extends { orientation?: boolean }>(
  messages: readonly T[]
): T | undefined {
  for (let rang = messages.length - 1; rang >= 0; rang -= 1) {
    if (!messages[rang].orientation) return messages[rang]
  }
  return undefined
}

/**
 * Ce tour est-il une coupure par le QUOTA ? C'est la première condition de la reprise : un fil dont le
 * dernier tour ne l'est pas n'a aucun état de reprise. Le résumé la porte aussi
 * (`dernierTourCoupeParQuota`), pour écarter ces fils sans relire leur historique.
 */
export function estTourCoupeParQuota(tour: {
  role: string
  status?: string
  error?: string
}): boolean {
  return tour.role === 'assistant' && tour.status === 'failed' && estMurDeQuota(tour.error)
}

/**
 * Pourquoi un fil coupé ne repartira pas seul.
 *
 * fix-ok: `hors-du-chat` vient du fil « Assistant mails », règle mail relancée sans ses bornes, essai du contrôle
 * final ; `branche` vient de `partis ["conv-1","conv-2"]`, une coupure recopiée par `fork` et relancée
 * deux fois. Chaque exclusion a sa raison ici, sinon l'écran ne saurait pas dire pourquoi le fil attend.
 */
export type RaisonDeRepriseManuelle =
  | 'aucune-heure'
  | 'coupure-ancienne'
  | 'run'
  | 'plan-de-lots'
  | 'inactive'
  | 'hors-du-chat'
  | 'branche'

/**
 * Où en est un fil coupé par le quota. `reprendA` : l'instant du départ, marge comprise. Décidé côté
 * principal (`etatDeRepriseDuFil`), lu tel quel par la liste : l'écran dit ce qui partira.
 */
export type EtatDeRepriseDuFil =
  | { etat: 'attente'; reprendA: number }
  | { etat: 'manuelle'; raison: RaisonDeRepriseManuelle }
  | { etat: 'essai-rate' }

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
 * L'ordre d'entrée est conservé : celui où l'utilisateur lit ses fils. Le clic les relance tous
 * en même temps (`chat-view-reprise.ts`).
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

/** Une ligne de la liste : les fils dans la même situation sont comptés ensemble. */
export type SituationDeReprise =
  | { etat: 'attente'; n: number; reprendA: number }
  | { etat: 'essai-rate'; n: number }
  | { etat: 'manuelle'; n: number; raison: RaisonDeRepriseManuelle }

/**
 * Une ligne par situation, pas une par fil : dix fils coupés ensemble ne doivent pas noyer la liste.
 * L'ordre va de ce qui se passe seul à ce qui attend l'utilisateur. Pour l'attente, l'heure gardée
 * est celle du PREMIER départ : les autres suivent, un fil à la fois.
 */
export function situationsDeReprise(
  conversations: readonly { repriseQuota?: EtatDeRepriseDuFil }[]
): SituationDeReprise[] {
  const situations: SituationDeReprise[] = []
  const attentes = conversations.flatMap((c) =>
    c.repriseQuota?.etat === 'attente' ? [c.repriseQuota.reprendA] : []
  )
  if (attentes.length > 0)
    situations.push({ etat: 'attente', n: attentes.length, reprendA: Math.min(...attentes) })
  const essais = conversations.filter((c) => c.repriseQuota?.etat === 'essai-rate').length
  if (essais > 0) situations.push({ etat: 'essai-rate', n: essais })
  const parRaison = new Map<RaisonDeRepriseManuelle, number>()
  for (const { repriseQuota } of conversations)
    if (repriseQuota?.etat === 'manuelle')
      parRaison.set(repriseQuota.raison, (parRaison.get(repriseQuota.raison) ?? 0) + 1)
  for (const [raison, n] of parRaison) situations.push({ etat: 'manuelle', n, raison })
  return situations
}

/** Les mois tels que Claude les abrège dans « resets Sep 29, 2am ». */
const MOIS_ANGLAIS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec'
]

/** Au-delà, une date annoncée est périmée ou mal lue : aucune limite d'abonnement ne dure un mois. */
const ECHEANCE_DATEE_MAX_MS = 31 * 24 * 3_600_000

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
  // « resets Sep 29, 2am » — la forme DATÉE de la limite hebdomadaire (44 occurrences dans les
  // journaux le 2026-10-22) : sans elle, le mur ne retombait qu'au redémarrage.
  // `(?![\w:])` : « 3:5pm » ne doit pas se lire « 3 » en laissant tomber le « :5pm ».
  const heure =
    /\bresets?\s+(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\w:])/i.exec(
      t
    )
  if (!heure) return undefined
  const moisAnnonce = heure[1] ? MOIS_ANGLAIS.indexOf(heure[1].toLowerCase()) + 1 : undefined
  const jourAnnonce = heure[2] ? Number(heure[2]) : undefined
  let h = Number(heure[3])
  const min = heure[4] ? Number(heure[4]) : 0
  const meridien = heure[5]?.toLowerCase()
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
  if (moisAnnonce !== undefined && jourAnnonce !== undefined) {
    if (jourAnnonce < 1 || jourAnnonce > 31) return undefined
    // L'année n'est pas écrite : celle du refus, ou la suivante quand « Jan 2 » tombe en décembre.
    for (const annee of [mur.annee, mur.annee + 1]) {
      // « Sep 31 » n'existe pas : `Date.UTC` le roulerait au 1er octobre sans rien dire.
      if (new Date(Date.UTC(annee, moisAnnonce - 1, jourAnnonce)).getUTCDate() !== jourAnnonce) {
        return undefined
      }
      const instant = instantDepuisMur(annee, moisAnnonce, jourAnnonce, h, min, fuseau)
      // Une date relue APRÈS son échéance (refus périmé) n'annonce plus rien : on ne la reporte
      // pas d'un an. Le plafond borne aussi une date mal lue — une limite d'abonnement ne
      // dépasse pas le mois.
      if (instant !== undefined && instant > depart && instant - depart <= ECHEANCE_DATEE_MAX_MS) {
        return instant
      }
    }
    return undefined
  }
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
