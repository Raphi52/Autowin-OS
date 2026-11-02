import { memo, useEffect, useState } from 'react'
import type { LotDuPlan, PlanDeLots } from '../../../shared/plan-de-lots'
import { useTextesChatFilsEtLots } from '../textes-ecrans/chat-fils-et-lots'
import { formatDuration, summarizeConversationCost } from './conversation-cost'
import { enchainementDuLot, rangsLisibles } from './enchainement-des-lots'
import { calculerFrise, lotsNonLus, planEnMouvement } from './frise-des-lots'
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
  useAnciensPlansDuChef,
  useCoutsDesLots,
  usePhrasesDesLots,
  type CoutsParFil
} from './lots-mesures'
import { Spinner } from './Spinner'
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
 *
 * LES COULOIRS (conv-1376, 2026-10-31 — /draft, « Implémenter la 1 · Couloirs ») remplacent les
 * pistes de la frise pleine. Une piste par lot donnait sept lignes presque vides et une barre sans
 * rien dessus : c'était laid, et l'œil devait relier chaque barre à son nom, à gauche. Le lot est
 * maintenant un bloc posé sur l'axe, titre et état dedans ; ceux qui n'ont pas démarré passent dans
 * la file, dessous. La vue d'un lot garde sa piste réduite, avec le même remplissage que les blocs.
 * Depuis conv-1387 (« faut un lot par ligne »), chaque lot lancé a sa ligne.
 *
 * PLUS D'AXE DES HEURES (conv-1396, 2026-10-31 : « pour ce bloc la disposition est pourrie, enlève le
 * côté timeline, prends toute la longueur, mais écris la durée et quelle étape se lance après laquelle
 * et tout ce qu'on avait »). Posé sur l'axe d'un plan de 13 h, un lot de 40 min devenait un bloc de
 * 70 px au titre coupé. Chaque lot, lancé ou non, a maintenant toute la largeur, en colonnes alignées
 * d'une ligne à l'autre (`LigneDeLot`) : ce que l'axe disait par la position s'écrit — heures, durée,
 * et le lot après lequel il part (`enchainement-des-lots.ts`).
 * La vue d'un lot a perdu sa voie à son tour (conv-1396, même jour : « remplace aussi la petite barre
 * de temps par la même ligne que dans la liste du chef ») : « ← Retour », puis la ligne du lot telle
 * que le chef la montre, titre compris mais sans lien, puisque le lot est déjà ouvert.
 *
 * PLUS D'ONGLETS (conv-1387, 2026-10-31 : « je veux pas d'onglets, je veux que cliquer sur une ligne
 * m'emmène vers la conv en question, et qu'après il y ait un bouton retour »). La frise est le seul
 * chemin vers les lots : une ligne ouvre un lot, « ← Retour » ramène au chef. Ce que disaient les
 * onglets (question, spinner, fini pas lu) est passé sur ces lignes. `OngletSuperConv` garde son nom :
 * il dit quelle vue est ouverte, le chef ou un lot.
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

/**
 * Le repère d'une ligne de lot, devant son titre. Un lot qui travaille porte LE spinner de l'app,
 * comme sa ligne dans la liste des fils (conv-1330). Une question attendue passe devant : c'est ce qui
 * réclame l'utilisateur (conv-1381). Un autre état se lit déjà sur la ligne : rien à ajouter.
 */
function RepereDeLot({
  lot,
  question
}: {
  lot: LotDuPlan
  question: boolean
}): React.JSX.Element | null {
  if (!question && lot.etat !== 'en-cours') return null
  return (
    <span className="scm-repere">
      {question ? (
        <span className="conversation-state is-asking" aria-hidden="true" />
      ) : (
        <Spinner size={13} />
      )}
    </span>
  )
}

