import { memo, useEffect, useRef, useState } from 'react'
import type { LotDuPlan, PlanDeLots } from '../../../shared/plan-de-lots'
import { useTextesChatFilsEtLots } from '../textes-ecrans/chat-fils-et-lots'
import { formatDuration, summarizeConversationCost } from './conversation-cost'
import {
  calculerFrise,
  lotsNonLus,
  planEnMouvement,
  type BarreDeLot,
  type FriseDuPlan
} from './frise-des-lots'
import {
  CLE_ETAT,
  INCONNU,
  coutDuFil,
  coutTotalDesLots,
  dureeDuLot,
  heure,
  lireReduits,
  ouvrirFil,
  planArretable,
  planReprenable,
  relanceAuClic,
  retenirReduits,
  useCoutsDesLots,
  usePhrasesDesLots,
  type CoutsParFil
} from './lots-mesures'
import './SuperConvMosaique.css'

/*
 * LA SUPER CONV DANS LA MOSAÏQUE (conv-1305, 2026-10-30 — /draft, « implémente 5 et 6 »).
 *
 * Avant : un plan de lots ouvrait une fenêtre par fil (le chef, puis chaque lot), et la mosaïque
 * se remplissait de cases sans lien visible entre elles. Choix de l'utilisateur, deux maquettes
 * mélangées :
 *  - la 6 (« Frise qui suit ») : UNE case pour toute la super conv, des onglets Chef · 1 · 2 …
 *    avec la pastille d'état de chaque lot ; la frise est pleine dans l'onglet Chef et se réduit à
 *    la piste du lot dans son onglet ;
 *  - la 5 (« Frise pleine ») : dans l'onglet Chef, les chiffres du plan en tête (faits, tours, coût,
 *    écoulé) et une piste haute par lot — barre sur l'axe des heures, coût, état, durée, ce que dit
 *    le fil, et « Relancer » sur un lot en échec.
 * Les mesures (coût d'un fil, durée, droit de relancer, plan relu) sont celles du tableau des lots,
 * partagées par `lots-mesures.ts` : une seconde façon de les calculer serait une seconde vérité.
 */

export type OngletSuperConv = 'chef' | number

/**
 * Cadence du bandeau tant qu'un lot tourne : la barre avance, et la phrase des lots est relue. Elle
 * n'est PAS relue à chaque mot écrit : chaque relecture redessine la case, saisie comprise, et c'est
 * ce redessin à chaque image qui gelait la mosaïque (conv-1581).
 */
const RELEVE_MS = 10_000

/**
 * L'heure qui fait avancer la barre d'un lot en cours : relue toutes les RELEVE_MS, et SEULEMENT
 * tant qu'un lot tourne (une frise immobile ne réveille personne). Le premier relevé part tout de
 * suite : sans lui, un plan qui redémarre après une longue pause dessinerait « maintenant » dans le
 * passé.
 */
function useMaintenant(enMouvement: boolean): number {
  const [maintenant, setMaintenant] = useState(() => Date.now())
  useEffect(() => {
    if (!enMouvement) return
    const relever = (): void => setMaintenant(Date.now())
    const premier = window.setTimeout(relever, 0)
    const id = window.setInterval(relever, RELEVE_MS)
    return () => {
      window.clearTimeout(premier)
      window.clearInterval(id)
    }
  }, [enMouvement])
  return maintenant
}

const enPourcent = (n: number): string => `${n.toFixed(2)}%`

/** La voie d'un lot : graduations, ligne « maintenant », sa barre ou son attente. */
function Voie({
  frise,
  barre,
  attend
}: {
  frise: FriseDuPlan | null
  barre: BarreDeLot | undefined
  attend: boolean
}): React.JSX.Element {
  return (
    <span className="scm-voie" aria-hidden="true">
      {frise?.graduations.slice(1, -1).map((g) => (
        <i key={g.position} className="scm-graduation" style={{ left: enPourcent(g.position) }} />
      ))}
      {frise?.maintenant !== undefined ? (
        <i className="scm-maintenant-ligne" style={{ left: enPourcent(frise.maintenant) }} />
      ) : null}
      {barre ? (
        <span
          className={`scm-barre scm-etat--${barre.etat}`}
          style={{ left: enPourcent(barre.gauche), width: enPourcent(barre.largeur) }}
        />
      ) : attend && frise ? (
        // Un lot qui attend : un pointillé posé sur « maintenant » (ou en bout d'axe), sans durée.
        <span
          className="scm-barre scm-barre--attente"
          style={{ left: enPourcent(Math.min(frise.maintenant ?? 94, 94)), width: '6%' }}
        />
      ) : null}
    </span>
  )
}

