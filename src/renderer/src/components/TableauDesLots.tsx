import { useEffect, useState } from 'react'
import type { Langue } from '../../../shared/langue'
import {
  relancerLot,
  type EtatDuLot,
  type GestePlanDeLots,
  type LotDuPlan,
  type PlanDeLots,
  type StatutDuPlan,
  type VuePlanDeLots
} from '../../../shared/plan-de-lots'
import { formaterDate } from '../langue'
import {
  auPluriel,
  texteDuBilan,
  traduireChatFilsEtLots,
  useTextesChatFilsEtLots,
  type CleChatFilsEtLots
} from '../textes-ecrans/chat-fils-et-lots'
import { formatDuration, summarizeConversationCost, type CostRow } from './conversation-cost'
import './TableauDesLots.css'

/*
 * SUPER CONVERSATION — LE TABLEAU D'AVANCEMENT DU FIL CHEF (conv-1150, 2026-10-26).
 *
 * Le fil chef est le seul que l'utilisateur suit : ce bloc, posé au-dessus de la zone de saisie,
 * montre chaque lot (à faire, en cours, fait, échec), le fil qui le traite, et le budget de tours.
 * Depuis conv-1171, le plan part dès que l'agent le dépose : ici, l'utilisateur suit et peut
 * arrêter. « Lancer le plan » ne reste que pour un plan déposé avant ce changement.
 *
 * Dans un fil enfant, une seule ligne rappelle quel lot il traite et pour quel chef.
 * Relu à chaque signal `refresh` (plans-de-lots, chat, conversations) et à chaque changement de fil.
 */

const ouvrirFil = (fil: string): void => {
  window.dispatchEvent(new CustomEvent('autowin:open-conversation', { detail: fil }))
}

const STATUTS_REPRENABLES = new Set(['suspendu-quota', 'interrompu', 'arrete'])
const STATUTS_ARRETABLES = new Set(['en-cours', 'suspendu-quota', 'interrompu'])

/*
 * DURÉE ET COÛT DE CHAQUE LOT (conv-1151, lot 4 — constat d'origine conv-1146 : plus de 20 $ dans un
 * seul fil, sans que rien ne le montre). Le coût d'un lot est celui de SON fil, lu par le même canal
 * `costBreakdown` et résumé par le même `summarizeConversationCost` que la pastille de coût du fil
 * (ConversationCostIndicator) : un second calcul serait une seconde vérité. Un fil sans appel mesuré,
 * un canal absent ou un journal illisible donnent « — », jamais « 0 $ ».
 */
const INCONNU = '—'

/** Lignes de coût par fil de lot ; `null` = canal absent ou journal illisible. */
type CoutsParFil = Record<string, CostRow[] | null>

/** Le coût d'un fil, ou `undefined` quand rien n'a été mesuré (même règle que la pastille). */
function coutDuFil(couts: CoutsParFil, fil: string | undefined): CostRow[] | undefined {
  const lignes = fil ? couts[fil] : undefined
  if (!lignes || summarizeConversationCost(lignes).calls <= 0) return undefined
  return lignes
}

const heure = (ms: number): string => formaterDate(ms, { hour: '2-digit', minute: '2-digit' })

/** Le texte d'une clé, au singulier ou au pluriel selon `n` et la langue (`auPluriel`). */
const selonNombre = (
  langue: Langue,
  n: number,
  un: CleChatFilsEtLots,
  plusieurs: CleChatFilsEtLots,
  valeurs: Record<string, string | number> = {}
): string =>
  traduireChatFilsEtLots(auPluriel(n, langue) ? plusieurs : un, langue, { n, ...valeurs })

/*
 * Les libellés d'état et de statut de l'écran. Le moteur garde les siens en français
 * (`LIBELLE_ETAT` / `LIBELLE_STATUT`, shared/plan-de-lots.ts) : l'agent du fil chef les lit.
 */
