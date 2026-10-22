/**
 * MODE D'AFFICHAGE — Holographique par défaut (depuis le 2026-10-11), ou l'un des thèmes du registre.
 *
 * Un SEUL point de vérité : la valeur est écrite sur `document.documentElement` en
 * `data-theme`, et c'est ce que les feuilles de style regardent (`:root[data-theme='clair']`
 * dans `assets/theme-modes.css`). Aucun composant ne repeint quoi que ce soit lui-même.
 *
 * Le sombre reste l'état NU du document (aucun attribut), mais ce n'est plus le DÉFAUT : voir
 * `THEME_MODE_PAR_DEFAUT`.
 */
/**
 * Un thème est désigné par son IDENTIFIANT, une chaîne libre — et non plus par une union de deux
 * valeurs. C'est ce qui permet d'en ajouter sans toucher au type. Le contrôle ne vient donc plus
 * du compilateur mais du REGISTRE ci-dessous : une valeur absente du registre est refusée à la
 * lecture, exactement comme avant (cas vérifié : `galaxy` mémorisé retombe sur le défaut).
 */
export type ThemeId = string

/** Ancien nom, gardé pour ne pas casser les appelants existants. */
export type ThemeMode = ThemeId

/**
 * BASE d'un thème : clair ou sombre. Ce n'est pas décoratif — c'est ce qui décide de la variante
 * d'accent à utiliser. Mesure du 2026-09-06 : `theme-modes.css` assombrit l'or et le rose pour le
 * mode clair, parce que les teintes de nuit passent sous le seuil de lisibilité sur fond clair. Un
 * nouveau thème doit donc DÉCLARER sa base, sinon ses accents seront illisibles.
 */
export type ThemeBase = 'sombre' | 'clair'

export type Theme = {
  /** Ce qui est écrit dans `data-theme` sur la racine, et mémorisé sur le poste. */
  readonly id: ThemeId
  /** Ce que l'utilisateur lit dans la liste de Settings · Interface. */
  readonly libelle: string
  readonly base: ThemeBase
}

/**
 * LE REGISTRE — la seule liste de vérité. Ajouter un thème = ajouter une entrée ICI, plus un bloc
 * `:root[data-theme='<id>']` dans une feuille de style. Rien d'autre à modifier.
 *
 * `sombre` est un cas à part et le reste : il n'écrit AUCUN attribut (voir `appliquerThemeMode`),
 * donc c'est l'état nu du document. Les 102 blocs de style existants comptent sur ça.
 */
export const THEMES: readonly Theme[] = [
  { id: 'sombre', libelle: 'Sombre', base: 'sombre' },
  { id: 'clair', libelle: 'Clair', base: 'clair' },
  // RETIRES le 2026-10-11 (conv-231) : Obsidian Nebula, Solar Rose, Black Versailles, et leurs
  // trois pendants clairs Ardoise, Parchemin, Rose poudre. Un poste qui en avait memorise un
  // retombe sur le defaut (lireThemeMode). Leurs maquettes restent dans sketches/.
  // Affiche « Holographique » depuis le 2026-10-10 (conv-212), theme PAR DEFAUT depuis le
  // 2026-10-11 (conv-269). L id reste `nebuleuse-verre` : c est la valeur memorisee sur le poste.
  { id: 'nebuleuse-verre', libelle: 'Holographique', base: 'sombre' },
  // Pendant BLANC d Holographique (conv-212, 2026-10-10, /draft « go le plus blanc ») : feuille
  // DERIVEE d Holographique noir par scripts/theme-nebuleuse-verre.mjs holographique-clair
  // (nacre #f8f7fb sur fond #f6f5f9, lisere irise, coins bleu et rose, lumiere de la souris).
  // L id reste `holographique-clair` : c est la valeur memorisee si la premiere version a ete choisie.
  { id: 'holographique-clair', libelle: 'Holographique blanc', base: 'clair' },
  // Vert phosphore sur noir, chasse fixe, copie d Internet Typewriter (writer.bighugelabs.com).
  { id: 'machine-a-ecrire', libelle: 'Machine à écrire', base: 'sombre' },
  // fix-ok: entree retiree puis remise expres pour prouver le test (sans elle : vitest exit 1, avec : 0).
  // L apparence de Claude en sombre (conv-269, 2026-10-16) : anthracite chaud #262624, terracotta
  // #d97757, titres en serif, aucun decor. Couche generee par scripts/theme-nebuleuse-verre.mjs
  // ninja-claude, plus la feuille ecrite a la main assets/theme-ninja-claude.css.
  { id: 'ninja-claude', libelle: 'Ninja Claude', base: 'sombre' },
  // La version CLAIRE de Ninja Claude (conv-269, 2026-10-16) : creme #faf9f5, encre #141413,
  // terracotta, titres en serif. Couche generee par scripts/theme-nebuleuse-verre.mjs vanilla-claude,
  // plus la feuille ecrite a la main assets/theme-vanilla-claude.css.
  { id: 'vanilla-claude', libelle: 'Vanilla Claude', base: 'clair' },
  // NieR:Automata (conv-281, 2026-10-19) : papier beige #dad4bb, encre brune #4e4b42, coins carres,
  // selection en negatif. Couche generee par scripts/theme-nebuleuse-verre.mjs nier-automata,
  // plus la feuille ecrite a la main assets/theme-nier-automata.css.
  { id: 'nier-automata', libelle: 'NieR:Automata', base: 'clair' },
  // SPECIAL MALVOYANT : contraste AAA (7:1) sur le texte courant, focus epais, bordures nettes,
  // texte agrandi. Une base de chaque cote pour heriter des corrections de lisibilite existantes.
  { id: 'malvoyant-sombre', libelle: 'Spécial malvoyant — sombre', base: 'sombre' },
  { id: 'malvoyant-clair', libelle: 'Spécial malvoyant — clair', base: 'clair' }
]

