import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { surveillerGelsRenderer } from './gel-renderer'
import { vueDominanteRecente } from './components/rendu-long'
import { appliquerThemeMode, lireThemeMode } from './theme-mode'

/*
 * Le mode d'affichage est posé AVANT le premier rendu : appliqué après, l'application
 * clignoterait en sombre le temps d'une image à chaque démarrage.
 */
appliquerThemeMode(lireThemeMode())

/*
 * La sonde demarre AVANT le premier rendu, et pour toute la duree de la session : un gel se produit
 * quand il veut, pas quand on ouvre l'onglet Latence. Elle n'est jamais arretee — sa vie est celle
 * de la fenetre.
 */
surveillerGelsRenderer((dureeMs) => {
  const api = (
    window as unknown as {
      api?: { signalerGelRenderer?: (ms: number, etiquette?: string) => unknown }
    }
  ).api
  /*
   * On joint la vue qui a le plus rendu juste avant : sans elle, la tache longue repart sous
   * `renderer:longtask`, le nom qui portait 272 s de fenetre morte sans accuser personne.
   * Aucune vue mesuree = aucune etiquette, jamais un nom invente.
   */
  api?.signalerGelRenderer?.(dureeMs, vueDominanteRecente())
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
