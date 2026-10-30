import { useEffect, useState } from 'react'
import type {
  GestePlanDeLots,
  PlanDeLots,
  StatutDuPlan,
  VuePlanDeLots
} from '../../../shared/plan-de-lots'
import {
  texteDuBilan,
  useTextesChatFilsEtLots,
  type CleChatFilsEtLots
} from '../textes-ecrans/chat-fils-et-lots'
import { summarizeConversationCost } from './conversation-cost'
import {
  CLE_ETAT,
  INCONNU,
  coutDuFil,
  coutTotalDesLots,
  dureeDuLot,
  lireReduits,
  ouvrirFil,
  planArretable,
  planReprenable,
  relanceAuClic,
  retenirReduits,
  selonNombre,
  useCoutsDesLots,
  type CoutsParFil
} from './lots-mesures'
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
 *
 * `aCoteDeLaFrise` (conv-1315) : le fil s'affiche avec les onglets et la frise de la super conv, qui
 * montrent déjà chaque lot, son état, sa durée, son coût et « Relancer ». Il ne reste ici que ce que
 * la frise n'a pas : titre et statut du plan, raison, mémoire et gestes du plan (Arrêter, Reprendre).
 */

/* Les mesures (coût, durée, relance, réduction retenue) vivent dans `lots-mesures.ts` (conv-1305). */

type GesteDuTableau = Exclude<GestePlanDeLots, 'voir' | 'phrases'>