/**
 * LES ONGLETS DE LA SUPER CONV, comme ceux d'un navigateur (conv-1286, 2026-10-30 : « ça doit écrire
 * le titre de la conv et ils doivent être plus visibles, là on voit même pas que c'est cliquable »).
 * Avant : « Chef · 1 · 2 », du texte nu sans fond. Chaque onglet écrit maintenant le titre de sa
 * conv, la pastille d'état reste devant. Ces titres arrivent à part, par la vue : le plan ne connaît
 * que le titre du lot, or une conv se renomme, et un lot n'a pas de conv avant son départ.
 */
export function OngletsSuperConv({
  plan,
  actif,
  nonLus,
  titres,
  onChoisir
}: {
  plan: PlanDeLots
  actif: OngletSuperConv
  nonLus: ReadonlySet<number>
  /** Fil → titre de sa conv. STABLE tant qu'aucun titre ne change : voir `SuperConvDuChat`. */
  titres?: ReadonlyMap<string, string>
  onChoisir: (onglet: OngletSuperConv) => void
}): React.JSX.Element {
  const { t } = useTextesChatFilsEtLots()
  const bandeRef = useRef<HTMLDivElement>(null)
  // Des onglets larges débordent vite, et la barre de défilement est masquée : l'onglet ouvert doit
  // rester visible, même ouvert depuis la liste des fils. Seule la bande défile, jamais la page.
  useEffect(() => {
    const bande = bandeRef.current
    const onglet = bande?.querySelector('[aria-selected="true"]')
    if (!bande || !onglet) return
    const cadre = bande.getBoundingClientRect()
    const place = onglet.getBoundingClientRect()
    if (place.left < cadre.left) bande.scrollLeft -= cadre.left - place.left
    else if (place.right > cadre.right) bande.scrollLeft += place.right - cadre.right
  }, [actif])
  const titreDuChef = titres?.get(plan.chef)?.trim() || t('superConv.onglet.chef')
  return (
    <div
      className="scm-onglets"
      role="tablist"
      aria-label={t('superConv.onglets.aria')}
      ref={bandeRef}
      onWheel={(e) => {
        e.currentTarget.scrollLeft += e.deltaY
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={actif === 'chef'}
        className={`scm-onglet scm-onglet--chef${actif === 'chef' ? ' is-actif' : ''}`}
        data-testid="scm-onglet-chef"
        title={t('superConv.onglet.chef.titre', { titre: titreDuChef })}
        onClick={() => onChoisir('chef')}
      >
        <span className="scm-point" aria-hidden="true" />
        <span className="scm-onglet-titre">{titreDuChef}</span>
      </button>
      {plan.lots.map((lot) => {
        const nonLu = nonLus.has(lot.rang)
        // Un lot sans conv annonce le titre que son fil recevra (`plans-de-lots-app.ts`).
        const libelle =
          (lot.fil && titres?.get(lot.fil)?.trim()) ||
          t('superConv.onglet.lot', {
            rang: lot.rang,
            total: plan.lots.length,
            titre: lot.titre
          })
        const titre = lot.fil
          ? t('superConv.onglet.lot.titre', {
              titre: libelle,
              etat: t(CLE_ETAT[lot.etat])
            }) + (nonLu ? t('superConv.onglet.nonLu') : '')
          : t('superConv.onglet.pasLance', { titre: libelle })
        return (
          <button
            key={lot.rang}
            type="button"
            role="tab"
            aria-selected={actif === lot.rang}
            disabled={!lot.fil}
            className={`scm-onglet scm-etat--${lot.etat}${actif === lot.rang ? ' is-actif' : ''}${nonLu ? ' is-non-lu' : ''}`}
            data-testid={`scm-onglet-${lot.rang}`}
            data-etat={lot.etat}
            title={titre}
            onClick={() => onChoisir(lot.rang)}
          >
            <span className="scm-point" aria-hidden="true" />
            <span className="scm-onglet-titre">{libelle}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Une piste haute de la frise pleine : barre, coût, puis état, durée, phrase et « Relancer ». */
function PistePleine({
  plan,
  lot,
  frise,
  couts,
  phrase,
  occupe,
  onOuvrir,
  onRelancer
}: {
  plan: PlanDeLots
  lot: LotDuPlan
  frise: FriseDuPlan | null
  couts: CoutsParFil
  phrase?: string
  occupe: boolean
  onOuvrir: (rang: number) => void
  onRelancer: (rang: number) => void
}): React.JSX.Element {
  const { langue, t } = useTextesChatFilsEtLots()
  const cout = coutDuFil(couts, lot.fil)
  const duree = dureeDuLot(lot, langue)
  const relance = relanceAuClic(plan, lot, langue)
  const attend = lot.etat === 'a-faire'
  const apres =
    attend && lot.apres?.length ? t('superConv.apres', { rangs: lot.apres.join(', ') }) : ''
  const dit = lot.raison ?? phrase ?? apres
  return (
    <div className={`scm-piste scm-etat--${lot.etat}`} data-testid={`scm-piste-${lot.rang}`}>
      <div className="scm-piste-ligne">
        <button
          type="button"
          className="scm-nom"
          disabled={!lot.fil}
          title={lot.fil ? t('superConv.piste.titre', { rang: lot.rang }) : undefined}
          onClick={() => onOuvrir(lot.rang)}
        >
          {lot.rang} · {lot.titre}
        </button>
        <Voie frise={frise} barre={frise?.barres.get(lot.rang)} attend={attend} />
        <span
          className={`scm-cout${cout ? '' : ' scm-cout--inconnu'}`}
          data-testid={`scm-piste-${lot.rang}-cout`}
          title={cout ? t('lots.cout.duFil', { fil: lot.fil ?? '' }) : t('lots.cout.nonMesure')}
        >
          {cout ? summarizeConversationCost(cout).label : INCONNU}
        </span>
      </div>
      <div className="scm-piste-detail">
        <span className="scm-pastille">{t(CLE_ETAT[lot.etat])}</span>
        <span className="scm-duree" title={duree.titre}>
          {duree.texte}
        </span>
        <span className="scm-phrase" title={dit || undefined}>
          {dit}
        </span>
        {relance ? (
          <button
            type="button"
            className="scm-relancer"
            data-testid={`scm-piste-${lot.rang}-relancer`}
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
            onClick={() => onRelancer(lot.rang)}
          >
            {t('lots.relance.bouton')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** L'axe des heures, aligné sur les voies (même colonne de nom et de coût que les pistes). */
function Axe({ frise }: { frise: FriseDuPlan }): React.JSX.Element {
  return (
    <div className="scm-piste-ligne scm-axe" aria-hidden="true">
      <span className="scm-nom" />
      <span className="scm-voie scm-voie--axe">
        {frise.graduations.map((g, i) => (
          <span
            key={g.position}
            className={`scm-heure${i === 0 ? ' scm-heure--debut' : i === frise.graduations.length - 1 ? ' scm-heure--fin' : ''}`}
            style={{ left: enPourcent(g.position) }}
          >
            {heure(g.ms)}
          </span>
        ))}
      </span>
      <span className="scm-cout" />
    </div>
  )
}

/**
 * LE BANDEAU DE LA CASE, entre les onglets et le fil : la frise pleine dans l'onglet Chef, la piste
 * du lot dans l'onglet d'un lot. Il porte l'horloge, les coûts et le geste « Relancer ».
 */
export function BandeauSuperConv({
  plan,
  onglet,
  gestesDuPlan = false,
  onOuvrirLot
}: {
  plan: PlanDeLots
  onglet: OngletSuperConv
  /**
   * Arrêter et Reprendre dans la ligne des chiffres (conv-1315) : la case de mosaïque n'a aucun autre
   * moyen de piloter le plan. La vue chat les laisse au tableau du bas du fil : deux boutons pour le
   * même geste à l'écran, c'est lequel croire.
   */
  gestesDuPlan?: boolean
  onOuvrirLot: (rang: number) => void
}): React.JSX.Element {
  const { langue, t } = useTextesChatFilsEtLots()
  const maintenant = useMaintenant(planEnMouvement(plan))
  const couts = useCoutsDesLots(plan)
  const phrases = usePhrasesDesLots(plan, maintenant)
  const frise = calculerFrise(plan, maintenant)
  // Même mémoire que le tableau des lots : réduire l'un réduit l'autre, retenu sur le poste.
  const [reduits, setReduits] = useState<string[]>(lireReduits)
  const [geste, setGeste] = useState<{ enCours: boolean; erreur?: string }>({ enCours: false })
  const reduit = reduits.includes(plan.id)
  const basculer = (): void => {
    const suivants = reduit
      ? reduits.filter((id) => id !== plan.id)
      : [...reduits.filter((id) => id !== plan.id), plan.id]
    setReduits(suivants)
    retenirReduits(suivants)
  }
  // Le plan changé revient par le signal du coordinateur (`usePlanDuChef`) : rien à poser ici.
  const agir = (action: 'relancer' | 'arreter' | 'reprendre', rang?: number): void => {
    if (geste.enCours || typeof window.api?.plansDeLots !== 'function') return
    setGeste({ enCours: true })
    window.api.plansDeLots(action, plan.chef, plan.id, rang).then(
      (r) => setGeste({ enCours: false, ...(r.ok ? {} : { erreur: r.erreur }) }),
      (e: unknown) =>
        setGeste({ enCours: false, erreur: e instanceof Error ? e.message : String(e) })
    )
  }

  if (onglet !== 'chef') {
    const lot = plan.lots.find((l) => l.rang === onglet)
    if (!lot) return <></>
    const cout = coutDuFil(couts, lot.fil)
    const duree = dureeDuLot(lot, langue)
    return (
      <section
        className={`scm-bandeau scm-bandeau--lot scm-etat--${lot.etat}`}
        aria-label={t('superConv.frise.aria')}
        data-testid="scm-piste-reduite"
      >
        <div className="scm-piste-ligne">
          <span className="scm-nom scm-nom--lot">
            {lot.rang} · {lot.titre}
          </span>
          <Voie frise={frise} barre={frise?.barres.get(lot.rang)} attend={lot.etat === 'a-faire'} />
        </div>
        <div className="scm-piste-detail">
          <span className="scm-pastille">{t(CLE_ETAT[lot.etat])}</span>
          <span className="scm-duree" title={duree.titre}>
            {duree.texte}
          </span>
          {lot.apres?.length ? (
            <span className="scm-duree">
              {t('superConv.apres', { rangs: lot.apres.join(', ') })}
            </span>
          ) : null}
          <span className="scm-duree">
            {cout ? summarizeConversationCost(cout).label : INCONNU}
          </span>
          {lot.raison ? <span className="scm-phrase">{lot.raison}</span> : null}
        </div>
      </section>
    )
  }

  const faits = plan.lots.filter((l) => l.etat === 'fait').length
  return (
    <section
      className={`scm-bandeau scm-bandeau--chef${reduit ? ' is-reduit' : ''}`}
      aria-label={t('superConv.frise.aria')}
      data-testid="scm-frise"
      data-reduit={reduit ? 'oui' : undefined}
    >
      <div className="scm-chiffres">
        <span className="scm-kicker">{t('lots.kicker')}</span>
        <span className="scm-chiffre" data-testid="scm-chiffre-faits">
          <b>
            {faits}/{plan.lots.length}
          </b>{' '}
          {t('superConv.chiffre.faits')}
        </span>
        <span className="scm-chiffre">
          <b>
            {plan.toursLances}/{plan.plafondTours}
          </b>{' '}
          {t('superConv.chiffre.tours')}
        </span>
        <span className="scm-chiffre" title={t('lots.cout.titre')}>
          <b>{coutTotalDesLots(plan, couts, langue)}</b> {t('superConv.chiffre.cout')}
        </span>
        <span className="scm-chiffre">
          <b>{frise ? (formatDuration(frise.ecoule) ?? INCONNU) : INCONNU}</b>{' '}
          {t('superConv.chiffre.ecoule')}
        </span>
        {frise?.maintenant !== undefined ? (
          <span className="scm-maintenant">
            {t('superConv.maintenant', { heure: heure(maintenant) })}
          </span>
        ) : null}
        <span className="scm-actions">
          {gestesDuPlan && planReprenable(plan) ? (
            <button
              type="button"
              className="scm-geste scm-geste--principal"
              data-testid="scm-reprendre"
              disabled={geste.enCours}
              onClick={() => agir('reprendre')}
            >
              {t('lots.reprendre')}
            </button>
          ) : null}
          {gestesDuPlan && planArretable(plan) ? (
            <button
              type="button"
              className="scm-geste"
              data-testid="scm-arreter"
              disabled={geste.enCours}
              onClick={() => agir('arreter')}
            >
              {t('lots.arreter')}
            </button>
          ) : null}
          <button
            type="button"
            className="scm-reduire"
            data-testid="scm-reduire"
            aria-expanded={!reduit}
            title={reduit ? t('lots.agrandir.titre') : t('lots.reduire.titre')}
            onClick={basculer}
          >
            {reduit ? t('lots.agrandir') : t('lots.reduire')}
          </button>
        </span>
      </div>
      {reduit ? null : (
        <div className="scm-pistes">
          {frise ? (
            <Axe frise={frise} />
          ) : (
            <div className="scm-vide">{t('superConv.pasEncore')}</div>
          )}
          {plan.lots.map((lot) => (
            <PistePleine
              key={lot.rang}
              plan={plan}
              lot={lot}
              frise={frise}
              couts={couts}
              phrase={phrases[lot.rang]}
              occupe={geste.enCours}
              onOuvrir={onOuvrirLot}
              onRelancer={(rang) => agir('relancer', rang)}
            />
          ))}
        </div>
      )}
      {geste.erreur ? (
        <div className="scm-erreur" role="alert">
          {geste.erreur}
        </div>
      ) : null}
    </section>
  )
}

/**
 * LA MÊME SUPER CONV DANS LE PANNEAU DE CHAT (conv-1315, 2026-10-30 : « quand je suis sur une conv
 * chef ça doit l'afficher comme la vue mosaïque dans la vue chat »). Mêmes onglets et même frise que
 * la case de mosaïque : la frise sous l'en-tête du chat, les onglets dans la bande des boutons de
 * fenêtre (SuperConvMosaique.css) ; le fil et la saisie restent ceux du panneau.
 * Monter une vraie fenêtre de mosaïque à sa place aurait retiré au chef ce qui n'existe que dans le
 * panneau : l'autorisation de production, Ctrl+F, Reprendre, le dépôt de fichiers, « Arrêter ».
 *
 * L'onglet ouvert est le fil actif du chat : ouvrir un lot, c'est ouvrir son fil. `memo` : ChatView
 * se redessine à chaque mot d'un flux, et rien ici ne dépend du texte en cours (voir RELEVE_MS). Les
 * `titres` restent donc la même Map tant qu'aucun titre ne change : une Map neuve à chaque rendu
 * annulerait le `memo`.
 */
export const SuperConvDuChat = memo(function SuperConvDuChat({
  plan,
  onglet,
  titres
}: {
  plan: PlanDeLots
  onglet: OngletSuperConv
  /** Voir `OngletsSuperConv` : fil → titre de sa conv. */
  titres?: ReadonlyMap<string, string>
}): React.JSX.Element {
  // Un lot fini APRÈS l'arrivée sur la super conv et pas encore regardé garde son onglet doré.
  const [ouvertLe] = useState(() => Date.now())
  const [vusLe, setVusLe] = useState<Readonly<Record<number, number>>>({})
  const choisir = (suivant: OngletSuperConv): void => {
    const maintenant = Date.now()
    setVusLe((vus) => ({
      ...vus,
      ...(typeof onglet === 'number' ? { [onglet]: maintenant } : {}),
      ...(typeof suivant === 'number' ? { [suivant]: maintenant } : {})
    }))
    const fil = suivant === 'chef' ? plan.chef : plan.lots.find((l) => l.rang === suivant)?.fil
    if (fil) ouvrirFil(fil)
  }
  return (
    <div className="scm-chat" data-testid="scm-chat">
      <OngletsSuperConv
        plan={plan}
        actif={onglet}
        nonLus={lotsNonLus(plan, vusLe, ouvertLe, onglet)}
        titres={titres}
        onChoisir={choisir}
      />
      <BandeauSuperConv plan={plan} onglet={onglet} onOuvrirLot={choisir} />
    </div>
  )
})
