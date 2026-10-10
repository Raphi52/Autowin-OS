/**
 * Blocs « Raisonnement » et « Actions » du fil — DEUX blocs repliables EMPILÉS, écrits en direct.
 *
 * Avant le 2026-09-12 un seul bloc « Réflexion » portait les deux : la pensée du modèle ET les
 * lignes de signe de vie (outil en cours, tâche de fond, nouvelle tentative API). Sur les modèles
 * dont la pensée arrive chiffrée (opus-5), le bloc ne montrait donc QUE des actions sous un titre
 * qui promettait de la réflexion. Demande de l'utilisateur : « un bloc raisonnement et un bloc
 * action l'un au dessus de l'autre ».
 *
 * Ouverture : PLIÉS par défaut, en cours comme terminés (demande du 2026-09-01) — l'en-tête dit
 * déjà ce qui se passe. Un clic de l'utilisateur reprend TOUJOURS la main.
 *
 * EN-TETE « R5 · Sous la ligne » (choix de l'utilisateur sur maquettes, conv-162, 2026-10-10 :
 * « la gueule du 1, la barre avec les actions du 3, pas les mots de raisonnement, seulement un
 * compteur de secondes », puis « go R5 ») : chaque titre est une CAPSULE à bord dégradé (icône
 * ronde, libellé, compteurs, chevron DEDANS) ; le signe de vie reste dehors, en gris.
 *
 * Habillage « Fumé net » (conv-173, 2026-10-10, maquettes .autowin-tmp/draft-capsules, « Agent
 * assorti implémente c magnifique », puis « reflet bombé ») : la capsule est en verre fumé (reflet
 * en arc, bord dégradé de 2 px). La barre de temps des actions reste SOUS la ligne, hors de la
 * capsule, et déborde sous le signe de vie : un essai l'avait mise dans la capsule, refusé
 * (« sors-la de la capsule Actions, mets-la comme avant en dessous »). Visible bloc plié.
 */
// fix-ok: le bloc Actions ne recevait que statusLog (texte) sans statut ; mesure claude.ts:1687 (is_error) jamais transmis -> lignes de fin parsees dans thinking-block-corps.ts, frise C3 ; edits 3-4 = echappement de retour a la ligne casse par le shell, corrige.
import React, { Fragment, useEffect, useRef, useState } from 'react'
import {
  actionsDuTour,
  bilanDesActions,
  chronoMemorise,
  corpsDuBloc,
  derniereLigneDuRaisonnement,
  dureeLisible,
  memoriserChrono,
  secondesDesActions,
  secondesDuChrono,
  type ActionFrise,
  type Chrono
} from './thinking-block-corps'

/** Étincelle : la pensée. Dessinée en SVG — l'ancien glyphe « ✻ » dépendait de la police. */
const ICONE_RAISONNEMENT = (
  <svg viewBox="0 0 16 16" focusable="false">
    <path d="M8 1 L9.6 6.4 L15 8 L9.6 9.6 L8 15 L6.4 9.6 L1 8 L6.4 6.4 Z" fill="currentColor" />
  </svg>
)

/** Éclair : les actions. */
const ICONE_ACTIONS = (
  <svg viewBox="0 0 16 16" focusable="false">
    <path d="M9.5 1 L3 9 H7.5 L6.5 15 L13 6.5 H8.5 Z" fill="currentColor" />
  </svg>
)

