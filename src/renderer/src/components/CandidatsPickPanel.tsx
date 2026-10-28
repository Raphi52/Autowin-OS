import React, { useEffect, useRef, useState } from 'react'
import { type CandidatAffiche, numerosDesCandidats } from './veille-candidats-message'
import {
  emojiType,
  libelleVoie,
  MAX_PISTES_PAR_LOT,
  motifDuLot,
  planDeLancement,
  redigerPromptsDuPlan,
  resumeDuPlan,
  selectionAutoDepuisScout,
  voieDeLaPiste
} from './veille-candidats-message'
import './CandidatsPickPanel.css'
import { useTextesChatDecisions } from '../textes-ecrans/chat-decisions'

/**
 * Une pastille muette ne dit rien : chaque couleur porte son libelle en infobulle et en aria.
 * « Impact » et « Effort » se disent pareil en anglais : seul le niveau se traduit.
 */
const LIBELLE_BANDE = {
  g: 'candidats.bande.g',
  y: 'candidats.bande.y',
  r: 'candidats.bande.r'
} as const

/** Au-dela du 10e candidat, la cascade ne decale plus : 30 lignes n'attendent pas 1,2 s. */
const RANG_MAX_CASCADE = 10

/**
 * Le panneau de SÉLECTION sous un message de scout : une case par candidat, une ligne DÉPLIABLE
 * (tous les détails : preuve, ancrage, date, type…), et un bouton qui envoie le prompt /frame
 * parfait sur les lignes cochées (demandes utilisateur du 14/08).
 *
 * Contrôles NATIFS de l'app — jamais dans le HTML du modèle : le sanitizeur refuse input/button
 * par conception (anti-hameçonnage). Style « transparence totale » : aucun fond, filets fins.
 */
