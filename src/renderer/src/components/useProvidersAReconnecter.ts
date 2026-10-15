import { useEffect, useState } from 'react'

/**
 * Les providers dont la session a EXPIRÉ, pour l'alerte de l'onglet Routage.
 *
 * Une anomalie n'était visible qu'en OUVRANT l'onglet concerné : un provider expiré partait donc au
 * prompt suivant sans que rien ne l'annonce depuis l'onglet voisin. Cette sonde vivait dans Agent
 * Studio ; elle a suivi l'onglet Routage dans Settings (conv-963, 2026-10-15). Même contrat qu'avant :
 * LECTURE seule, uniquement pendant que la vue est ouverte, relue quand les rôles changent (une
 * reconnexion faite depuis Routage émet `refresh/roles`).
 */
export function useProvidersAReconnecter(active: boolean): string[] {
  const [expires, setExpires] = useState<string[]>([])

  useEffect(() => {
    if (!active) return
    let annule = false
    let generation = 0
    const relire = (): void => {
      const courante = ++generation
      void Promise.resolve(window.api?.providerStatus?.())
        .then((statuts) => {
          if (annule || courante !== generation) return
          const liste = (statuts ?? []) as { provider: string; status: string }[]
          setExpires(liste.filter((s) => s.status === 'expired').map((s) => s.provider))
        })
        // Un onglet ne doit pas casser parce que sa SONDE a échoué : l'indicateur reste simplement muet.
        .catch(() => undefined)
    }
    relire()
    const off = window.api?.onAppEvent?.((event) => {
      if (event.type === 'refresh' && event.scope === 'roles') relire()
    })
    return () => {
      annule = true
      off?.()
    }
  }, [active])

  return expires
}