export const THEME_MODE_STORAGE_KEY = 'autowin-theme-mode.v1'

/**
 * DEUX ROLES, DEUX CONSTANTES — ils etaient confondus jusqu au 2026-10-11.
 *
 * `THEME_NU` : le theme qui n ecrit AUCUN attribut sur la racine. C est le sombre, et il le reste :
 * les blocs de style ecrits sans prefixe en dependent.
 *
 * `THEME_MODE_PAR_DEFAUT` : ce qu un poste voit quand rien n est memorise, ou quand la valeur
 * memorisee est abimee ou retiree du registre. Holographique depuis le 2026-10-11 (conv-269,
 * « le mode holographique est le mode par defaut de autowin os desormais »). Un poste qui a CHOISI
 * le sombre l a memorise (`sombre`) et le garde.
 */
const THEME_NU: ThemeId = 'sombre'
export const THEME_MODE_PAR_DEFAUT: ThemeId = 'nebuleuse-verre'

/** Un identifiant n'est valable que s'il est DANS le registre. */
export function estThemeConnu(valeur: unknown): valeur is ThemeId {
  return typeof valeur === 'string' && THEMES.some((t) => t.id === valeur)
}

/** La base du thème donné, pour choisir la variante d'accent. Inconnu -> sombre. */
export function baseDuTheme(id: ThemeId): ThemeBase {
  return THEMES.find((t) => t.id === id)?.base ?? 'sombre'
}

/** Lit le thème mémorisé. Toute valeur absente, abîmée ou inconnue retombe sur Holographique. */
export function lireThemeMode(): ThemeId {
  try {
    const brut = globalThis.localStorage?.getItem(THEME_MODE_STORAGE_KEY)
    return estThemeConnu(brut) ? brut : THEME_MODE_PAR_DEFAUT
  } catch {
    // localStorage indisponible (contexte de test, mode privé) : le défaut reste le repli.
    return THEME_MODE_PAR_DEFAUT
  }
}

/**
 * Applique le thème au document. Le sombre RETIRE l'attribut au lieu d'écrire `sombre` :
 * l'état par défaut du document reste exactement celui d'avant ce réglage, et les règles de style
 * écrites sans préfixe continuent de s'appliquer telles quelles.
 *
 * Tout AUTRE thème écrit son identifiant, y compris un identifiant inconnu du registre : cette
 * fonction applique ce qu'on lui donne. Le filtrage est le travail de `lireThemeMode`.
 */
export function appliquerThemeMode(mode: ThemeId): void {
  const racine = globalThis.document?.documentElement
  if (!racine) return
  if (mode === THEME_NU) racine.removeAttribute('data-theme')
  else racine.setAttribute('data-theme', mode)
  /*
   * LA BASE, posee A COTE du nom du theme -- et c est ce qui manquait.
   *
   * Le premier mode clair a coute 76 blocs d exception, ecrits pour tous les endroits ou le chat
   * peint son texte en clair EN DUR. Ces blocs visent data-theme=clair, donc son NOM. Consequence
   * mesuree a l ecran le 2026-09-07 : les trois nouveaux themes clairs (ardoise, parchemin,
   * rose-poudre) heritaient du fond clair SANS heriter des corrections de texte -- gris pale sur
   * blanc, illisible.
   *
   * On pose donc aussi la BASE, que le registre declare deja. Les exceptions peuvent viser
   * data-base=clair : tout theme clair, present ou futur, en profite sans etre nomme nulle part.
   * Le sombre reste l etat NU sur les deux attributs -- rien a retirer pour lui.
   */
  const base = baseDuTheme(mode)
  if (base === 'sombre') racine.removeAttribute('data-base')
  else racine.setAttribute('data-base', base)
  accorderBoutonsDeFenetre(racine, base)
  accorderSchemaDeCouleurs(base)
  accorderCarteDeFinDeTour(racine)
}