/* Les libellés de statut de l'écran ; ceux des états sont dans `lots-mesures.ts` (`CLE_ETAT`). */
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
              {lot.modele ? (
                <span
                  className="tdl-modele"
                  data-testid={`tdl-lot-${lot.rang}-modele`}
                  title={t('lots.modele.titre')}
                >
                  {' '}
                  · {lot.modele}
                </span>
              ) : null}
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
  conversationId,
  aCoteDeLaFrise = false
}: {
  conversationId?: string | null
  aCoteDeLaFrise?: boolean
}): React.JSX.Element | null {
  const { t } = useTextesChatFilsEtLots()
  // L'état porte le fil qu'il décrit : à un changement de fil, l'ancien plan n'est jamais affiché.
  const [lu, setLu] = useState<{ fil: string; vue: VuePlanDeLots | null }>({ fil: '', vue: null })
  const [geste, setGeste] = useState<{ fil: string; enCours: boolean; erreur?: string }>({
    fil: '',
    enCours: false
  })
  const [reduits, setReduits] = useState<string[]>(lireReduits)

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
  // Appelé avant tout retour anticipé (règle des hooks) ; seul le fil chef lit les coûts, et la
  // frise lit déjà les siens.
  const couts = useCoutsDesLots(vue?.role === 'chef' && !aCoteDeLaFrise ? vue.plan : null)
  if (!conversationId || !vue) return null
  const { plan } = vue

  if (vue.role === 'enfant') {
    // L'onglet du lot et sa piste disent déjà ce que dirait cette ligne.
    if (aCoteDeLaFrise) return null
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

  /*
   * PLAN REFUSÉ = TABLEAU FERMÉ (conv-1283, 2026-10-29) : après « Refuser », le tableau restait
   * posé au-dessus de la saisie avec son seul statut « refusé » et la liste de lots qui ne partiront
   * jamais. Plus rien n'y est à suivre ni à cliquer : il disparaît.
   */
  if (plan.statut === 'refuse') return null

  const erreur = geste.fil === conversationId ? geste.erreur : undefined
  const occupe = geste.fil === conversationId && geste.enCours
  // À côté de la frise, c'est elle qui se réduit : ce qui reste ici tient déjà sur une ligne.
  const reduit = !aCoteDeLaFrise && reduits.includes(plan.id)
  const basculerReduit = (): void => {
    const suivants = reduit
      ? reduits.filter((id) => id !== plan.id)
      : [...reduits.filter((id) => id !== plan.id), plan.id]
    setReduits(suivants)
    retenirReduits(suivants)
  }
  const agir = (action: GesteDuTableau, lot?: number): void => {
    if (occupe) return
    setGeste({ fil: conversationId, enCours: true })
    const reponse =
      lot === undefined
        ? window.api.plansDeLots(action, conversationId, plan.id)
        : window.api.plansDeLots(action, conversationId, plan.id, lot)
    reponse.then(
      (r) => {
        // Le plan rendu par le geste s'affiche tout de suite (un refus ferme le tableau au clic),
        // sans attendre le signal de rafraîchissement qui le relira de toute façon.
        if (r.ok && r.plan?.id === plan.id) {
          const nouveau = r.plan
          setLu((avant) =>
            avant.fil === conversationId && avant.vue
              ? { fil: avant.fil, vue: { ...avant.vue, plan: nouveau } }
              : avant
          )
        }
        setGeste({ fil: conversationId, enCours: false, ...(r.ok ? {} : { erreur: r.erreur }) })
      },
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
      className={`tdl tdl--${plan.statut}${reduit ? ' tdl--reduit' : ''}${aCoteDeLaFrise ? ' tdl--frise' : ''}`}
      aria-label={t('lots.aria')}
      data-testid="tableau-des-lots"
      data-statut={plan.statut}
      data-reduit={reduit ? 'oui' : undefined}
    >
      <header className="tdl-tete">
        <span className="tdl-kicker">{t('lots.kicker')}</span>
        <strong className="tdl-titre">{plan.titre}</strong>
        <span className={`tdl-statut tdl-statut--${plan.statut}`}>
          {t(CLE_STATUT[plan.statut])}
        </span>
        {aCoteDeLaFrise ? null : (
          <button
            type="button"
            className="tdl-reduire"
            data-testid="tdl-reduire"
            aria-expanded={!reduit}
            title={reduit ? t('lots.agrandir.titre') : t('lots.reduire.titre')}
            onClick={basculerReduit}
          >
            {reduit ? t('lots.agrandir') : t('lots.reduire')}
          </button>
        )}
      </header>
      {reduit ? null : (
        <TableauDeplie
          plan={plan}
          couts={couts}
          occupe={occupe}
          agir={agir}
          aCoteDeLaFrise={aCoteDeLaFrise}
        />
      )}
      {erreur ? (
        <div className="tdl-erreur" role="alert">
          {erreur}
        </div>
      ) : null}
    </section>
  )
}

/** Tout ce qui suit la ligne de titre : masqué d'un bloc quand le tableau est réduit. */
function TableauDeplie({
  plan,
  couts,
  occupe,
  agir,
  aCoteDeLaFrise
}: {
  plan: PlanDeLots
  couts: CoutsParFil
  occupe: boolean
  agir: (action: GesteDuTableau, lot?: number) => void
  aCoteDeLaFrise: boolean
}): React.JSX.Element {
  const { langue, t } = useTextesChatFilsEtLots()
  return (
    <>
      {aCoteDeLaFrise ? null : (
        <div className="tdl-bilan">
          {texteDuBilan(plan, langue)} ·{' '}
          {selonNombre(langue, plan.parallele, 'lots.parallele.un', 'lots.parallele.plusieurs')} ·{' '}
          <span data-testid="tdl-cout-total" title={t('lots.cout.titre')}>
            {t('lots.cout.total', { cout: coutTotalDesLots(plan, couts, langue) })}
          </span>
        </div>
      )}
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
      {/*
       * conv-1284 : ce que chaque lot reçoit en plus de sa demande — le contexte commun et les
       * décisions notées en route (par le chef ou un lot). Repliés, comme les avertissements.
       */}
      {plan.contexte ? (
        <details className="tdl-memoire" data-testid="tdl-contexte">
          <summary>{t('lots.contexte')}</summary>
          <p>{plan.contexte}</p>
        </details>
      ) : null}
      {plan.decisions?.length ? (
        <details className="tdl-memoire" data-testid="tdl-decisions">
          <summary>
            {selonNombre(
              langue,
              plan.decisions.length,
              'lots.decisions.un',
              'lots.decisions.plusieurs'
            )}
          </summary>
          <ul>
            {plan.decisions.map((d) => (
              <li key={`${d.le}-${d.texte}`}>
                {d.texte} <span className="tdl-memoire-de">({d.de})</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {aCoteDeLaFrise ? null : (
        <LotsDuPlan
          plan={plan}
          couts={couts}
          occupe={occupe}
          relancer={(rang) => agir('relancer', rang)}
        />
      )}
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
      {planArretable(plan) || planReprenable(plan) ? (
        <div className="tdl-actions">
          {planReprenable(plan) ? (
            <button
              type="button"
              className="tdl-bouton tdl-bouton--principal"
              disabled={occupe}
              onClick={() => agir('reprendre')}
            >
              {t('lots.reprendre')}
            </button>
          ) : null}
          {planArretable(plan) ? (
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
    </>
  )
}
