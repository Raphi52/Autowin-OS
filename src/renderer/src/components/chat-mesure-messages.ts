/**
 * Mesure du fil, ISOLEE du composant.
 *
 * Un fichier de composants qui exporte AUSSI une fonction casse le rafraichissement a chaud :
 * `vite-plugin-react` refuse le module (« Could not Fast Refresh ») et invalide son PARENT — tout
 * l'arbre React est remonte, l'etat local perdu. Mesure du 2026-09-02 (journal du serveur de dev,
 * `hmr invalidate /src/components/ChatView.tsx ... "mesurerMessagesRendus" export is incompatible`,
 * suivi de `hmr update /src/App.tsx`) : en mosaique, les fenetres disparaissaient puis revenaient
 * vides a chaque edition. Meme regle que `chat-mosaic-grille.ts`.
 */

/**
 * Haut de CHAQUE message rendu, relatif au conteneur de défilement — l'ancre structurelle de la
 * reprise de lecture. `offsetTop` est relatif au parent positionné : on le ramène au conteneur en
 * retranchant le sien, ce qui reste juste même si un ancêtre intermédiaire est positionné.
 */
export function mesurerMessagesRendus(conteneur: HTMLElement): { offsetTop: number }[] {
  const hautConteneur = conteneur.getBoundingClientRect().top + conteneur.scrollTop
  return Array.from(conteneur.querySelectorAll<HTMLElement>('.msg')).map((element) => ({
    offsetTop: Math.round(element.getBoundingClientRect().top + conteneur.scrollTop - hautConteneur)
  }))
}
