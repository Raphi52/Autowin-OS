import { FENETRE_PRINCIPALE } from '../../shared/tab-layout'
import { resolveAppLocation, type Tab } from './tabs'

/**
 * QUELLE FENETRE SUIS-JE ? La page est la MEME pour la fenêtre principale et pour un onglet sorti
 * sur un 2e écran ; seul le `#hash` les distingue (`#tab?window=detached-1&tab=observatory`), sur le
 * patron déjà utilisé par la fenêtre de question du modèle.
 */
export function lireFenetreDuHash(hash: string): { windowId: string; tab: Tab | null } {
  const sansDiese = hash.startsWith('#') ? hash.slice(1) : hash
  const [route, requete = ''] = sansDiese.split('?')
  if (route !== 'tab') return { windowId: FENETRE_PRINCIPALE, tab: null }
  const params = new URLSearchParams(requete)
  const windowId = params.get('window') || FENETRE_PRINCIPALE
  const demande = params.get('tab')
  return { windowId, tab: demande ? resolveAppLocation(demande).destination : null }
}
