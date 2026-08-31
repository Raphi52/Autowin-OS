import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { surveillerGelsRenderer } from './gel-renderer'

/*
 * La sonde demarre AVANT le premier rendu, et pour toute la duree de la session : un gel se produit
 * quand il veut, pas quand on ouvre l'onglet Latence. Elle n'est jamais arretee — sa vie est celle
 * de la fenetre.
 */
surveillerGelsRenderer((dureeMs) => {
  const api = (window as unknown as { api?: { signalerGelRenderer?: (ms: number) => unknown } }).api
  api?.signalerGelRenderer?.(dureeMs)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
