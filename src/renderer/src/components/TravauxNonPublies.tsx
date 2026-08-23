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
 * L'AVEUGLE. Ce panneau ne fait donc qu'une chose, et c'est le préalable à toute décision : il
 * MONTRE. Aucune fusion, aucune suppression — un travail qu'on ne peut pas lire ne se jette pas.
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

  return (
    <div className="tnp" data-testid="travaux-non-publies">
      <header className="tnp-tete">
        <b>Travaux terminés, jamais publiés</b>
        <button type="button" onClick={onFermer} aria-label="Fermer">
          ×
        </button>
      </header>

      {erreur && <p className="tnp-erreur">{erreur}</p>}
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
        Lecture seule : rien n’est fusionné ni supprimé ici. Pour reprendre un travail :
        <code> git merge autowin/recovery/&lt;id&gt;</code>
      </p>
    </div>
  )
}