/**
 * LA CARTE DE FIN DE TOUR (conv-1090, 2026-10-22) — « fais suivre à la carte de fin de tour le
 * thème choisi dans Réglages · Interface ». La carte vit dans SA fenêtre, en bas à droite de
 * l'écran (`src/main/notification-popup.ts`) : aucune feuille de style ne l'atteint. Même chemin
 * que les boutons de fenêtre : on lit les jetons CALCULÉS du thème appliqué et on les envoie.
 * Un thème ajouté demain n'a rien à déclarer : ces huit jetons sont posés par `theme.css`.
 *
 * Tout ou rien : un jeton illisible n'envoie rien, la carte garde sa dernière palette valable plutôt
 * que de mêler deux thèmes. Silencieux hors d'Electron (pont absent).
 */
const JETONS_DE_LA_CARTE = {
  fond: '--bg-0',
  texte: '--text',
  texteDoux: '--text-dim',
  accent: '--accent',
  accent2: '--violet',
  accent3: '--gold',
  surAccent: '--on-accent',
  erreur: '--err'
} as const

function accorderCarteDeFinDeTour(racine: Element): void {
  const pont = (
    globalThis as {
      api?: { setPaletteCarteFinDeTour?: (p: Record<string, string>) => unknown }
    }
  ).api
  if (!pont?.setPaletteCarteFinDeTour) return
  try {
    const styles = globalThis.getComputedStyle?.(racine)
    if (!styles) return
    const palette: Record<string, string> = {}
    for (const [champ, jeton] of Object.entries(JETONS_DE_LA_CARTE)) {
      const couleur = enHexadecimal(styles.getPropertyValue(jeton).trim())
      if (!couleur) return
      palette[champ] = couleur
    }
    void Promise.resolve(pont.setPaletteCarteFinDeTour(palette)).catch(() => {
      // Processus principal plus ancien que ce canal : la carte garde les couleurs d'Holographique.
    })
  } catch {
    // Style non calculable (document détaché) : la carte garde sa dernière palette.
  }
}

/**
 * CE QUE REPOND `prefers-color-scheme` — la base du theme Autowin, pas le reglage de Windows.
 *
 * Electron repond par defaut la preference du SYSTEME. Mesure du 2026-10-08 (conv-111) : Windows
 * en mode clair (`AppsUseLightTheme = 1`) + Autowin en sombre = `prefers-color-scheme: light` dans
 * le fil, et le HTML du modele, qui suit cette requete comme le lui demande sa consigne, ecrivait
 * en bleu marine sur noir. On transmet donc la base au processus principal, qui pose
 * `nativeTheme.themeSource`.
 *
 * Silencieux hors d'Electron (test, navigateur) : le pont n'existe pas, ce n'est pas une panne.
 */
function accorderSchemaDeCouleurs(base: ThemeBase): void {
  const pont = (globalThis as { api?: { setColorScheme?: (s: 'dark' | 'light') => unknown } }).api
  if (!pont?.setColorScheme) return
  void Promise.resolve(pont.setColorScheme(base === 'clair' ? 'light' : 'dark')).catch(() => {
    // Processus principal plus ancien que ce canal : la requete garde la preference du systeme.
  })
}

/** Symboles des boutons de fenetre poses sur une scene sombre (ville, planetes) : clairs. */
export const SYMBOLE_SUR_SCENE = '#e6e9f2'

/** Vrai tant qu'une scene du fond de l'Accueil est affichee, donc sous les boutons de fenetre. */
let sceneSousLaBarre = false

/**
 * Appele par `DecorDeFond` : une scene de l'Accueil (Cyberpunk, Planetes) vient d'apparaitre sous
 * la barre, ou de disparaitre (autre vue, fond « Aucun », decor demonte).
 *
 * Sans ce signal, la couleur des boutons n'etait recalculee qu'au changement de THEME : changer de
 * vue ou de fond ne la touchait pas (conv-1076). Rien n'est envoye si l'etat ne change pas.
 */
export function signalerSceneSousLaBarre(affichee: boolean): void {
  if (affichee === sceneSousLaBarre) return
  sceneSousLaBarre = affichee
  const racine = globalThis.document?.documentElement
  if (!racine) return
  accorderBoutonsDeFenetre(
    racine,
    racine.getAttribute('data-base') === 'clair' ? 'clair' : 'sombre'
  )
}

