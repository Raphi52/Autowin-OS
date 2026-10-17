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
 * Haut de CHAQUE message rendu DANS LE CONTENU du conteneur de défilement — la valeur de
 * `scrollTop` qui poserait ce message en haut du champ. C'est l'ancre structurelle de la reprise de
 * lecture. On passe par `getBoundingClientRect` (et non `offsetTop`, relatif au parent positionné)
 * pour rester juste même si un ancêtre intermédiaire est positionné.
 *
 * La position à l'écran d'un message DÉPEND du défilement : on lui rajoute donc `scrollTop`.
 * Défaut conv-307 (2026-10-17) : `scrollTop` était ajouté puis retranché, la mesure devenait
 * relative au haut VISIBLE ; la cible de reprise valait alors 2 × retenue − courante, et le fil
 * sautait à chaque image entre deux positions symétriques (620 ↔ 27 282 px mesurés).
 */
export function mesurerMessagesRendus(conteneur: HTMLElement): { offsetTop: number }[] {
  const origine = conteneur.getBoundingClientRect().top + (conteneur.clientTop || 0)
  const defilement = conteneur.scrollTop
  return Array.from(conteneur.querySelectorAll<HTMLElement>('.msg')).map((element) => ({
    offsetTop: Math.round(element.getBoundingClientRect().top - origine + defilement)
  }))
}
