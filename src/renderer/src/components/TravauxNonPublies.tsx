import { useEffect, useState } from 'react'

/**
 * LA LISTE DES TRAVAUX FINIS MAIS JAMAIS PUBLIÉS — et le moyen de les LIRE.
 *
 * Mesuré le 2026-08-23 : 14 travaux terminés attendaient sur des branches `autowin/recovery/`, et
 * AUCUNE vue de l'app ne les montrait. La vue Workspace, la seule qui porte des actions sur un
 * bureau d'agent, affichait « 0 bureau » — parce qu'elle ne connaît que les bureaux VIVANTS, et que
 * la copie de ces travaux avait été balayée. Il ne restait que la branche.
 *
 * Conséquence : la seule option offerte à l'utilisateur était de fusionner ou de supprimer À
 * L'AVEUGLE. Ce panneau MONTRE d'abord — c'est le préalable à toute décision — puis offre le seul
 * geste qui ne détruit rien : réintégrer, c'est-à-dire retenter la publication.
 *
 * La frontière est tenue par un test qui lit ce fichier : supprimer, écraser ou trancher un conflit
 * restent interdits ici. Un travail qu'on ne peut pas lire ne se jette pas.
 */
export interface TravailNonPublie {
  agentId: string
  date: string
  fichiers: string[]
}

/** Le nom qu'un humain reconnaît : ses fichiers. L'identifiant de copie ne dit rien à personne. */
export function libelleTravail(travail: TravailNonPublie): string {
  if (!travail.fichiers.length) return travail.agentId
  const premier = travail.fichiers[0]
  const reste = travail.fichiers.length > 1 ? ` +${travail.fichiers.length - 1} fichiers` : ''
  return `${premier}${reste}`
}

export function TravauxNonPublies({
  onFermer
}: {
  onFermer: () => void
}): React.JSX.Element {
  const [travaux, setTravaux] = useState<TravailNonPublie[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [patch, setPatch] = useState<{ patch: string; tronque: boolean } | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [resultat, setResultat] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    void (async () => {
      try {
        const liste = (await window.api.getTravauxNonPublies?.()) ?? []
        if (vivant) setTravaux(liste)
      } catch (cause) {
        if (vivant) setErreur(String(cause))
      }
    })()
    return () => {
      vivant = false
    }
  }, [])

  const voir = async (agentId: string): Promise<void> => {
    if (ouvert === agentId) {
      setOuvert(null)
      setPatch(null)
      return
    }
    setOuvert(agentId)
    setPatch(null)
    try {
      setPatch((await window.api.getPatchTravailNonPublie?.(agentId)) ?? null)
    } catch (cause) {
      setErreur(String(cause))
    }
  }

  /**
   * RÉINTÉGRER : le seul geste offert ici, et il n'est pas destructeur — il tente de reprendre la
   * publication du travail. Il reste ENTIÈREMENT à l'initiative de l'utilisateur, après lecture du
   * diff : la machine ne réintègre rien toute seule.
   *
   * Ce bouton n'existait pas avant le 2026-08-23 parce qu'il aurait été mort-né : la garde de reprise
   * exigeait `verdict === 'green'`, or 11 des 14 travaux bloqués sont des `command-edit` que personne
   * ne juge jamais. La garde distingue désormais « jamais jugé » de « jugé mauvais ».
   */
  const reintegrer = async (agentId: string): Promise<void> => {
    setEnCours(agentId)
    setResultat(null)
    try {
      const rendu = await window.api.retryWorktreeRecovery?.(agentId)
      /*
       * LIRE L'ISSUE, pas le fait qu'un objet soit revenu. Première version : ce message annonçait
       * « Reprise lancée » dès que l'appel rendait quelque chose — or il rend l'activité MISE À JOUR,
       * y compris quand elle est retombée en `blocked`. Le bouton félicitait donc l'utilisateur d'un
       * échec. Le motif réel, lui, est dans `detail` : par exemple « la copie ne descend pas du SHA
       * de départ autorisé », qui dit exactement quoi faire (rebaser) au lieu d'un « échec » opaque.
       */
      if (!rendu) {
        setResultat(`Reprise refusée pour ${agentId} — travail jugé rouge, ou déjà repris.`)
      } else if (rendu.state === 'blocked') {
        setResultat(`Reprise bloquée : ${rendu.detail ?? 'motif non précisé par le moteur.'}`)
      } else {
        setResultat(`Reprise lancée. Suis son avancement dans Source control.`)
      }
    } catch (cause) {
      setResultat(String(cause))
    } finally {
      setEnCours(null)
    }
  }

  return (
    <div className="tnp" data-testid="travaux-non-publies">
      <header className="tnp-tete">
        <b>Travaux terminés, jamais publiés</b>
        <button type="button" onClick={onFermer} aria-label="Fermer">
          ×
        </button>
      </header>

      {erreur && <p className="tnp-erreur">{erreur}</p>}
      {resultat && (
        <p className="tnp-resultat" data-testid="tnp-resultat">
          {resultat}
        </p>
      )}
      {!travaux && !erreur && <p className="tnp-vide">Lecture des branches…</p>}
      {travaux?.length === 0 && <p className="tnp-vide">Tout est publié.</p>}

      <ul className="tnp-liste">
        {(travaux ?? []).map((travail) => (
          <li key={travail.agentId} data-testid="tnp-ligne">
            <div className="tnp-ligne-tete">
              <span className="tnp-nom" title={`autowin/recovery/${travail.agentId}`}>
                {libelleTravail(travail)}
              </span>
              <span className="tnp-date">{travail.date}</span>
              <button
                type="button"
                data-testid={`tnp-voir-${travail.agentId}`}
                onClick={() => void voir(travail.agentId)}
              >
                {ouvert === travail.agentId ? 'Masquer' : 'Voir le diff'}
              </button>
              <button
                type="button"
                data-testid={`tnp-reintegrer-${travail.agentId}`}
                disabled={enCours === travail.agentId}
                onClick={() => void reintegrer(travail.agentId)}
                title="Retenter la publication de ce travail"
              >
                {enCours === travail.agentId ? '…' : 'Réintégrer'}
              </button>
            </div>
            {ouvert === travail.agentId && (
              <pre className="tnp-patch" data-testid="tnp-patch">
                {patch ? patch.patch || '(diff vide)' : 'Lecture…'}
                {patch?.tronque ? '\n\n[…] diff tronqué — trop long pour être lu ici.' : ''}
              </pre>
            )}
          </li>
        ))}
      </ul>

      <p className="tnp-note">
        Rien n’est supprimé ici : « Réintégrer » retente la publication, il ne détruit jamais. À la
        main : <code>git merge autowin/recovery/&lt;id&gt;</code>
      </p>
    </div>
  )
}