const CLE_ETAT: Record<EtatDuLot, CleChatFilsEtLots> = {
  'a-faire': 'lots.etat.a-faire',
  'en-cours': 'lots.etat.en-cours',
  fait: 'lots.etat.fait',
  echec: 'lots.etat.echec',
  interrompu: 'lots.etat.interrompu'
}
const CLE_STATUT: Record<StatutDuPlan, CleChatFilsEtLots> = {
  'attente-accord': 'lots.statut.attente-accord',
  'en-cours': 'lots.statut.en-cours',
  termine: 'lots.statut.termine',
  'suspendu-quota': 'lots.statut.suspendu-quota',
  'plafond-atteint': 'lots.statut.plafond-atteint',
  bloque: 'lots.statut.bloque',
  interrompu: 'lots.statut.interrompu',
  arrete: 'lots.statut.arrete',
  refuse: 'lots.statut.refuse',
  remplace: 'lots.statut.remplace'
}

/** Durée du DERNIER lancement du lot (une relance remet `debut` à zéro). */
function dureeDuLot(lot: LotDuPlan, langue: Langue): { texte: string; titre?: string } {
  if (!lot.debut) return { texte: INCONNU }
  if (lot.fin)
    return {
      texte: formatDuration(lot.fin - lot.debut) ?? INCONNU,
      titre: `${heure(lot.debut)} → ${heure(lot.fin)}`
    }
  // En cours : l'heure de départ reste vraie sans horloge qui tourne, une durée figée ne le serait pas.
  if (lot.etat === 'en-cours')
    return {
      texte: traduireChatFilsEtLots('lots.duree.depuis', langue, { heure: heure(lot.debut) }),
      titre: traduireChatFilsEtLots('lots.duree.lancePasFini', langue)
    }
  return {
    texte: INCONNU,
    titre: traduireChatFilsEtLots('lots.duree.finNonNotee', langue, { heure: heure(lot.debut) })
  }
}

/**
 * Relit le coût de chaque fil de lot quand un lot change d'état ou se termine — c'est à la fin d'un
 * tour que sa dépense devient lisible (même moment que la pastille du fil), et relire tous les
 * journaux à chaque signal « chat » coûterait sans rien apprendre.
 */
function useCoutsDesLots(plan: PlanDeLots | null): CoutsParFil {
  const [lu, setLu] = useState<{ plan: string; couts: CoutsParFil }>({ plan: '', couts: {} })
  const signature = plan
    ? plan.lots.map((l) => (l.fil ? `${l.fil}:${l.etat}:${l.fin ?? ''}` : '')).join('|')
    : ''
  const planId = plan?.id ?? ''
  useEffect(() => {
    const fils = [
      ...new Set(
        signature
          .split('|')
          .filter(Boolean)
          .map((s) => s.split(':')[0])
      )
    ]
    if (!planId || !fils.length) return
    const lire = window.api?.costBreakdown
    let vivant = true
    void Promise.all(
      fils.map(async (fil): Promise<[string, CostRow[] | null]> => {
        if (typeof lire !== 'function') return [fil, null]
        try {
          const lignes = (await lire('actor', fil)) as CostRow[] | undefined
          return [fil, Array.isArray(lignes) ? lignes : null]
        } catch {
          // Journal illisible : ce lot reste « — », le tableau ne casse pas.
          return [fil, null]
        }
      })
    ).then((paires) => {
      if (vivant) setLu({ plan: planId, couts: Object.fromEntries(paires) })
    })
    return () => {
      vivant = false
    }
  }, [planId, signature])
  // Les coûts d'un AUTRE plan (changement de fil) ne s'affichent jamais.
  return lu.plan === planId ? lu.couts : {}
}

