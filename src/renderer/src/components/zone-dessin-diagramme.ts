/** Largeur de dessin quand la place du diagramme n'est pas encore mesurable. */
export const LARGEUR_DESSIN_PAR_DEFAUT = 800

/**
 * ZONE DE DESSIN HORS DE LA PAGE pour mermaid.
 *
 * Défaut mesuré (conv-275, 2026-10-11 : « quand j'arrive dans une convers la barre de scroll
 * s'excite et la view devient frenetique »). Sans conteneur, `mermaid.render` (11.16.1,
 * `appendDivSvgG`) ajoute un `<div>` EN FLUX à la fin de `<body>` le temps de mesurer le texte. Ce
 * div faisait passer le document de 900 à 1 055 px : la page affichait sa propre barre de
 * défilement (10 px), toute l'app rétrécissait (fil de 836 à 826 px), le texte se recoupait et le
 * fil sautait de ~90 px. Puis le div partait et tout revenait. Une bascule par dessin, deux dessins
 * par diagramme en développement : jusqu'à 8 sauts à chaque ouverture.
 *
 * Cette zone est `fixed` : elle ne compte jamais dans la hauteur du document. Elle reste RENDUE
 * (`visibility: hidden`, pas `display: none`) parce que mermaid mesure son texte dans la mise en
 * page. Sa largeur est celle de la place réelle du diagramme : les diagrammes qui dessinent à la
 * largeur de leur parent (gantt) se dessinent ainsi à leur taille d'affichage.
 */
export function creerZoneDeDessinHorsPage(largeur: number): HTMLDivElement {
  const zone = document.createElement('div')
  zone.setAttribute('aria-hidden', 'true')
  zone.dataset.zoneDessinDiagramme = ''
  Object.assign(zone.style, {
    position: 'fixed',
    top: '0',
    left: '-100000px',
    width: `${largeur > 0 ? largeur : LARGEUR_DESSIN_PAR_DEFAUT}px`,
    visibility: 'hidden',
    pointerEvents: 'none'
  })
  document.body.appendChild(zone)
  return zone
}