/** Ce que dit la colonne « enchaînement » d'un lot, et son infobulle. */
function texteDEnchainement(
  plan: PlanDeLots,
  lot: LotDuPlan,
  t: ReturnType<typeof useTextesChatFilsEtLots>['t']
): { texte: string; titre: string } {
  const e = enchainementDuLot(plan, lot)
  if (e.genre === 'apres')
    return {
      texte: t('superConv.apres', { rangs: rangsLisibles(e.rangs) }),
      titre: t('superConv.apres.titre', { rangs: e.rangs.join(', ') })
    }
  if (e.genre === 'relais')
    return {
      texte: t('superConv.relais', { rang: e.rang }),
      titre: t('superConv.relais.titre', { rang: e.rang })
    }
  if (e.genre === 'libre') return { texte: t('superConv.libre'), titre: t('superConv.libre.titre') }
  return { texte: t('superConv.enFile'), titre: t('superConv.enFile.titre', { n: plan.parallele }) }
}

/**
 * Un lot, lancé ou non, sur toute la largeur (conv-1396). Ses colonnes s'alignent sur celles des
 * autres lignes (sous-grille, SuperConvMosaique.css) : titre, état, enchaînement, heures, durée,
 * coût, ce que dit le fil, et « Relancer » s'il y a lieu. Le titre est un bouton étiré sur toute la
 * ligne : c'est la ligne entière qu'on clique, et son infobulle redonne ce que la largeur a coupé.
 * Un lot qui tourne compte sa durée sur l'horloge du bandeau (`useMaintenant`), relevée toutes les
 * RELEVE_MS : la durée n'est donc jamais figée.
 * Sans `onOuvrir` (la vue du lot lui-même), le titre n'est plus un bouton : il n'y a rien à ouvrir.
 */
function LigneDeLot({
  plan,
  lot,
  maintenant,
  couts,
  phrase,
  question,
  nonLu,
  occupe,
  onOuvrir,
  onRelancer
}: {
  plan: PlanDeLots
  lot: LotDuPlan
  maintenant: number
  couts: CoutsParFil
  phrase?: string
  question: boolean
  nonLu: boolean
  occupe: boolean
  onOuvrir?: (rang: number) => void
  onRelancer: (rang: number) => void
}): React.JSX.Element {
  const { langue, t } = useTextesChatFilsEtLots()
  const cout = coutDuFil(couts, lot.fil)
  const libelleCout = cout ? summarizeConversationCost(cout).label : ''
  const mot = t(CLE_ETAT[lot.etat])
  const dit = lot.raison ?? phrase ?? ''
  const enchainement = texteDEnchainement(plan, lot, t)
  const enCours = lot.etat === 'en-cours'
  const heures = lot.debut
    ? `${heure(lot.debut)} → ${lot.fin ? heure(lot.fin) : enCours ? '…' : INCONNU}`
    : ''
  const fin = lot.fin ?? (enCours ? maintenant : undefined)
  const duree = lot.debut && fin ? (formatDuration(fin - lot.debut) ?? INCONNU) : INCONNU
  const titreDuLot = `${lot.rang} · ${lot.titre}`
  const infobulle = [
    titreDuLot,
    [mot, enchainement.texte, heures, lot.debut ? duree : '', libelleCout]
      .filter(Boolean)
      .join(' · '),
    question ? t('superConv.ligne.question') : nonLu ? t('superConv.ligne.nonLu') : '',
    dit,
    onOuvrir && lot.fil ? t('superConv.piste.titre', { rang: lot.rang }) : ''
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <div
      role="listitem"
      className={`scm-piste scm-bloc scm-etat--${lot.etat}${nonLu ? ' is-non-lu' : ''}`}
      data-testid={`scm-piste-${lot.rang}`}
    >
      {onOuvrir ? (
        <button
          type="button"
          className="scm-nom"
          disabled={!lot.fil}
          title={infobulle}
          onClick={() => onOuvrir(lot.rang)}
        >
          <RepereDeLot lot={lot} question={question} />
          {titreDuLot}
        </button>
      ) : (
        <span className="scm-nom" title={infobulle}>
          <RepereDeLot lot={lot} question={question} />
          {titreDuLot}
        </span>
      )}
      <span className="scm-pastille">{mot}</span>
      <span className="scm-enchainement" data-testid={`scm-piste-${lot.rang}-enchainement`}>
        {enchainement.texte}
      </span>
      <span className="scm-heures">{heures}</span>
      <span
        className="scm-duree"
        data-testid={`scm-piste-${lot.rang}-duree`}
        title={dureeDuLot(lot, langue).titre}
      >
        {lot.debut ? duree : ''}
      </span>
      <span className="scm-cout" data-testid={`scm-piste-${lot.rang}-cout`}>
        {libelleCout}
      </span>
      <span className="scm-phrase">{dit}</span>
      <span className="scm-ligne-geste">
        <BoutonRelance plan={plan} lot={lot} occupe={occupe} onRelancer={onRelancer} />
      </span>
    </div>
  )
}