/** Le coût des lots MESURÉS, additionné par le même résumé ; les lots lancés sans mesure sont comptés. */
function coutTotalDesLots(plan: PlanDeLots, couts: CoutsParFil, langue: Langue): string {
  const lances = plan.lots.filter((l) => l.fil)
  const mesures = lances.map((l) => coutDuFil(couts, l.fil)).filter((c): c is CostRow[] => !!c)
  if (!mesures.length) return INCONNU
  const total = summarizeConversationCost(mesures.flat()).label
  const sansMesure = lances.length - mesures.length
  return sansMesure
    ? selonNombre(langue, sansMesure, 'lots.cout.sansMesure.un', 'lots.cout.sansMesure.plusieurs', {
        total
      })
    : total
}

/*
 * RELANCER UN LOT AU CLIC (conv-1151, lot 3). Avant ce bouton, seul l'agent du chef relançait un lot
 * en échec (`plan_de_lots`, action « relancer ») : l'utilisateur, qui voyait l'échec ici, devait lui
 * écrire. La décision « permis » est celle de `relancerLot` — la règle même que le geste exécutera
 * dans le coordinateur, jamais une seconde copie.
 */

/** Plans dont un lot en échec garde son bouton, grisé, quand le plafond de tours est épuisé. */
const STATUTS_RELANCE_GRISEE = new Set<PlanDeLots['statut']>([
  'en-cours',
  'termine',
  'plafond-atteint'
])

/** `null` = pas de bouton ; sinon actif, ou grisé avec sa raison. */
function relanceAuClic(
  plan: PlanDeLots,
  lot: LotDuPlan,
  langue: Langue
): { possible: true } | { possible: false; raison: string } | null {
  if (lot.etat !== 'echec' && lot.etat !== 'interrompu') return null
  if (relancerLot(plan, lot.rang).ok) return { possible: true }
  // Le seul refus qui garde un bouton : sans lui, l'utilisateur ne saurait pas pourquoi rien ne
  // repart. Les autres (quota, redémarrage, arrêt) ont déjà leur bouton « Reprendre ».
  if (plan.toursLances >= plan.plafondTours && STATUTS_RELANCE_GRISEE.has(plan.statut))
    return {
      possible: false,
      raison: traduireChatFilsEtLots('lots.relance.plafond', langue, {
        plafond: plan.plafondTours
      })
    }
  return null
}

