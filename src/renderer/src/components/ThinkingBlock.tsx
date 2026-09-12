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
import React, { useEffect, useRef, useState } from 'react'
import { Spinner } from './Spinner'
import {
  corpsDesActions,
  corpsDuBloc,
  derniereLigneDuRaisonnement
} from './thinking-block-corps'

function BlocRepliable({
  testid,
  classe,
  libelle,
  live,
  entete,
  corps,
  dependances
}: {
  testid: string
  classe: string
  libelle: string
  live: boolean
  entete?: string
  corps: string
  dependances: unknown[]
}): React.JSX.Element {
  const [manuel, setManuel] = useState<boolean | null>(null)
  const ouvert = manuel ?? false
  const ref = useRef<HTMLPreElement | null>(null)
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
        {live ? <Spinner /> : <span aria-hidden="true">✻</span>}
        <span className="thinking-label">{libelle}</span>
        {entete && (
          <span className="thinking-status" data-testid={`${testid}-status`} title={entete}>
            {entete}
          </span>
        )}
      </summary>
      <pre className="thinking-body" ref={ref} data-testid={`${testid}-body`}>
        {corps}
      </pre>
    </details>
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
  const actions = corpsDesActions(statusLog, status)
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
          dependances={[actions]}
        />
      )}
    </>
  )
}
