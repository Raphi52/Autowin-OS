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
import type { Langue } from '../../../shared/langue'
import {
  traduireBoardEtMaintenance,
  useTextesBoardEtMaintenance,
  type CleBoardEtMaintenance
} from '../textes-ecrans/board-et-maintenance'
import { Spinner } from './Spinner'
import './TachesDeLaDemande.css'

const ORIGINES: Record<WorkItemDeLaDemande['origine'], CleBoardEtMaintenance> = {
  tickets: 'taches.origine.tickets',
  mention: 'taches.origine.mention',
  manuel: 'taches.origine.manuel'
}

function aide(w: WorkItemDeLaDemande, langue: Langue): string {
  const origine = traduireBoardEtMaintenance(
    w.herite ? 'taches.herite' : ORIGINES[w.origine],
    langue
  )
  const type = w.type ? `${w.type} · ` : ''
  return `${type}${origine}${w.titre ? '' : traduireBoardEtMaintenance('taches.titreNonLu', langue)}`
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
  const { t, langue } = useTextesBoardEtMaintenance()
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
            title={aide(w, langue)}
          >
            <b>#{w.id}</b>
            {w.titre && <span className="tache-titre">{w.titre}</span>}
            {!w.herite && delier && (
              <button
                type="button"
                className="tache-detacher"
                data-testid="tache-detacher"
                aria-label={t('taches.detacher', { id: w.id })}
                title={t('taches.detacher.aide')}
                onClick={() => void delier(demande, w)}
              >
                ×
              </button>
            )}
          </span>
        ))
      ) : (
        <span className="tache-sans" data-testid="tache-sans">
          {t('taches.sans')}
        </span>
      )}
      {lier && !ouvert && (
        <button
          type="button"
          className="tache-bouton"
          data-testid="tache-lier"
          title={t('taches.lier.aide')}
          onClick={() => setOuvert(true)}
        >
          {/* « task » est déjà le mot anglais : le libellé reste le même dans les deux langues. */}
          + task
        </button>
      )}
      {ouvert && (
        <span className="tache-champ">
          {plusieurs && sources && (
            <select
              className="tache-source"
              data-testid="tache-source"
              aria-label={t('taches.source')}
              title={t('taches.source.aide')}
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
            aria-label={t('taches.numero')}
            placeholder={t('taches.numero.exemple')}
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
            {enCours ? (
              <>
                <Spinner size={12} /> {t('taches.lecture')}
              </>
            ) : (
              t('taches.lier')
            )}
          </button>
          <button type="button" className="tache-bouton is-discret" onClick={fermer}>
            {t('commun.annuler')}
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