function BlocRepliable({
  testid,
  classe,
  icone,
  libelle,
  live,
  compteurs,
  titre,
  entete,
  corps,
  barre,
  frise,
  dependances
}: {
  testid: string
  classe: string
  icone: React.JSX.Element
  libelle: string
  live: boolean
  /** Ce que la capsule affiche après le libellé : secondes du raisonnement, nombre et durée des actions. */
  compteurs?: React.ReactNode
  /** Infobulle de la capsule (bilan complet des actions, échecs compris). */
  titre?: string
  entete?: string
  corps: string
  /** Barre de temps sous la ligne d'en-tête : un segment par action (R5, gardée par Fumé net). */
  barre?: ActionFrise[]
  /** Actions structurees : si present, le corps est dessine en FRISE (variante C3). */
  frise?: ActionFrise[]
  dependances: unknown[]
}): React.JSX.Element {
  const [manuel, setManuel] = useState<boolean | null>(null)
  const ouvert = manuel ?? false
  const ref = useRef<HTMLElement | null>(null)
  // Le flux s'écrit vers le BAS : sans cela, le contenu défile hors du cadre et on regarde le début.
  useEffect(() => {
    const el = ref.current
    if (el && ouvert) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependances, ouvert])
  return (
    <details
      className={`thinking-block ${classe}${live ? ' is-live' : ' is-done'}`}
      data-testid={testid}
      open={ouvert}
      onToggle={(event) => setManuel(event.currentTarget.open)}
    >
      <summary>
        {/* AUCUN spinner ici : un seul tourne pour tout le tour, sur la ligne « Agent »
            (demande du 2026-09-12 « met qu'un spinner sur la ligne agent »). Deux blocs
            empiles donnaient deux spinners cote a cote pour une seule attente. */}
        <span
          className="thinking-capsule"
          data-testid={`${testid}-capsule`}
          {...(titre ? { title: titre } : {})}
        >
          <span className="thinking-capsule-icone" aria-hidden="true">
            {icone}
          </span>
          <span className="thinking-label">{libelle}</span>
          {compteurs}
        </span>
        {entete && (
          <span className="thinking-status" data-testid={`${testid}-status`} title={entete}>
            {entete}
          </span>
        )}
        {/* SOUS la ligne, hors de la capsule : elle court sous la capsule ET sous le signe de vie
            (conv-173 : « sors-la de la capsule Actions, mets-la comme avant en dessous et qui
            dépasse sur le texte de la ligne »). */}
        {barre && barre.length > 0 && <BarreDeTemps actions={barre} />}
      </summary>
      {frise ? (
        <FriseDesActions
          actions={frise}
          testid={`${testid}-body`}
          refCorps={(el) => {
            ref.current = el
          }}
        />
      ) : (
        <pre
          className="thinking-body"
          ref={(el) => {
            ref.current = el
          }}
          data-testid={`${testid}-body`}
        >
          {corps}
        </pre>
      )}
    </details>
  )
}

/**
 * Barre de temps (C3) : un segment par action, large comme sa durée, vert/rouge/rose selon l'état.
 * SOUS la ligne d'en-tête depuis R5 (un essai DANS la capsule a été refusé, conv-173). Elle vivait
 * dans le corps déplié ; elle n'y est plus, pour ne pas la dessiner deux fois quand on déplie.
 */
function BarreDeTemps({ actions }: { actions: ActionFrise[] }): React.JSX.Element {
  const total = secondesDesActions(actions)
  return (
    <span className="thinking-frise-barre" data-testid="action-block-barre" aria-hidden="true">
      {actions.map((a, i) => (
        <span
          key={i}
          data-etat={a.etat}
          // Largeur minimale : une action sans duree connue reste visible.
          style={{ flexGrow: total ? Math.max(a.secondes ?? 0, total / 50) : 1 }}
        />
      ))}
    </span>
  )
}

/**
 * Variante C3 (choix de l'utilisateur, 2026-09-24) : une FRISE verticale, une pastille par
 * action. Icones et pastilles sont en CSS (`::before`) : le texte du corps reste exactement les
 * lignes d'action separees par des retours a la ligne, comme l'ancien `<pre>`.
 */