/**
 * « Relancer le 5 », au bout de la ligne de son lot (conv-1396 ; avant, dans la file, qu'un bloc
 * étroit ne pouvait pas porter). Un bouton par lot relançable, un échec comme un lot interrompu ou qui
 * attend le chef (`relanceAuClic`, conv-1284).
 */
function BoutonRelance({
  plan,
  lot,
  occupe,
  onRelancer
}: {
  plan: PlanDeLots
  lot: LotDuPlan
  occupe: boolean
  onRelancer: (rang: number) => void
}): React.JSX.Element | null {
  const { langue, t } = useTextesChatFilsEtLots()
  const relance = relanceAuClic(plan, lot, langue)
  if (!relance) return null
  return (
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
      {t('superConv.relancerLot', { rang: lot.rang })}
    </button>
  )
}

/**
 * LES PLANS PRÉCÉDENTS DU CHEF (conv-1394, 2026-10-31 : « masque aussi les lots des anciens plans d'un
 * même chef dans la liste de gauche, et rends-les accessibles depuis le bloc de la conv chef »). Leurs
 * lots n'ont plus de ligne dans la liste : ce bloc est leur seul chemin. Une ligne par ancien plan, le
 * plus récent d'abord, un bouton par lot qui a un fil. Mêmes classes que la file : un ancien lot se lit
 * comme un lot en attente, avec son état et l'animation d'une question.
 */
function PlansPrecedents({
  chef,
  questions
}: {
  chef: string
  questions?: ReadonlySet<string>
}): React.JSX.Element | null {
  const { t } = useTextesChatFilsEtLots()
  const anciens = useAnciensPlansDuChef(chef)
  if (anciens.length === 0) return null
  return (
    <>
      {anciens.map((ancien) => (
        <div key={ancien.id} className="scm-file" data-testid={`scm-ancien-${ancien.id}`}>
          <span className="scm-file-titre">{t('superConv.anciens', { titre: ancien.titre })}</span>
          {ancien.lots.map((lot) => {
            const fil = lot.fil
            if (!fil) return null
            return (
              <span
                key={lot.rang}
                className={`scm-piste scm-file-lot scm-etat--${lot.etat}`}
                data-testid={`scm-ancien-${ancien.id}-${lot.rang}`}
              >
                <button
                  type="button"
                  className="scm-nom"
                  title={t('superConv.anciens.ouvrir', { rang: lot.rang, titre: ancien.titre })}
                  onClick={() => ouvrirFil(fil)}
                >
                  <RepereDeLot lot={lot} question={Boolean(questions?.has(fil))} />
                  {lot.rang} · {lot.titre}
                </button>
                <span className="scm-pastille">{t(CLE_ETAT[lot.etat])}</span>
              </span>
            )
          })}
        </div>
      ))}
    </>
  )
}

/**
 * LE BANDEAU DE LA CASE, au-dessus du fil : sur le chef, la frise pleine, une ligne cliquable par lot ;
 * sur un lot, sa piste et « ← Retour ». Il porte l'horloge, les coûts et le geste « Relancer ».
 */