/**
 * LES BOUTONS DE FENETRE — reduire / agrandir / fermer — ne sont PAS dessines par la page : c'est
 * Windows qui les peint, d'apres une couleur fixee a la creation de la fenetre. Aucune feuille de
 * style ne les atteint, donc ils ne suivaient AUCUN theme : ils gardaient le quasi-blanc du mode
 * sombre, et devenaient invisibles sur une barre claire. Constate a l'ecran le 2026-09-07.
 *
 * On lit donc la couleur de texte REELLE du theme applique — `--text`, telle que le navigateur
 * vient de la calculer — et on la transmet au processus principal. Consequence voulue : un theme
 * futur n'a rien a declarer ici, il suffit qu'il definisse `--text`.
 *
 * Silencieux par construction : hors d'Electron (test, navigateur) le pont n'existe pas, et sur une
 * plateforme sans overlay de barre de titre l'appel rend `false`. Aucun des deux n'est une panne.
 */
function accorderBoutonsDeFenetre(racine: Element, base: ThemeBase): void {
  const pont = (globalThis as { api?: { setTitlebarSymbolColor?: (c: string) => unknown } }).api
  if (!pont?.setTitlebarSymbolColor) return
  /*
   * UNE SCENE DE L'ACCUEIL SOUS LA BARRE, theme clair : symboles clairs (conv-1076, 2026-10-22).
   * Depuis que le menu « Fond » de l'Accueil fait foi sous tous les themes, un theme clair affiche
   * la ville ou les planetes, sombres, juste sous ces boutons : ses symboles fonces, faits pour la
   * page claire des autres vues, s'y perdaient. Demande : « rends les boutons clairs dans les themes
   * clairs, et laisse-les fonces sur les autres vues ». Les themes sombres gardent leur jeton.
   */
  if (base === 'clair' && sceneSousLaBarre) {
    void pont.setTitlebarSymbolColor(SYMBOLE_SUR_SCENE)
    return
  }
  try {
    const styles = globalThis.getComputedStyle?.(racine)
    /*
     * LE JETON LU EST `--titlebar-symbol`, PAS `--text` — et c'est toute la correction du
     * 2026-09-21. La barre est TRANSPARENTE : le symbole se pose sur le decor cosmique, qui reste
     * SOMBRE sous tous les themes (le canevas 3D s'efface en noir opaque, home-decor-scene.ts
     * FOND_DECOR). Un theme clair peignait donc un symbole sombre sur du sombre.
     *
     * La premiere tentative posait un fond BLANC OPAQUE derriere les symboles. Refuse par
     * l'utilisateur, et il avait raison sur les deux points : ca ne traitait que les trois boutons
     * alors que TOUTE la bande du haut est illisible en clair, et ca collait un rectangle blanc en
     * travers de la galaxie. Le fond reste donc transparent ; c'est la COULEUR du symbole qui
     * devient claire en mode clair, comme le reste de ce qui est pose sur le decor.
     */
    const declaree = styles?.getPropertyValue('--titlebar-symbol').trim() ?? ''
    // Repli si le theme n'a pas declare le jeton : clair au-dessus du decor sombre, `--text` sinon.
    const repli =
      base === 'clair' ? SYMBOLE_SUR_SCENE : (styles?.getPropertyValue('--text').trim() ?? '')
    const couleur = enHexadecimal(declaree) ?? enHexadecimal(repli)
    if (couleur) void pont.setTitlebarSymbolColor(couleur)
  } catch {
    // Style non calculable (document detache) : la barre garde sa couleur, rien de casse.
  }
}

/**
 * Windows veut un `#rrggbb`. Le theme, lui, peut ecrire `#14192a`, `#fff` ou `rgb(20, 25, 42)`
 * selon ce que le navigateur rend — les trois formes existent dans nos feuilles, donc les trois
 * sont converties plutot que supposees.
 */
export function enHexadecimal(valeur: string): string | null {
  if (/^#[0-9a-fA-F]{6}$/.test(valeur)) return valeur.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(valeur)) {
    const [r, v, b] = valeur.slice(1)
    return `#${r}${r}${v}${v}${b}${b}`.toLowerCase()
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(valeur)
  if (!rgb) return null
  const canal = (n: string): string => Math.min(255, Number(n)).toString(16).padStart(2, '0')
  return `#${canal(rgb[1])}${canal(rgb[2])}${canal(rgb[3])}`
}

/** Mémorise ET applique. C'est ce qu'appelle l'interrupteur de Settings · Interface. */
export function ecrireThemeMode(mode: ThemeMode): void {
  try {
    globalThis.localStorage?.setItem(THEME_MODE_STORAGE_KEY, mode)
  } catch {
    // Écriture impossible : le mode s'applique quand même pour la session en cours.
  }
  appliquerThemeMode(mode)
}
