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
 */
// fix-ok: le bloc Actions ne recevait que statusLog (texte) sans statut ; mesure claude.ts:1687 (is_error) jamais transmis -> lignes de fin parsees dans thinking-block-corps.ts, frise C3 ; edits 3-4 = echappement de retour a la ligne casse par le shell, corrige.
import React, { Fragment, useEffect, useRef, useState } from 'react'
import {
  actionsDuTour,
  bilanDesActions,
  corpsDuBloc,
  type ActionFrise,
  derniereLigneDuRaisonnement
} from './thinking-block-corps'

function BlocRepliable({
  testid,
  classe,
  libelle,
  live,
  entete,
  corps,
  bilan,
  frise,
  dependances
}: {
  testid: string
  classe: string
  libelle: string
  live: boolean
  entete?: string
  corps: string
  /** Bilan C3 de l'en-tete : `6 · 1 échec · 44 s`. */
  bilan?: string
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
        <span aria-hidden="true">✻</span>
        <span className="thinking-label">{libelle}</span>
        {bilan && (
          <span className="thinking-bilan" data-testid={`${testid}-bilan`}>
            {bilan}
          </span>
        )}
        {entete && (
          <span className="thinking-status" data-testid={`${testid}-status`} title={entete}>
            {entete}
          </span>
        )}
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
 * Variante C3 (choix de l'utilisateur, 2026-09-24) : une BARRE DE TEMPS (un segment par action,
 * large comme sa duree, vert/rouge/dore selon l'etat), puis une FRISE verticale, une pastille par
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
  const total = actions.reduce((s, a) => s + (a.secondes ?? 0), 0)
  return (
    <div className="thinking-body thinking-frise" ref={refCorps} data-testid={testid}>
      <div className="thinking-frise-barre" aria-hidden="true">
        {actions.map((a, i) => (
          <span
            key={i}
            data-etat={a.etat}
            // Largeur minimale : une action sans duree connue reste visible.
            style={{ flexGrow: total ? Math.max(a.secondes ?? 0, total / 50) : 1 }}
          />
        ))}
      </div>
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

export function ThinkingBlock({
  text,
  done,
  status,
  statusLog
}: {
  text: string
  done: boolean
  /** Signe de vie COURANT du fournisseur : outil en cours, tâche de fond, nouvelle tentative API. */
  status?: string
  /** TOUTES les lignes de signe de vie du tour, dans l'ordre — le corps du bloc « Actions ». */
  statusLog?: string[]
}): React.JSX.Element {
  const pensee = corpsDuBloc(text)
  const frise = actionsDuTour(statusLog, status, done)
  const actions = frise.map((a) => a.texte).join('\n')
  // Plie, le bloc doit quand meme dire OU en est la pensee : sa derniere ligne, en gris, comme le
  // bloc Actions montre l'action courante (demande de l'utilisateur, 2026-09-12).
  const dernierePensee = done ? '' : derniereLigneDuRaisonnement(pensee)
  return (
    <>
      <BlocRepliable
        testid="thinking-block"
        classe="thinking-block--raisonnement"
        libelle={done ? 'Raisonnement terminé' : 'Raisonnement…'}
        live={!done}
        {...(dernierePensee ? { entete: dernierePensee } : {})}
        corps={pensee}
        dependances={[text]}
      />
      {actions && (
        <BlocRepliable
          testid="action-block"
          classe="thinking-block--actions"
          libelle={done ? 'Actions' : 'Actions…'}
          live={!done}
          {...(!done && status ? { entete: status } : {})}
          corps={actions}
          bilan={bilanDesActions(frise)}
          frise={frise}
          dependances={[actions]}
        />
      )}
    </>
  )
}
