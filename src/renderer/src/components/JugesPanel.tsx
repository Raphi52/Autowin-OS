import React, { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { extraireVotesJuges, type StepDeRun, type VoteJuge } from './juges-votes'
import { blocDesJuges, type BlocDesJuges, type ObjectionDuJuge, type Suivi } from './juges-bloc'
import './JugesPanel.css'

/**
 * LE BLOC DES JUGES dans le fil — choix « 1 · Nacre » du /draft de conv-328 (2026-10-18), sur la
 * mise en page « Corrigé dans l'objection » : bandeau du verdict, objections À CORRIGER (adresse
 * dessous, déjà-corrigé accroché dedans, état du suivi à droite), juges en pied. Habit du bloc de
 * question : cadre nacre de 1 px, aplats gris sans bord, DÉFAUT en pastille rouge, NOUVELLE en
 * gel bleu → rose. Maquette : artifacts/draft-juges-chat/tour4.html, proposition 1.
 *
 * Le bloc montre le DERNIER passage jugé du run (juges-bloc.ts) : un run réparé porte un verdict
 * par passage, que l'ancien panneau listait comme autant de juges. Le verdict complet de chaque
 * juge reste à un clic, sur son nom en pied (demande du 14/08 : « rentrer dans le détail »).
 */
const LIBELLE_VERDICT = { defaut: 'DÉFAUT', valide: 'VALIDE', echec: 'ÉCHEC' } as const
const LIBELLE_SUIVI: Record<Suivi, string> = {
  partie: 'REPRISE · EN PARTIE',
  reprise: 'REPRISE',
  nouvelle: 'NOUVELLE'
}
/**
 * Une objection se replie sur 3 lignes et se déplie au clic. Sans moteur de mise en page (rendu
 * hors écran, tests), on ne peut pas mesurer la coupe : on la suppose au-delà de ce nombre de signes.
 */
const TEXTE_LONG = 240

function pluriel(n: number, mot: string, motPluriel = `${mot}s`): string {
  return `${n} ${n > 1 ? motPluriel : mot}`
}

/** Le texte du juge, ses `portions de code` en pastilles. */
function avecCode(texte: string): React.ReactNode {
  return texte.split(/(`[^`\n]+`)/g).map((morceau, i) =>
    /^`[^`\n]+`$/.test(morceau) ? (
      <code key={i} className="jpan-c">
        {morceau.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{morceau}</Fragment>
    )
  )
}

function IconeVerdict({ verdict }: { verdict: keyof typeof LIBELLE_VERDICT }): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      {verdict === 'valide' ? (
        <path
          d="M2.2 6.3 4.8 8.8 9.8 3.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : verdict === 'defaut' ? (
        <path
          d="M3 3l6 6M9 3l-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M6 2.5v4.5M6 9.2v.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

const EPINGLE = (
  <svg className="jpan-epingle" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
    <path
      d="M6 11s3.6-3.5 3.6-6.2A3.6 3.6 0 0 0 2.4 4.8C2.4 7.5 6 11 6 11z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <circle cx="6" cy="4.9" r="1.2" fill="currentColor" />
  </svg>
)
const COCHE = (
  <svg className="jpan-coche" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
    <path
      d="M2.2 6.3 4.8 8.8 9.8 3.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** L'infobulle d'un état : à quel passage il se rapporte, en mots courants. */
function titreSuivi(suivi: Suivi, reparationPrecedente: number | undefined): string {
  const precedent =
    reparationPrecedente === undefined
      ? 'un passage précédent'
      : reparationPrecedente > 0
        ? `la réparation ${reparationPrecedente}`
        : 'le premier passage'
  if (suivi === 'nouvelle') return `Le juge ne la rattache pas au verdict d'après ${precedent}`
  if (suivi === 'partie')
    return `Le juge la signalait déjà après ${precedent} : corrigée en partie depuis`
  return `Le juge la signalait déjà après ${precedent}`
}

function Objection({
  objection,
  reparationPrecedente,
  plusieursJuges
}: {
  objection: ObjectionDuJuge
  reparationPrecedente: number | undefined
  plusieursJuges: boolean
}): React.JSX.Element {
  const [deplie, setDeplie] = useState(false)
  const [coupe, setCoupe] = useState(false)
  const refTexte = useRef<HTMLParagraphElement>(null)
  // « Lire la suite » seulement si le repli coupe VRAIMENT le texte : un seuil en caractères le
  // montrait sous une objection qui tenait en 3 lignes (capture du 2026-10-18, 2e objection).
  useLayoutEffect(() => {
    const el = refTexte.current
    if (!el || deplie) return
    const mesurer = (): void => {
      const sansMiseEnPage = el.clientHeight === 0 && el.scrollHeight === 0
      setCoupe(
        sansMiseEnPage ? objection.texte.length > TEXTE_LONG : el.scrollHeight > el.clientHeight + 1
      )
    }
    mesurer()
    if (typeof ResizeObserver === 'undefined') return
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(el)
    return () => observateur.disconnect()
  }, [deplie, objection.texte])
  return (
    <div className="jpan-obj" data-testid="jpan-objection">
      <span className={`jpan-gravite is-${(objection.gravite ?? 'nue').toLowerCase()}`}>
        {objection.gravite ?? 'OBJECTION'}
      </span>
      <div className="jpan-obj-corps">
        <p ref={refTexte} className={`jpan-obj-texte${deplie ? '' : ' is-replie'}`}>
          {avecCode(objection.texte)}
        </p>
        {(coupe || deplie) && (
          <button
            type="button"
            className="jpan-suite"
            aria-expanded={deplie}
            onClick={() => setDeplie((valeur) => !valeur)}
          >
            {deplie ? 'Réduire' : 'Lire la suite'}
          </button>
        )}
        {objection.adresses.length > 0 && (
          <div className="jpan-adresses" data-testid="jpan-adresses">
            {objection.adresses.map((adresse) => (
              <span key={adresse.chemin} className="jpan-adresse" title={adresse.chemin}>
                {EPINGLE}
                <code className="jpan-c is-fichier">{adresse.affiche}</code>
                {(adresse.lieu || adresse.lignes) && (
                  <code className="jpan-c is-lieu">
                    {[adresse.lieu, adresse.lignes].filter(Boolean).join(' · ')}
                  </code>
                )}
              </span>
            ))}
          </div>
        )}
        {objection.corrige.length > 0 && (
          <div className="jpan-corrige" data-testid="jpan-corrige">
            <span className="jpan-corrige-titre">Déjà corrigé dans cette objection</span>
            {objection.corrige.map((element, i) => (
              <div key={i} className="jpan-corrige-ligne">
                {COCHE}
                <span>{avecCode(element)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="jpan-obj-droite">
        {objection.suivi && (
          <span
            className={`jpan-suivi is-${objection.suivi}`}
            title={titreSuivi(objection.suivi, reparationPrecedente)}
          >
            {LIBELLE_SUIVI[objection.suivi]}
          </span>
        )}
        {plusieursJuges && <span className="jpan-qui">{objection.juge}</span>}
      </span>
    </div>
  )
}

function sousTitre(bloc: BlocDesJuges, verdict: keyof typeof LIBELLE_VERDICT): string {
  const { objections } = bloc
  if (objections.length === 0) {
    if (verdict === 'valide' && bloc.constats > 0)
      return pluriel(bloc.constats, 'constat vérifié', 'constats vérifiés')
    if (verdict === 'defaut') return 'le détail est dans le verdict du juge, en dessous'
    return ''
  }
  if (bloc.passagePrecedent) {
    const reprises = objections.filter((o) => o.suivi === 'partie' || o.suivi === 'reprise').length
    const nouvelles = objections.filter((o) => o.suivi === 'nouvelle').length
    const enPartie = objections.filter((o) => o.suivi === 'partie').length
    return [
      reprises > 0 ? pluriel(reprises, 'reprise') : '',
      nouvelles > 0 ? pluriel(nouvelles, 'nouvelle') : '',
      enPartie > 0 ? `${pluriel(enPartie, 'corrigée', 'corrigées')} en partie` : ''
    ]
      .filter(Boolean)
      .join(' · ')
  }
  const majeures = objections.filter((o) => o.gravite !== 'MINEUR').length
  const mineures = objections.length - majeures
  return `${pluriel(majeures, 'majeure')} · ${pluriel(mineures, 'mineure')}`
}

function dureeLisible(ms: number): string {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`
}

export function JugesPanel({
  conversationId,
  charger
}: {
  conversationId: string
  /** Injectable pour les tests : le vrai chargeur lit les runs de la conversation puis leur trace. */
  charger?: (conversationId: string) => Promise<readonly StepDeRun[]>
}): React.JSX.Element | null {
  const [bloc, setBloc] = useState<BlocDesJuges | null | undefined>()
  const [ouvert, setOuvert] = useState<number | null>(null)
  useEffect(() => {
    let vivant = true
    const chargeur = charger ?? chargerTraceParDefaut
    chargeur(conversationId)
      .then((steps) => {
        if (vivant) setBloc(blocDesJuges(steps))
      })
      .catch(() => {
        if (vivant) setBloc(null)
      })
    return () => {
      vivant = false
    }
  }, [conversationId, charger])
  if (!bloc || bloc.votes.length === 0) return null

  const valides = bloc.votes.filter((vote) => vote.vote === 'valide').length
  // Une objection MINEUR bloque la clôture même sous un VALIDE (décision conv-844) : le bandeau le dit.
  const verdict: keyof typeof LIBELLE_VERDICT =
    bloc.votes.some((vote) => vote.vote === 'defaut') || bloc.objections.length > 0
      ? 'defaut'
      : valides > 0
        ? 'valide'
        : 'echec'
  const n = bloc.objections.length
  const titre =
    n > 0
      ? `${pluriel(n, 'objection')} à corriger`
      : verdict === 'valide'
        ? 'Aucune objection à corriger'
        : verdict === 'defaut'
          ? 'Refusé sans objection détaillée'
          : 'Aucun juge n’a rendu de verdict'
  const sous = sousTitre(bloc, verdict)
  const juge: VoteJuge | undefined = ouvert !== null ? bloc.votes[ouvert] : undefined

  return (
    <section className="jpan" data-testid="juges-panel" data-verdict={verdict}>
      <div className="jpan-bandeau">
        <span className={`jpan-verdict is-${verdict}`}>
          <IconeVerdict verdict={verdict} />
          {LIBELLE_VERDICT[verdict]}
        </span>
        <span className="jpan-titre">
          <b>{titre}</b>
          {sous && <span className="jpan-sous">{sous}</span>}
        </span>
        <span
          className="jpan-quorum"
          title={
            bloc.reparation > 0
              ? `Verdict du passage de la réparation ${bloc.reparation}`
              : 'Verdict du premier passage'
          }
        >
          {valides}/{bloc.votes.length} {valides > 1 ? 'valident' : 'valide'}
        </span>
      </div>
      {n > 0 && (
        <>
          <div className="jpan-section">
            <span className="jpan-kicker">À corriger</span>
            <span className="jpan-filet" />
          </div>
          {bloc.objections.map((objection, i) => (
            <Objection
              key={i}
              objection={objection}
              reparationPrecedente={bloc.reparationPrecedente}
              plusieursJuges={bloc.votes.length > 1}
            />
          ))}
        </>
      )}
      <div className="jpan-pied">
        {bloc.votes.map((vote, index) => (
          <button
            key={`${vote.libelle}-${index}`}
            type="button"
            className={`jpan-juge is-${vote.vote}${ouvert === index ? ' is-ouvert' : ''}`}
            data-testid="jpan-ligne"
            aria-expanded={ouvert === index}
            title={ouvert === index ? 'Replier le verdict' : 'Lire le verdict complet'}
            onClick={() => setOuvert((courant) => (courant === index ? null : index))}
          >
            <span className="jpan-juge-nom">{vote.libelle}</span>
            {vote.vote === 'echec' ? (
              <span className="jpan-juge-absent">n’a pas voté</span>
            ) : vote.score !== undefined ? (
              <b className="jpan-score">{vote.score}</b>
            ) : (
              <b className="jpan-score">{vote.vote === 'valide' ? 'VALIDE' : 'DÉFAUT'}</b>
            )}
          </button>
        ))}
      </div>
      {juge && (
        <div className="jpan-complet" data-testid="jpan-verdict">
          <span className="jpan-complet-tete">
            Verdict complet · {juge.libelle}
            {juge.costUsd !== undefined && ` · ${juge.costUsd.toFixed(2)} $`}
            {juge.durationMs !== undefined && ` · ${dureeLisible(juge.durationMs)}`}
          </span>
          <p>{juge.texte}</p>
        </div>
      )}
    </section>
  )
}

/**
 * Le vrai chargeur : les runs de la conversation, du plus récent au plus ancien, et le PREMIER
 * qui porte des votes de juges gagne. « Le dernier run » ne suffisait pas : une conversation
 * porte souvent un run jugé ET un run annexe sans juge (mesuré sur conv-1122, deux runs).
 */
async function chargerTraceParDefaut(conversationId: string): Promise<StepDeRun[]> {
  const runs = (await window.api.conversationRuns?.(conversationId)) ?? []
  for (const run of runs) {
    if (!run?.path) continue
    const steps = (await window.api.runTrace?.(run.path).catch(() => null)) as StepDeRun[] | null
    if (steps && extraireVotesJuges(steps).length > 0) return steps
  }
  return []
}
