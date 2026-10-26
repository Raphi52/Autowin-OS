import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { surveillerGelsRenderer } from './gel-renderer'
import { detailDeGelPourVue, vueDominanteRecente } from './components/rendu-long'
import { appliquerThemeMode, lireThemeMode } from './theme-mode'
import { appliquerLangue, lireLangue, transmettreLangueAuMoteur } from './langue'
import { installerCopiePropre } from './copie-propre'
import { installerAnimationsParCrans } from './animations-par-crans'

/*
 * Le mode d'affichage est posé AVANT le premier rendu : appliqué après, l'application
 * clignoterait en sombre le temps d'une image à chaque démarrage.
 */
appliquerThemeMode(lireThemeMode())

/*
 * La langue aussi, AVANT le premier rendu (conv-1146) : posée après, l'écran s'afficherait une image
 * en français avant de basculer. Le moteur la reçoit une fois ici — une instance neuve ou un dossier
 * de données recréé ne la connaît pas encore — puis à chaque changement dans Settings · Interface.
 */
const langueAuDemarrage = lireLangue()
appliquerLangue(langueAuDemarrage)
void transmettreLangueAuMoteur(langueAuDemarrage)

/*
 * Un Ctrl+C collé dans Gmail emportait le fond sombre de l'app, en bandes noires (conv-1073) :
 * la copie passe désormais par un HTML sans styles, pour toute la fenêtre.
 */
installerCopiePropre()

/*
 * Les indicateurs « ça travaille » (atomes, point de la carte du fil) avancent par crans de 100 ms,
 * tous calés sur la même horloge : en continu, un seul faisait recomposer toute la fenêtre 60 fois
 * par seconde, 20 à 33 % de la carte graphique de l'utilisateur (conv-1075).
 */
installerAnimationsParCrans()

/*
 * La sonde demarre AVANT le premier rendu, et pour toute la duree de la session : un gel se produit
 * quand il veut, pas quand on ouvre l'onglet Latence. Elle n'est jamais arretee — sa vie est celle
 * de la fenetre.
 */
surveillerGelsRenderer((dureeMs) => {
  const api = (
    window as unknown as {
      api?: {
        signalerGelRenderer?: (ms: number, etiquette?: string, detail?: unknown) => unknown
      }
    }
  ).api
  /*
   * On joint la vue qui a le plus rendu juste avant : sans elle, la tache longue repart sous
   * `renderer:longtask`, le nom qui portait 272 s de fenetre morte sans accuser personne.
   * Aucune vue mesuree = aucune etiquette, jamais un nom invente.
   */
  const vue = vueDominanteRecente()
  // Dominee par la liste des conversations : ses lignes redessinees et leurs declencheurs (conv-1115).
  const detail = detailDeGelPourVue(vue, dureeMs)
  if (detail) api?.signalerGelRenderer?.(dureeMs, vue, detail)
  else api?.signalerGelRenderer?.(dureeMs, vue)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
