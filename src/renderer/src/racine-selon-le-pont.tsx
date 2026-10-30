import type { ReactElement } from 'react'
import { HorsElectron } from './components/HorsElectron'

/**
 * L'INTERFACE OUVERTE HORS DE L'APPLICATION (conv-1286, 2026-10-29).
 *
 * `http://localhost:5173` ouvert dans un navigateur ordinaire (le navigateur intégré du chat compris)
 * montrait un écran NOIR : le pont `window.api`, posé par le preload d'Electron, y est absent, et le
 * premier effet qui le lit (`App.tsx`, `UpdateBanner.tsx`) lève une erreur qui démonte toute
 * l'interface. Des centaines d'endroits lisent ce pont : on ne les garde pas un à un, on ne monte pas
 * l'interface du tout sans lui, et `HorsElectron` dit pourquoi à la place.
 */

/** Le pont du preload est-il là ? `window.api` est un objet dans la fenêtre Electron, absent ailleurs. */
export function pontElectronPresent(fenetre: unknown): boolean {
  const api = (fenetre as { api?: unknown } | null | undefined)?.api
  return typeof api === 'object' && api !== null
}

/** La racine à monter : l'interface si le pont est là, sinon l'écran qui explique son absence. */
export function racineSelonLePont(fenetre: unknown, interfaceComplete: ReactElement): ReactElement {
  return pontElectronPresent(fenetre) ? interfaceComplete : <HorsElectron />
}
