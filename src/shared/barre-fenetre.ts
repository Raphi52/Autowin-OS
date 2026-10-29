/**
 * HAUTEUR DES BOUTONS DE FENÊTRE (réduire / agrandir / fermer), en pixels.
 *
 * Ces boutons sont dessinés par Windows (`titleBarOverlay`), par-dessus la page, et leur gris de
 * survol occupe toute cette hauteur. Ils doivent donc tenir dans la marge du haut de la vue
 * (`.main { padding: var(--s5) }`, soit 24 px dans `theme.css`) : plus hauts, leur gris de survol
 * mord sur le haut des blocs de la vue. Constaté le 2026-10-28 (conv-1223) avec 28 px : 4 px de
 * gris débordaient sur la vue. `barre-fenetre.test.ts` refuse une valeur qui redépasse la marge.
 *
 * Une seule valeur pour la création de la fenêtre (`window.ts`) et pour le changement de thème
 * (`app:titlebar-symbol-color` dans `index.ts`) : deux nombres séparés finiraient par diverger.
 */
export const HAUTEUR_BOUTONS_FENETRE = 24