function LotsDuPlan({
  plan,
  couts,
  occupe,
  relancer
}: {
  plan: PlanDeLots
  couts: CoutsParFil
  occupe: boolean
  relancer: (rang: number) => void
}): React.JSX.Element {
  const { langue, t } = useTextesChatFilsEtLots()
  return (
    <ol className="tdl-lots">
      {plan.lots.map((lot) => {
        const duree = dureeDuLot(lot, langue)
        const cout = coutDuFil(couts, lot.fil)
        const relance = relanceAuClic(plan, lot, langue)
        return (
          <li key={lot.rang} className={`tdl-lot tdl-lot--${lot.etat}`} data-lot-etat={lot.etat}>
            <span className="tdl-pastille">{t(CLE_ETAT[lot.etat])}</span>
            <span className="tdl-lot-titre">
              {lot.rang}. {lot.titre}
              {lot.raison ? <span className="tdl-lot-raison"> — {lot.raison}</span> : null}
              {relance ? (
                <span className="tdl-relance">
                  <button
                    type="button"
                    className="tdl-bouton tdl-bouton--lot"
                    data-testid={`tdl-lot-${lot.rang}-relancer`}
                    disabled={occupe || !relance.possible}
                    title={
                      relance.possible
                        ? t('lots.relance.titre', {
                            rang: lot.rang,
                            fil: lot.fil ?? t('lots.relance.nouveauFil'),
                            lances: plan.toursLances,
                            plafond: plan.plafondTours
                          })
                        : relance.raison
                    }
                    onClick={() => relancer(lot.rang)}
                  >
                    {t('lots.relance.bouton')}
                  </button>
                  {relance.possible ? null : (
                    <span className="tdl-relance-raison">{relance.raison}</span>
                  )}
                </span>
              ) : null}
            </span>
            <span
              className="tdl-mesure tdl-duree"
              data-testid={`tdl-lot-${lot.rang}-duree`}
              title={duree.titre}
            >
              {duree.texte}
            </span>
            <span
              className={`tdl-mesure tdl-cout${cout ? '' : ' tdl-mesure--inconnue'}`}
              data-testid={`tdl-lot-${lot.rang}-cout`}
              title={cout ? t('lots.cout.duFil', { fil: lot.fil ?? '' }) : t('lots.cout.nonMesure')}
            >
              {cout ? summarizeConversationCost(cout).label : INCONNU}
            </span>
            {lot.fil ? (
              <button
                type="button"
                className="tdl-fil"
                onClick={() => {
                  if (lot.fil) ouvrirFil(lot.fil)
                }}
                title={t('lots.ouvrirFil', { fil: lot.fil })}
              >
                {lot.fil}
              </button>
            ) : (
              <span className="tdl-fil tdl-fil--vide">—</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function TableauDesLots({
  conversationId
}: {
  conversationId?: string | null
}): React.JSX.Element | null {
  const { langue, t } = useTextesChatFilsEtLots()
  // L'état porte le fil qu'il décrit : à un changement de fil, l'ancien plan n'est jamais affiché.
  const [lu, setLu] = useState<{ fil: string; vue: VuePlanDeLots | null }>({ fil: '', vue: null })
  const [geste, setGeste] = useState<{ fil: string; enCours: boolean; erreur?: string }>({
    fil: '',
    enCours: false
  })

  useEffect(() => {
    if (!conversationId || typeof window.api?.plansDeLots !== 'function') return
    let vivant = true
    const relire = (): void => {
      window.api.plansDeLots('voir', conversationId).then(
        (r) => {
          if (vivant) setLu({ fil: conversationId, vue: r.ok ? (r.vue ?? null) : null })
        },
        // Un shell plus ancien n'expose pas ce canal : rien à montrer, rien de cassé.
        () => {
          if (vivant) setLu({ fil: conversationId, vue: null })
        }
      )
    }
    relire()
    const off = window.api?.onAppEvent?.((e) => {
      if (
        e.type === 'refresh' &&
        (e.scope === 'plans-de-lots' || e.scope === 'chat' || e.scope === 'conversations')
      )
        relire()
    })
    return () => {
      vivant = false
      off?.()
    }
  }, [conversationId])

  const vue = lu.fil === conversationId ? lu.vue : null
  // Appelé avant tout retour anticipé (règle des hooks) ; seul le fil chef lit les coûts.
  const couts = useCoutsDesLots(vue?.role === 'chef' ? vue.plan : null)
  if (!conversationId || !vue) return null
  const { plan } = vue

  if (vue.role === 'enfant') {
    const lot = plan.lots.find((l) => l.rang === vue.rang)
    return (
      <section
        className="tdl tdl--enfant"
        aria-label={t('lots.enfant.aria')}
        data-testid="tableau-des-lots"
      >
        <span className="tdl-kicker">
          {/* Rang absent : rien, comme l'ancien `{vue.rang}` rendu vide. */}
          {t('lots.enfant.rang', { rang: vue.rang ?? '', total: plan.lots.length })}
        </span>
        <span>
          {t('lots.enfant.duPlan', { titre: plan.titre })}{' '}
          <button type="button" className="tdl-fil" onClick={() => ouvrirFil(plan.chef)}>
            {plan.chef}
          </button>
          {lot ? ` — ${t(CLE_ETAT[lot.etat])}` : ''}
        </span>
      </section>
    )
  }

  const erreur = geste.fil === conversationId ? geste.erreur : undefined
  const occupe = geste.fil === conversationId && geste.enCours
  const agir = (action: Exclude<GestePlanDeLots, 'voir'>, lot?: number): void => {
    if (occupe) return
    setGeste({ fil: conversationId, enCours: true })
    const reponse =
      lot === undefined
        ? window.api.plansDeLots(action, conversationId, plan.id)
        : window.api.plansDeLots(action, conversationId, plan.id, lot)
    reponse.then(
      (r) =>
        setGeste({ fil: conversationId, enCours: false, ...(r.ok ? {} : { erreur: r.erreur }) }),
      (e: unknown) =>
        setGeste({
          fil: conversationId,
          enCours: false,
          erreur: e instanceof Error ? e.message : String(e)
        })
    )
  }

  return (
    <section
      className={`tdl tdl--${plan.statut}`}
      aria-label={t('lots.aria')}
      data-testid="tableau-des-lots"
      data-statut={plan.statut}
    >
      <header className="tdl-tete">
        <span className="tdl-kicker">{t('lots.kicker')}</span>
        <strong className="tdl-titre">{plan.titre}</strong>
        <span className={`tdl-statut tdl-statut--${plan.statut}`}>
          {t(CLE_STATUT[plan.statut])}
        </span>
      </header>
      <div className="tdl-bilan">
        {texteDuBilan(plan, langue)} ·{' '}
        {selonNombre(langue, plan.parallele, 'lots.parallele.un', 'lots.parallele.plusieurs')} ·{' '}
        <span data-testid="tdl-cout-total" title={t('lots.cout.titre')}>
          {t('lots.cout.total', { cout: coutTotalDesLots(plan, couts, langue) })}
        </span>
      </div>
      {plan.raison ? <div className="tdl-raison">{plan.raison}</div> : null}
      {/*
       * Repliés (conv-1171) : 36 lignes « les lots X et Y annoncent le même fichier » poussaient la
       * zone de saisie hors de l'écran. Montrés quel que soit l'état : le plan part sans clic, c'est
       * en cours qu'ils expliquent pourquoi un lot attend.
       */}
      {plan.avertissements.length ? (
        <details className="tdl-avertissements" data-testid="tdl-avertissements">
          <summary>
            {selonNombre(
              langue,
              plan.avertissements.length,
              'lots.avertissements.un',
              'lots.avertissements.plusieurs'
            )}
          </summary>
          <ul>
            {plan.avertissements.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <LotsDuPlan
        plan={plan}
        couts={couts}
        occupe={occupe}
        relancer={(rang) => agir('relancer', rang)}
      />
      {plan.statut === 'attente-accord' ? (
        <div className="tdl-actions">
          <button
            type="button"
            className="tdl-bouton tdl-bouton--principal"
            disabled={occupe}
            onClick={() => agir('accepter')}
          >
            {t('lots.lancer', {
              lots: plan.lots.length,
              parallele: plan.parallele,
              plafond: plan.plafondTours
            })}
          </button>
          <button
            type="button"
            className="tdl-bouton"
            disabled={occupe}
            onClick={() => agir('refuser')}
          >
            {t('lots.refuser')}
          </button>
          <span className="tdl-note">{t('lots.note')}</span>
        </div>
      ) : null}
      {STATUTS_ARRETABLES.has(plan.statut) || STATUTS_REPRENABLES.has(plan.statut) ? (
        <div className="tdl-actions">
          {STATUTS_REPRENABLES.has(plan.statut) ? (
            <button
              type="button"
              className="tdl-bouton tdl-bouton--principal"
              disabled={occupe}
              onClick={() => agir('reprendre')}
            >
              {t('lots.reprendre')}
            </button>
          ) : null}
          {STATUTS_ARRETABLES.has(plan.statut) ? (
            <button
              type="button"
              className="tdl-bouton"
              disabled={occupe}
              onClick={() => agir('arreter')}
            >
              {t('lots.arreter')}
            </button>
          ) : null}
        </div>
      ) : null}
      {erreur ? (
        <div className="tdl-erreur" role="alert">
          {erreur}
        </div>
      ) : null}
    </section>
  )
}
