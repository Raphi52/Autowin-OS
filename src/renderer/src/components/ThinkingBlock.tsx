/**
 * Bloc « Réflexion » du fil : le raisonnement LIVE du modèle, repliable, écrit EN TEMPS RÉEL.
 *
 * Le raisonnement était accumulé par `chat-view-model` (`message.reasoning`) mais n'était rendu
 * NULLE PART depuis le retrait du panneau latéral : la pensée existait et restait invisible.
 * Il revient ici, dans la bulle, au-dessus de la réponse — comme chez Kimi.
 *
 * Ouverture : PLIÉ par défaut, en cours comme terminé (demande du 2026-09-01, dans la foulée du
 * pli des blocs d'actions : « pareil pour reflexion » — c'est l'utilisateur qui déplie s'il veut
 * lire). L'en-tête continue de dire que ça pense (spinner + « Réflexion… »), donc rien n'est perdu :
 * seul le PAVÉ de pensée cesse de pousser la réponse hors de l'écran. Un clic de l'utilisateur
 * reprend TOUJOURS la main (l'état manuel gagne sur le défaut).
 */
import React, { useEffect, useRef, useState } from 'react'
import { Spinner } from './Spinner'

/**
 * Corps DEPLIE : la pensee du modele, puis TOUTES les lignes de signe de vie du tour.
 *
 * Le repli ne garde que la derniere ligne ; deplier doit rendre la trace COMPLETE. Sans liste
 * transmise (rendu partiel), on retombe sur la ligne courante : jamais MOINS qu'avant.
 */
export function corpsDuBloc(
  text: string,
  statusLog: string[] | undefined,
  status: string | undefined,
  done: boolean
): string {
  const lignes = statusLog?.length ? statusLog : status ? [status] : []
  return [text, ...(done ? [] : lignes)].filter(Boolean).join('\n')
}

export function ThinkingBlock({
  text,
  done,
  status,
  statusLog
}: {
  text: string
  done: boolean
  /**
   * SIGNE DE VIE DU FOURNISSEUR (outil en cours, tache de fond, nouvelle tentative API).
   *
   * Il s'affichait A COTE du texte de l'agent, dans la ligne d'en-tete du message — constat
   * utilisateur du 2026-09-01 : « ca ecrit tout mais a cote du texte agent au lieu de dans son
   * bloc ». Sa place est ICI : c'est le meme moment d'attente que la reflexion, et sur les modeles
   * dont la pensee arrive chiffree (opus-5 : 3 029 fragments mesures, tous vides) c'est meme le
   * SEUL signal reel que ce bloc puisse porter.
   */
  status?: string
  /**
   * TOUTES les lignes de signe de vie du tour, dans l'ordre. L'en-tete n'en montre qu'UNE (la
   * derniere) ; le corps deplie les montre TOUTES — sinon deplier ne donne rien de plus que la
   * ligne repliee (« ca doit m'ecrire toutes les lignes », 2026-09-01).
   */
  statusLog?: string[]
}): React.JSX.Element {
  const [manuel, setManuel] = useState<boolean | null>(null)
  const ouvert = manuel ?? false
  const corps = useRef<HTMLPreElement | null>(null)
  // Le flux s'écrit vers le BAS : sans cela, la pensée défile hors du cadre et on regarde le début.
  useEffect(() => {
    const el = corps.current
    if (el && ouvert) el.scrollTop = el.scrollHeight
  }, [text, status, statusLog, ouvert])
  return (
    <details
      className={`thinking-block${done ? ' is-done' : ' is-live'}`}
      data-testid="thinking-block"
      open={ouvert}
      onToggle={(event) => setManuel(event.currentTarget.open)}
    >
      <summary>
        {done ? <span aria-hidden="true">✻</span> : <Spinner />}
        <span className="thinking-label">{done ? 'Réflexion terminée' : 'Réflexion…'}</span>
        {!done && status && (
          <span className="thinking-status" data-testid="thinking-status" title={status}>
            {status}
          </span>
        )}
      </summary>
      <pre className="thinking-body" ref={corps} data-testid="thinking-body">
        {corpsDuBloc(text, statusLog, status, done)}
      </pre>
    </details>
  )
}
