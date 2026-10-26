import { useEffect, useState } from 'react'
import {
  LIBELLE_STATUT,
  bilanDuPlan,
  libelleEtat,
  type GestePlanDeLots,
  type PlanDeLots,
  type VuePlanDeLots
} from '../../../shared/plan-de-lots'
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

function LotsDuPlan({ plan }: { plan: PlanDeLots }): React.JSX.Element {
  return (
    <ol className="tdl-lots">
      {plan.lots.map((lot) => (
        <li key={lot.rang} className={`tdl-lot tdl-lot--${lot.etat}`} data-lot-etat={lot.etat}>
          <span className="tdl-pastille">{libelleEtat(lot.etat)}</span>
          <span className="tdl-lot-titre">
            {lot.rang}. {lot.titre}
            {lot.raison ? <span className="tdl-lot-raison"> — {lot.raison}</span> : null}
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
      ))}
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
        {bilan.texte} · {plan.parallele} {plan.parallele > 1 ? 'fils' : 'fil'} en parallèle
      </div>
      {plan.raison ? <div className="tdl-raison">{plan.raison}</div> : null}
      {plan.statut === 'attente-accord' && plan.avertissements.length ? (
        <ul className="tdl-avertissements">
          {plan.avertissements.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
      <LotsDuPlan plan={plan} />
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
