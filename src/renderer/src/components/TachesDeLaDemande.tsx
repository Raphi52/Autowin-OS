/**
 * LA TASK D'UNE DEMANDE, DANS LA FICHE D'UN POST-IT DE LA CARTE DU PROJET (conv-1127, 2026-10-23).
 *
 * Demande : « rattacher les prompts à des work-items […] pour qu'un prompt soit lié à une task »,
 * option E du cadrage : lien automatique quand il est sûr, rattachement à la main depuis la fiche.
 * Chaque demande montre ses tasks (`#1234 Titre`, d'où vient le lien au survol), ou « sans task » ;
 * « + task » ouvre un champ pour taper un numéro, que le processus principal lit à la source avant
 * de le poser (`liens-work-items.ts`). Un refus est montré tel quel, le champ reste ouvert.
 *
 * Un lien HÉRITÉ (demande `suite`) n'a pas de bouton « détacher » : il n'est pas posé sur cette
 * demande, mais sur celle qu'elle poursuit.
 */
import React, { useState } from 'react'
import type {
  DemandeDeLaCarte,
  ResultatDuRattachement,
  WorkItemDeLaDemande
} from '../../../shared/carte-des-besoins'
import './TachesDeLaDemande.css'

const ORIGINES: Record<WorkItemDeLaDemande['origine'], string> = {
  tickets: 'fil ouvert depuis la vue Tickets pour cette fiche',
  mention: 'numéro écrit dans le prompt, fiche lue à la source',
  manuel: 'rattaché à la main'
}

function aide(w: WorkItemDeLaDemande): string {
  const origine = w.herite
    ? 'repris de la demande précédente (ce prompt la poursuit)'
    : ORIGINES[w.origine]
  const type = w.type ? `${w.type} · ` : ''
  return `${type}${origine}${w.titre ? '' : ' · titre pas encore lu à la source'}`
}

/** Une source de tickets configurée, telle que le champ « + task » la propose (conv-1127). */
export interface SourceDeTache {
  id: string
  label: string
}

export function TachesDeLaDemande({
  demande,
  lier,
  delier,
  sources
}: {
  demande: DemandeDeLaCarte
  /** `sourceId` : seulement quand l'utilisateur a eu le choix (plusieurs sources configurées). */
  lier?: (
    demande: DemandeDeLaCarte,
    saisie: string,
    sourceId?: string
  ) => Promise<ResultatDuRattachement>
  delier?: (demande: DemandeDeLaCarte, workItem: WorkItemDeLaDemande) => Promise<unknown>
  /**
   * Les sources configurées. À partir de DEUX, le champ propose de choisir (demande du 23/10,
   * conv-1127) : sans ce choix, le processus principal refuse, car il ne devine pas le projet.
   */
  sources?: readonly SourceDeTache[]
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false)
  const [saisie, setSaisie] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [sourceChoisie, setSourceChoisie] = useState<string | null>(null)
  const workItems = demande.workItems ?? []
  const plusieurs = (sources?.length ?? 0) > 1
  // Proposée d'abord : la source d'une task déjà liée à cette demande, sinon la première. Toujours
  // affichée dans la liste : rien n'est choisi en silence.
  const sourceParDefaut =
    sources?.find((s) => workItems.some((w) => w.sourceId === s.id))?.id ?? sources?.[0]?.id
  const source =
    sourceChoisie && sources?.some((s) => s.id === sourceChoisie) ? sourceChoisie : sourceParDefaut

  const fermer = (): void => {
    setOuvert(false)
    setSaisie('')
    setErreur(null)
    setSourceChoisie(null)
  }

  const valider = async (): Promise<void> => {
    if (!lier || enCours) return
    setEnCours(true)
    try {
      // La source ne part que si l'utilisateur a eu le choix ; sinon le processus principal la déduit.
      const resultat =
        plusieurs && source ? await lier(demande, saisie, source) : await lier(demande, saisie)
      if (resultat.ok) fermer()
      else setErreur(resultat.raison)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <span className="taches" data-testid="taches">
      {workItems.length ? (
        workItems.map((w) => (
          <span
            key={`${w.sourceId}::${w.id}`}
            className="tache"
            data-testid="tache"
            data-origine={w.origine}
            data-herite={w.herite ? '1' : undefined}
            title={aide(w)}
          >
            <b>#{w.id}</b>
            {w.titre && <span className="tache-titre">{w.titre}</span>}
            {!w.herite && delier && (
              <button
                type="button"
                className="tache-detacher"
                data-testid="tache-detacher"
                aria-label={`Détacher #${w.id}`}
                title="Détacher cette task de la demande"
                onClick={() => void delier(demande, w)}
              >
                ×
              </button>
            )}
          </span>
        ))
      ) : (
        <span className="tache-sans" data-testid="tache-sans">
          sans task
        </span>
      )}
      {lier && !ouvert && (
        <button
          type="button"
          className="tache-bouton"
          data-testid="tache-lier"
          title="Lier cette demande à un work item"
          onClick={() => setOuvert(true)}
        >
          + task
        </button>
      )}
      {ouvert && (
        <span className="tache-champ">
          {plusieurs && sources && (
            <select
              className="tache-source"
              data-testid="tache-source"
              aria-label="Source du work item"
              title="Dans quelle source chercher ce numéro"
              value={source}
              disabled={enCours}
              onChange={(e) => setSourceChoisie(e.target.value)}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <input
            className="tache-saisie"
            data-testid="tache-saisie"
            aria-label="Numéro du work item"
            placeholder="1234 ou #1234"
            inputMode="numeric"
            autoFocus
            value={saisie}
            disabled={enCours}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void valider()
              if (e.key === 'Escape') {
                // Échap referme le champ, pas toute la fiche.
                e.nativeEvent.stopPropagation()
                fermer()
              }
            }}
          />
          <button
            type="button"
            className="tache-bouton"
            data-testid="tache-valider"
            disabled={enCours}
            onClick={() => void valider()}
          >
            {enCours ? 'Lecture…' : 'Lier'}
          </button>
          <button type="button" className="tache-bouton is-discret" onClick={fermer}>
            Annuler
          </button>
        </span>
      )}
      {erreur && (
        <span className="tache-erreur" data-testid="tache-erreur" role="alert">
          {erreur}
        </span>
      )}
    </span>
  )
}