export function BandeauSuperConv({
  plan,
  onglet,
  gestesDuPlan = false,
  questions,
  nonLus,
  onOuvrirLot,
  onRetour
}: {
  plan: PlanDeLots
  onglet: OngletSuperConv
  /**
   * Arrêter et Reprendre dans la ligne des chiffres (conv-1315) : la case de mosaïque n'a aucun autre
   * moyen de piloter le plan. La vue chat les laisse au tableau du bas du fil : deux boutons pour le
   * même geste à l'écran, c'est lequel croire.
   */
  gestesDuPlan?: boolean
  /** Les fils de lot qui attendent ta réponse (conv-1381). STABLE d'un rendu à l'autre. */
  questions?: ReadonlySet<string>
  /** Les lots finis depuis ton dernier passage (conv-1286), par rang. */
  nonLus?: ReadonlySet<number>
  onOuvrirLot: (rang: number) => void
  /** « ← Retour », sur un lot : revient au chef. */
  onRetour: () => void
}): React.JSX.Element {
  const { langue, t } = useTextesChatFilsEtLots()
  const maintenant = useMaintenant(planEnMouvement(plan))
  const attendTaReponse = (lot: LotDuPlan): boolean => Boolean(lot.fil && questions?.has(lot.fil))
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
    return (
      <section
        className="scm-bandeau scm-bandeau--lot"
        aria-label={t('superConv.frise.aria')}
        data-testid="scm-piste-reduite"
      >
        <div className="scm-lot-tete">
          <button
            type="button"
            className="scm-retour"
            data-testid="scm-retour"
            title={t('superConv.retour.titre', { titre: plan.titre })}
            onClick={onRetour}
          >
            <span aria-hidden="true">←</span> {t('superConv.retour')}
          </button>
          <div className="scm-pistes">
            <div
              role="list"
              className={`scm-lignes${relanceAuClic(plan, lot, langue) ? ' scm-lignes--relance' : ''}`}
            >
              <LigneDeLot
                plan={plan}
                lot={lot}
                maintenant={maintenant}
                couts={couts}
                phrase={phrases[lot.rang]}
                question={attendTaReponse(lot)}
                nonLu={false}
                occupe={geste.enCours}
                onRelancer={(rang) => agir('relancer', rang)}
              />
            </div>
          </div>
        </div>
        {geste.erreur ? (
          <div className="scm-erreur" role="alert">
            {geste.erreur}
          </div>
        ) : null}
      </section>
    )
  }

  const faits = plan.lots.filter((l) => l.etat === 'fait').length
  const relancables = plan.lots.some((l) => relanceAuClic(plan, l, langue))
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
          <div
            role="list"
            className={`scm-lignes${relancables ? ' scm-lignes--relance' : ''}`}
            data-testid="scm-lignes"
          >
            {[...plan.lots]
              .sort((a, b) => a.rang - b.rang)
              .map((lot) => (
                <LigneDeLot
                  key={lot.rang}
                  plan={plan}
                  lot={lot}
                  maintenant={maintenant}
                  couts={couts}
                  phrase={phrases[lot.rang]}
                  question={attendTaReponse(lot)}
                  nonLu={Boolean(nonLus?.has(lot.rang))}
                  occupe={geste.enCours}
                  onOuvrir={onOuvrirLot}
                  onRelancer={(rang) => agir('relancer', rang)}
                />
              ))}
          </div>
          <PlansPrecedents chef={plan.chef} questions={questions} />
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
 * chef ça doit l'afficher comme la vue mosaïque dans la vue chat »). Même frise que la case de
 * mosaïque, sous l'en-tête du chat ; le fil et la saisie restent ceux du panneau.
 * Monter une vraie fenêtre de mosaïque à sa place aurait retiré au chef ce qui n'existe que dans le
 * panneau : l'autorisation de production, Ctrl+F, Reprendre, le dépôt de fichiers, « Arrêter ».
 *
 * La vue ouverte est le fil actif du chat : ouvrir un lot, c'est ouvrir son fil. `memo` : ChatView
 * se redessine à chaque mot d'un flux, et rien ici ne dépend du texte en cours (voir RELEVE_MS). Les
 * `questions` restent donc le même Set tant qu'aucune ne change : un Set neuf à chaque rendu
 * annulerait le `memo`.
 */
export const SuperConvDuChat = memo(function SuperConvDuChat({
  plan,
  onglet,
  questions
}: {
  plan: PlanDeLots
  onglet: OngletSuperConv
  /** Voir `BandeauSuperConv` : les fils de lot qui attendent ta réponse. */
  questions?: ReadonlySet<string>
}): React.JSX.Element {
  // Un lot fini APRÈS l'arrivée sur la super conv et pas encore regardé garde sa ligne dorée.
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
      <BandeauSuperConv
        plan={plan}
        onglet={onglet}
        questions={questions}
        nonLus={lotsNonLus(plan, vusLe, ouvertLe, onglet)}
        onOuvrirLot={choisir}
        onRetour={() => choisir('chef')}
      />
    </div>
  )
})