function FriseDesActions({
  actions,
  testid,
  refCorps
}: {
  actions: ActionFrise[]
  testid: string
  refCorps: (el: HTMLDivElement | null) => void
}): React.JSX.Element {
  return (
    <div className="thinking-body thinking-frise" ref={refCorps} data-testid={testid}>
      <div className="thinking-frise-liste">
        {actions.map((a, i) => (
          <Fragment key={i}>
            {i > 0 && '\n'}
            <div
              className="thinking-frise-ligne"
              data-etat={a.etat}
              data-famille={a.famille}
              data-testid="action-frise-ligne"
              title={a.etat === 'ko' ? 'Échec' : a.etat === 'encours' ? 'En cours' : 'Réussie'}
            >
              <span className="thinking-frise-icone" data-famille={a.famille} aria-hidden="true" />
              {a.texte}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/**
 * Compteur de secondes du raisonnement. Voir `Chrono` dans thinking-block-corps.ts : mesuré à
 * l'écran pendant le tour, figé à la fin.
 *
 * Un tour RELU sans compteur en mémoire (app relancée, tour jamais vu en cours) prend la durée que
 * le tour a CONSERVÉE (`conserveMs`, écrite à la clôture par le processus principal, même mesure).
 * Le compteur vu en direct garde la priorité : le chiffre ne saute pas sous les yeux de
 * l'utilisateur à l'arrivée de la valeur conservée. Ni l'un ni l'autre : aucun chiffre inventé.
 */
function useChronoDuRaisonnement(
  turnId: string | undefined,
  done: boolean,
  conserveMs: number | undefined
): number | null {
  const [chrono] = useState<Chrono | null>(
    () => chronoMemorise(turnId) ?? (done ? null : { debut: Date.now() })
  )
  const [maintenant, setMaintenant] = useState(() => chrono?.fin ?? Date.now())
  useEffect(() => {
    if (done || !chrono) return
    const id = window.setInterval(() => setMaintenant(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [done, chrono])
  // Memorise le debut (et, tour fini, la fin) pour qu'un remontage ne reparte pas de zero.
  useEffect(() => {
    if (!turnId || !chrono) return
    memoriserChrono(turnId, done ? { debut: chrono.debut, fin: chrono.fin ?? maintenant } : chrono)
  }, [turnId, chrono, done, maintenant])
  if (!chrono) return done && conserveMs !== undefined ? Math.floor(conserveMs / 1000) : null
  return secondesDuChrono(
    done ? { ...chrono, fin: chrono.fin ?? maintenant } : chrono,
    maintenant
  )
}

export function ThinkingBlock({
  text,
  done,
  status,
  statusLog,
  turnId,
  reasoningMs
}: {
  text: string
  done: boolean
  /** Signe de vie COURANT du fournisseur : outil en cours, tâche de fond, nouvelle tentative API. */
  status?: string
  /** TOUTES les lignes de signe de vie du tour, dans l'ordre — le corps du bloc « Actions ». */
  statusLog?: string[]
  /** Identifiant du tour : garde le chrono du raisonnement si le bloc est démonté puis remonté. */
  turnId?: string
  /** Durée du raisonnement CONSERVÉE par le tour (ms) : le compteur d'un tour relu du disque. */
  reasoningMs?: number
}): React.JSX.Element {
  const pensee = corpsDuBloc(text)
  const frise = actionsDuTour(statusLog, status, done)
  const actions = frise.map((a) => a.texte).join('\n')
  // Plie, le bloc doit quand meme dire OU en est la pensee : sa derniere ligne, en gris, comme le
  // bloc Actions montre l'action courante (demande de l'utilisateur, 2026-09-12).
  const dernierePensee = done ? '' : derniereLigneDuRaisonnement(pensee)
  const secondesPensee = useChronoDuRaisonnement(turnId, done, reasoningMs)
  const secondesActions = secondesDesActions(frise)
  return (
    <>
      <BlocRepliable
        testid="thinking-block"
        classe="thinking-block--raisonnement"
        icone={ICONE_RAISONNEMENT}
        libelle={done ? 'Raisonnement terminé' : 'Raisonnement'}
        live={!done}
        compteurs={
          secondesPensee !== null && (
            <span className="thinking-secondes" data-testid="thinking-block-secondes">
              {dureeLisible(secondesPensee)}
            </span>
          )
        }
        {...(dernierePensee ? { entete: dernierePensee } : {})}
        corps={pensee}
        dependances={[text]}
      />
      {actions && (
        <BlocRepliable
          testid="action-block"
          classe="thinking-block--actions"
          icone={ICONE_ACTIONS}
          libelle="Actions"
          live={!done}
          titre={bilanDesActions(frise)}
          compteurs={
            <>
              <span className="thinking-nombre" data-testid="action-block-nombre">
                {frise.length}
              </span>
              {secondesActions > 0 && (
                <span className="thinking-duree" data-testid="action-block-duree">
                  {dureeLisible(secondesActions)}
                </span>
              )}
            </>
          }
          {...(!done && status ? { entete: status } : {})}
          corps={actions}
          barre={frise}
          frise={frise}
          dependances={[actions]}
        />
      )}
    </>
  )
}
