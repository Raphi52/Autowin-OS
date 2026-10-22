/**
 * LES CLASSES QUE L'APP FOURNIT AUX PAGES `html-render` — source UNIQUE de la liste (conv-1074,
 * 2026-10-22).
 *
 * Avant : trois prompts (le chat, le chat en lecture seule, le scout interne) dictaient au modele des
 * couleurs EN DUR — texte `#dde3ee`, or `#d4a94f`-`#e3ba55`, libelles `#a9b2c4`. Ce sont des teintes
 * de nuit : en theme clair, l'app devait toutes les ecraser en `!important` (`theme-modes.css`), et
 * l'or des chiffres cles devenait du texte sombre ordinaire. Le rendu se fait DANS la page de l'app
 * (pas de cadre isole, `chat-html-inline.ts`) et l'attribut `class` y est garde tel quel : l'app peut
 * donc peindre elle-meme ces roles, avec les jetons du theme CHOISI.
 *
 * Les regles vivent dans `ChatView.css` (`.md-html .aw-*`), leur reprise en theme clair dans
 * `theme-modes.css`. `ChatView.classes-pages.test.ts` verifie que chaque classe ci-dessous y est
 * definie, et `chat-pilotage-prompt.classes-pages.test.ts` que les prompts la nomment.
 */
export interface ClassePageHtml {
  classe: string
  /** Ce que la classe veut dire, tel que le modele le lit dans son prompt. */
  usage: string
  /** Vrai = la classe porte une couleur, qu'il faut reprendre en theme clair. */
  couleur: boolean
}

export const CLASSES_PAGES_HTML: readonly ClassePageHtml[] = [
  {
    classe: 'aw-kicker',
    usage: 'surtitre de section, petites capitales monospace, or',
    couleur: true
  },
  { classe: 'aw-chiffre', usage: 'chiffre clé, or et gras', couleur: true },
  { classe: 'aw-discret', usage: 'libellé secondaire, texte atténué', couleur: true },
  {
    classe: 'aw-chip',
    usage: 'chemin ou valeur technique en puce monospace discrète',
    couleur: true
  },
  {
    classe: 'aw-filet',
    usage: 'séparateur de section, filet fin dégradé or (sur un <hr>)',
    couleur: false
  },
  { classe: 'aw-ok', usage: 'statut réussi', couleur: true },
  { classe: 'aw-ko', usage: 'statut en échec', couleur: true },
  { classe: 'aw-attention', usage: 'statut à surveiller', couleur: true },
  {
    classe: 'aw-grille',
    usage: 'colonnes fluides qui passent à la ligne (comparaisons, cartes de chiffres)',
    couleur: false
  }
]

/**
 * La consigne de couleur des pages, telle que les prompts la portent. Une seule redaction : les trois
 * prompts ne peuvent plus diverger.
 */
export const CONSIGNE_CLASSES_PAGES_HTML =
  "COULEURS : n'écris AUCUNE couleur en dur — l'app fournit des classes qui suivent le thème " +
  "choisi par l'utilisateur (sombre, clair ou autre) : " +
  CLASSES_PAGES_HTML.map(({ classe, usage }) => `\`${classe}\` (${usage})`).join(', ') +
  ". Le texte courant n'a besoin d'aucune classe : il hérite déjà de la couleur du thème. " +
  "N'utilise pas `prefers-color-scheme` : il suit le thème de Windows, pas celui de l'app."
