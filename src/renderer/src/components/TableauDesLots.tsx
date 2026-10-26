import { useEffect, useState } from 'react'
import {
  LIBELLE_STATUT,
  bilanDuPlan,
  libelleEtat,
  type GestePlanDeLots,
  type LotDuPlan,
  type PlanDeLots,
  type VuePlanDeLots
} from '../../../shared/plan-de-lots'
import { formatDuration, summarizeConversationCost, type CostRow } from './conversation-cost'
import './TableauDesLots.css'

/*
 * SUPER CONVERSATION — LE TABLEAU D'AVANCEMENT DU FIL CHEF (conv-1150, 2026-10-26).
 *
 * Le fil chef est le seul que l'utilisateur suit : ce bloc, posé au-dessus de la zone de saisie,
 * montre chaque lot (à faire, en cours, fait, échec), le fil qui le traite, et le budget de tours.
 * C'est AUSSI là que vit le seul clic qui lance un plan : l'agent dépose, l'utilisateur décide.
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

const heure = (ms: number): string =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Durée du DERNIER lancement du lot (une relance remet `debut` à zéro). */
function dureeDuLot(lot: LotDuPlan): { texte: string; titre?: string } {
  if (!lot.debut) return { texte: INCONNU }
  if (lot.fin)
    return {
      texte: formatDuration(lot.fin - lot.debut) ?? INCONNU,
      titre: `${heure(lot.debut)} → ${heure(lot.fin)}`
    }
  // En cours : l'heure de départ reste vraie sans horloge qui tourne, une durée figée ne le serait pas.
  if (lot.etat === 'en-cours')
    return { texte: `depuis ${heure(lot.debut)}`, titre: 'lancé, pas fini' }
  return { texte: INCONNU, titre: `lancé à ${heure(lot.debut)}, fin non notée` }
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
function coutTotalDesLots(plan: PlanDeLots, couts: CoutsParFil): string {
  const lances = plan.lots.filter((l) => l.fil)
  const mesures = lances.map((l) => coutDuFil(couts, l.fil)).filter((c): c is CostRow[] => !!c)
  if (!mesures.length) return INCONNU
  const total = summarizeConversationCost(mesures.flat()).label
  const sansMesure = lances.length - mesures.length
  return sansMesure ? `${total} · ${sansMesure} lot${sansMesure > 1 ? 's' : ''} sans mesure` : total
}

function LotsDuPlan({ plan, couts }: { plan: PlanDeLots; couts: CoutsParFil }): React.JSX.Element {
  return (
    <ol className="tdl-lots">
      {plan.lots.map((lot) => {
        const duree = dureeDuLot(lot)
        const cout = coutDuFil(couts, lot.fil)
        return (
          <li key={lot.rang} className={`tdl-lot tdl-lot--${lot.etat}`} data-lot-etat={lot.etat}>
            <span className="tdl-pastille">{libelleEtat(lot.etat)}</span>
            <span className="tdl-lot-titre">
              {lot.rang}. {lot.titre}
              {lot.raison ? <span className="tdl-lot-raison"> — {lot.raison}</span> : null}
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
              title={cout ? `Coût du fil ${lot.fil}` : 'Coût non mesuré'}
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
                title={`Ouvrir ${lot.fil}`}
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
        aria-label="Lot d’un plan"
        data-testid="tableau-des-lots"
      >
        <span className="tdl-kicker">
          Lot {vue.rang}/{plan.lots.length}
        </span>
        <span>
          du plan « {plan.titre} », mené par{' '}
          <button type="button" className="tdl-fil" onClick={() => ouvrirFil(plan.chef)}>
            {plan.chef}
          </button>
          {lot ? ` — ${libelleEtat(lot.etat)}` : ''}
        </span>
      </section>
    )
  }

  const bilan = bilanDuPlan(plan)
  const erreur = geste.fil === conversationId ? geste.erreur : undefined
  const occupe = geste.fil === conversationId && geste.enCours
  const agir = (action: Exclude<GestePlanDeLots, 'voir'>): void => {
    if (occupe) return
    setGeste({ fil: conversationId, enCours: true })
    window.api.plansDeLots(action, conversationId, plan.id).then(
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
      aria-label="Plan de lots"
      data-testid="tableau-des-lots"
      data-statut={plan.statut}
    >
      <header className="tdl-tete">
        <span className="tdl-kicker">Plan de lots</span>
        <strong className="tdl-titre">{plan.titre}</strong>
        <span className={`tdl-statut tdl-statut--${plan.statut}`}>
          {LIBELLE_STATUT[plan.statut]}
        </span>
      </header>
      <div className="tdl-bilan">
        {bilan.texte} · {plan.parallele} {plan.parallele > 1 ? 'fils' : 'fil'} en parallèle ·{' '}
        <span
          data-testid="tdl-cout-total"
          title="Somme des fils des lots (fil chef non compris), même calcul que la pastille de coût du fil"
        >
          coût des lots {coutTotalDesLots(plan, couts)}
        </span>
      </div>
      {plan.raison ? <div className="tdl-raison">{plan.raison}</div> : null}
      {plan.statut === 'attente-accord' && plan.avertissements.length ? (
        <ul className="tdl-avertissements">
          {plan.avertissements.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
      <LotsDuPlan plan={plan} couts={couts} />
      {plan.statut === 'attente-accord' ? (
        <div className="tdl-actions">
          <button
            type="button"
            className="tdl-bouton tdl-bouton--principal"
            disabled={occupe}
            onClick={() => agir('accepter')}
          >
            Lancer le plan — {plan.lots.length} lots, {plan.parallele} en parallèle, plafond{' '}
            {plan.plafondTours} tours
          </button>
          <button
            type="button"
            className="tdl-bouton"
            disabled={occupe}
            onClick={() => agir('refuser')}
          >
            Refuser
          </button>
          <span className="tdl-note">
            Chaque lot ouvre un fil et coûte au moins un tour de modèle IA. Rien ne part sans ce
            clic.
          </span>
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
              Reprendre
            </button>
          ) : null}
          {STATUTS_ARRETABLES.has(plan.statut) ? (
            <button
              type="button"
              className="tdl-bouton"
              disabled={occupe}
              onClick={() => agir('arreter')}
            >
              Arrêter (aucun nouveau lot)
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
