import React from 'react'

export type OfficeActionKey = 'open' | 'retry' | 'keep-agent' | 'keep-mine'

/**
 * Une action à la fois par bureau : pendant l'appel, le bouton dit ce qu'il fait et se verrouille.
 *
 * EXPORTÉ pour la ligne de conflit compacte de la vue Worktrees : elle porte les MÊMES boutons
 * « garder l'une ou l'autre version » et doit donc hériter du MÊME verrouillage. Le recopier là-bas
 * ferait diverger deux mécaniques d'attente sur le même appel.
 */
export function useOfficeAction(): {
  pending: OfficeActionKey | null
  error?: string
  run: (key: OfficeActionKey, action: () => unknown) => void
} {
  const [pending, setPending] = React.useState<OfficeActionKey | null>(null)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const run = (key: OfficeActionKey, action: () => unknown): void => {
    if (pending) return
    setPending(key)
    setError(undefined)
    const fail = (cause: unknown): void => {
      setPending(null)
      setError(cause instanceof Error ? cause.message : 'Action impossible pour l’instant.')
    }
    try {
      const result = action() as PromiseLike<unknown> | undefined
      // Une action synchrone n'a pas d'attente à montrer : ne pas inventer un état « en cours ».
      if (!result || typeof result.then !== 'function') {
        setPending(null)
        return
      }
      result.then(() => setPending(null), fail)
    } catch (cause) {
      fail(cause)
    }
  }
  return { pending, error, run }
}

