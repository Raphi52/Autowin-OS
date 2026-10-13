import { useCallback, useEffect, useState } from 'react'
import type { BrainReglageState } from '../../../shared/preload-contracts'

/**
 * Renseigner le BRAIN : un chemin et/ou un dépôt git (demande utilisateur du 2026-10-13, conv-923).
 *
 * Au travail, un simple dossier sur un partage réseau : chemin seul, et Autowin n'y lance aucune
 * commande git. À la maison, un dépôt : Autowin le clone s'il manque, et la clôture des runs y commite
 * leurs notes. Le serveur Brain et la vue du graphe gardent leur dossier jusqu'au redémarrage :
 * l'écran le DIT, comme celui du dossier de travail.
 */
export function BrainSettings(): React.JSX.Element {
  const [state, setState] = useState<BrainReglageState | null>(null)
  const [chemin, setChemin] = useState('')
  const [depot, setDepot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const appliquer = useCallback((suivant: BrainReglageState) => {
    setState(suivant)
    setError(suivant.erreur ?? null)
    if (!suivant.erreur) {
      setChemin(suivant.choisi?.chemin ?? '')
      setDepot(suivant.choisi?.depot ?? '')
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void (async () => {
        try {
          appliquer(await window.api.brainReglage())
        } catch {
          setError('Impossible de lire le réglage du Brain.')
        }
      })()
    })
  }, [appliquer])

  const run = useCallback(
    async (action: () => Promise<BrainReglageState>) => {
      setBusy(true)
      try {
        appliquer(await action())
      } catch {
        setError('Le changement du Brain a échoué. Réessaie.')
      } finally {
        setBusy(false)
      }
    },
    [appliquer]
  )

  const choisirDossier = async (): Promise<void> => {
    const dossier = await window.api.choisirDossierBrain()
    if (dossier) setChemin(dossier)
  }

  return (
    <section className="settings-execution-workspace surface-panel" aria-label="Brain" data-testid="brain-reglage">
      <header>
        <div>
          <span className="domain-eyebrow">Configuration locale</span>
          <h2>Brain</h2>
        </div>
      </header>
      <p>
        Le dossier où Autowin lit et dépose ce qu’il retient. <b>Sans dépôt</b>, c’est un simple dossier
        (un partage réseau, par exemple) : Autowin n’y lance <b>aucune commande git</b>. <b>Avec un dépôt</b>,
        il le clone s’il manque et y commite les notes de ses runs.
      </p>
      {state && (
        <p data-testid="brain-reglage-actif">
          Actif : <code>{state.actif}</code> —{' '}
          {state.estUnDepot ? 'dépôt git' : 'simple dossier, aucune commande git'}
        </p>
      )}
      <label>
        Dossier du Brain
        <span style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={chemin}
            placeholder="vide = détection automatique (ou dossier local d’Autowin pour un dépôt)"
            data-testid="brain-reglage-chemin"
            onChange={(event) => setChemin(event.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void choisirDossier()}>
            Choisir…
          </button>
        </span>
      </label>
      <label>
        Dépôt git (facultatif)
        <input
          type="text"
          value={depot}
          placeholder="vide = simple dossier · ex. https://github.com/moi/brain.git"
          data-testid="brain-reglage-depot"
          onChange={(event) => setDepot(event.target.value)}
          style={{ width: '100%' }}
        />
      </label>
      <p>
        <button
          type="button"
          className="btn"
          disabled={busy}
          data-testid="brain-reglage-enregistrer"
          onClick={() =>
            void run(() =>
              window.api.enregistrerBrainReglage({
                ...(chemin.trim() ? { chemin: chemin.trim() } : {}),
                ...(depot.trim() ? { depot: depot.trim() } : {})
              })
            )
          }
        >
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>{' '}
        {state?.choisi && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            data-testid="brain-reglage-reset"
            onClick={() => void run(() => window.api.resetBrainReglage())}
          >
            Revenir à la détection automatique
          </button>
        )}
      </p>
      {error && (
        <p className="domain-warning" role="alert" data-testid="brain-reglage-erreur">
          {error}
        </p>
      )}
      {state?.redemarrageNecessaire && (
        <p className="domain-warning" role="status" data-testid="brain-reglage-redemarrage">
          Redémarre Autowin pour que <code>{state.effectif}</code> devienne le Brain actif.
        </p>
      )}
      {state?.serveurSurUnAutreDossier && (
        <p className="domain-warning" role="status" data-testid="brain-reglage-serveur">
          Le serveur Brain déjà lancé sert encore <code>{state.serveurRacine}</code> : tant qu’il tourne,
          ce qu’Autowin retient y part. Arrête-le pour qu’il reparte sur le bon dossier.
        </p>
      )}
    </section>
  )
}