export function CandidatsPickPanel({
  candidats,
  texteScout,
  autoLancer,
  onPick
}: {
  candidats: CandidatAffiche[]
  /** Le texte du scout : s'il déclare `CIBLE:`/`CIBLES:`, ce choix pré-coche les cases. */
  texteScout?: string
  /**
   * LE CLIC AUTOMATIQUE. Vrai = le panneau appuie lui-meme sur le bouton avec la selection decidee
   * par le scout (mode auto). Ne part JAMAIS sans declaration ecrite : sans `CIBLE:` ni section
   * `## Cible`, ou sur une declaration vide, rien n'est envoye et le bouton attend un clic humain.
   */
  autoLancer?: boolean
  /**
   * Le lancement : le message du PREMIER lot, et ceux des lots suivants quand la sélection en compte
   * plusieurs — à envoyer l'un après l'autre, un par tour (conv-1080). Une sélection d'un seul lot
   * n'a pas de `suite`.
   */
  onPick?: (prompt: string, suite?: readonly string[]) => void
}): React.JSX.Element {
  const { t } = useTextesChatDecisions()
  /*
   * QUI COCHE ? L'agent quand il a DÉCLARÉ son choix, l'habitude sinon.
   *
   * Le scout qui écrit `CIBLES: 1, 3` a désigné ses candidats : les cases suivent sa décision, et le
   * bandeau au-dessus dit lesquels sont gardés — un choix invisible serait le même défaut qu'une
   * rubrique lue comme un ordre. Sans déclaration : tout coché, comme avant (le geste courant est
   * « enchaîne sur tout », décocher est l'exception). Le bouton, lui, reste toujours à cliquer.
   */
  const auto = selectionAutoDepuisScout(candidats, texteScout)
  // Le numéro du tableau du scout — celui que sa cible désigne, même sur un tableau retrié (conv-1074).
  const numeros = numerosDesCandidats(candidats)
  const [coches, setCoches] = useState<ReadonlySet<number>>(
    auto ?? new Set(candidats.map((_, i) => i))
  )
  const [deplies, setDeplies] = useState<ReadonlySet<number>>(new Set())
  const basculer = (index: number): void => {
    setCoches((courant) => {
      const suivant = new Set(courant)
      if (suivant.has(index)) suivant.delete(index)
      else suivant.add(index)
      return suivant
    })
  }
  const deplier = (index: number): void => {
    setDeplies((courant) => {
      const suivant = new Set(courant)
      if (suivant.has(index)) suivant.delete(index)
      else suivant.add(index)
      return suivant
    })
  }
  const tous = coches.size === candidats.length
  const retenus = candidats.flatMap((_, index) => (coches.has(index) ? [index] : []))
  const selection = retenus.map((index) => candidats[index]!)
  /*
   * UN SEUL BOUTON, LE WORKFLOW INTELLIGENT (conv-1080) : « ça doit retenir les candidats puis lancer
   * le workflow intelligent ». Le choix se fait PISTE PAR PISTE (« fais le truc parfait », même fil) :
   * chaque ligne porte sa voie et sa raison, les pistes d'une même voie partent ensemble par lots de
   * `MAX_PISTES_PAR_LOT`, lancés l'un après l'autre. Le bloc au-dessus du bouton dit le plan en
   * direct — un choix fait à la place de l'utilisateur ne doit jamais être invisible.
   */
  const voies = candidats.map(voieDeLaPiste)
  const plan = planDeLancement(selection)
  const lancer = (prompts: readonly string[]): void => {
    const [premier, ...suite] = prompts
    if (premier === undefined) return
    if (suite.length > 0) onPick?.(premier, suite)
    else onPick?.(premier)
  }
  /*
   * L'AGENT APPUIE SUR LE BOUTON. Une seule fois par panneau (`lanceRef`) : un re-rendu ne renvoie
   * rien. Condition stricte — le mode auto est allume ET le scout a ecrit son choix ET ce choix
   * retient au moins une ligne. Un travail jusqu'au commit ne part pas d'un defaut. Le plan est celui
   * que le workflow intelligent tire de la sélection du scout — la même règle que le bouton.
   */
  const choixAuto = auto === null ? [] : candidats.filter((_, index) => auto.has(index))
  const planAuto = planDeLancement(choixAuto)
  const lanceRef = useRef(false)
  useEffect(() => {
    if (!autoLancer || lanceRef.current) return
    if (choixAuto.length === 0) return
    lanceRef.current = true
    lancer(redigerPromptsDuPlan(planAuto))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLancer])
  return (
    <div className="cpick" data-testid="candidats-pick">
      <div className="cpick-tete">
        <label className="cpick-tout">
          <input
            type="checkbox"
            checked={tous}
            onChange={() =>
              setCoches(tous ? new Set() : new Set(candidats.map((_, index) => index)))
            }
          />
          {t('candidats.tout')}
        </label>
        {auto !== null && (
          <span className="cpick-auto" data-testid="cpick-auto">
            {auto.size === 0
              ? t('candidats.aucunRetenu')
              : t(auto.size > 1 ? 'candidats.choix.plusieurs' : 'candidats.choix.un', {
                  n: auto.size,
                  total: candidats.length,
                  suite: autoLancer
                    ? t('candidats.lanceAuto', { plan: resumeDuPlan(planAuto) })
                    : t('candidats.aToiDeLancer')
                })}
          </span>
        )}
        <span className="cpick-compte">
          {t(coches.size > 1 ? 'candidats.compte.plusieurs' : 'candidats.compte.un', {
            coches: coches.size,
            total: candidats.length
          })}
        </span>
      </div>
      {candidats.map((candidat, index) => (
        <div
          key={`${candidat.url ?? candidat.titre}-${index}`}
          className="cpick-item"
          data-testid="cpick-ligne"
          style={{ '--i': Math.min(index, RANG_MAX_CASCADE) } as React.CSSProperties}
        >
          <div className="cpick-ligne">
            <input type="checkbox" checked={coches.has(index)} onChange={() => basculer(index)} />
            <button
              type="button"
              className="cpick-deplier"
              data-testid="cpick-deplier"
              onClick={() => deplier(index)}
              aria-expanded={deplies.has(index)}
              title={
                deplies.has(index) ? t('candidats.replierDetails') : t('candidats.deplierDetails')
              }
            >
              {deplies.has(index) ? '▾' : '▸'}
            </button>
            <span className="cpick-type" title={candidat.type ?? t('candidats.natureInconnue')}>
              {emojiType(candidat.type)}
            </span>
            <span className="cpick-num" data-testid="cpick-num">
              {numeros[index]}.
            </span>
            <span className="cpick-titre" onClick={() => deplier(index)}>
              {candidat.titre}
            </span>
            <span
              className={`cpick-voie-piste cpick-voie-${voies[index]!.voie}`}
              data-testid="cpick-voie-piste"
              data-voie={voies[index]!.voie}
              title={voies[index]!.motif}
              aria-label={t(
                voies[index]!.voie === 'directe'
                  ? 'candidats.voie.directeAria'
                  : 'candidats.voie.aCadrerAria',
                { motif: voies[index]!.motif }
              )}
            >
              {/* « direct » se dit pareil en anglais. */}
              {voies[index]!.voie === 'directe' ? 'direct' : t('candidats.voie.aCadrer')}
            </span>
            {/* La valeur de la ligne : une note quand le scout en donne une, sinon les deux
                pastilles Impact/Effort — un scout au format Impact/Effort n'a AUCUN nombre.
                Le chiffre seul : la jauge qui le doublait est retirée (« ça sert à rien », conv-1198). */}
            {candidat.pertinence !== undefined && (
              <span className="cpick-score">{candidat.pertinence}</span>
            )}
            {candidat.pertinence === undefined && (candidat.impact || candidat.effort) && (
              <span className="cpick-pastilles" data-testid="cpick-pastilles">
                {candidat.impact && (
                  <span
                    className={`cpick-dot cpick-dot-${candidat.impact}`}
                    title={`Impact ${t(LIBELLE_BANDE[candidat.impact])}`}
                    aria-label={`Impact ${t(LIBELLE_BANDE[candidat.impact])}`}
                  />
                )}
                {candidat.effort && (
                  <span
                    className={`cpick-dot cpick-dot-${candidat.effort}`}
                    title={`Effort ${t(LIBELLE_BANDE[candidat.effort])}`}
                    aria-label={`Effort ${t(LIBELLE_BANDE[candidat.effort])}`}
                  />
                )}
              </span>
            )}
          </div>
          {deplies.has(index) && (
            <div className="cpick-details fade-in" data-testid="cpick-details">
              {/* Trois blocs, un par QUESTION — c'est tout (demande du 14/08). Les anciens
                  candidats sans what/why/how retombent sur ce que leur charge portait. */}
              <div className="cpick-q">
                <b>{t('candidats.quoi')}</b>
                <p>{candidat.what ?? candidat.titre}</p>
              </div>
              <div className="cpick-q">
                <b>{t('candidats.pourquoi')}</b>
                <p>
                  {candidat.why ??
                    (candidat.citation
                      ? t('candidats.preuveLue', { citation: candidat.citation })
                      : '—')}
                </p>
              </div>
              <div className="cpick-q">
                <b>{t('candidats.comment')}</b>
                <p>
                  {candidat.how ??
                    (candidat.url
                      ? t('candidats.ancrage', { url: candidat.url })
                      : t('candidats.nonPrecise'))}
                </p>
              </div>
            </div>
          )}
        </div>
      ))}
      {plan.length === 1 && (
        <div className="cpick-voie" data-testid="cpick-voie">
          {t('candidats.jouera')} <b>{libelleVoie(plan[0]!.voie)}</b> — {motifDuLot(plan[0]!)}.
        </div>
      )}
      {plan.length > 1 && (
        <div className="cpick-voie" data-testid="cpick-voie">
          {t('candidats.lancera')} <b>{t('candidats.lancera.lots', { n: plan.length })}</b>
          {t('candidats.lancera.suite', { max: MAX_PISTES_PAR_LOT })}
          <ol className="cpick-lots">
            {plan.map((lot, rang) => (
              <li key={rang} data-testid="cpick-lot" data-voie={lot.voie}>
                <b>{libelleVoie(lot.voie)}</b>{' '}
                {t(lot.positions.length > 1 ? 'candidats.lot.pistes' : 'candidats.lot.piste', {
                  positions: lot.positions.map((position) => retenus[position]! + 1).join(', ')
                })}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="cpick-actions">
        <button
          type="button"
          className="btn btn-accent cpick-lancer"
          data-testid="cpick-lancer"
          data-voie={
            plan.length > 0 && plan.every((lot) => lot.voie === plan[0]!.voie)
              ? plan[0]!.voie
              : 'mixte'
          }
          data-lots={plan.length}
          disabled={selection.length === 0}
          onClick={() => lancer(redigerPromptsDuPlan(plan))}
          title={t('candidats.lancerTitre')}
        >
          {plan.length > 1 ? t('candidats.lancerLots', { n: plan.length }) : t('candidats.lancer')}
        </button>
      </div>
    </div>
  )
}
