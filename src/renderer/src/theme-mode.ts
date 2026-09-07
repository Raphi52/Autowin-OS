/**
 * MODE D'AFFICHAGE — sombre (par défaut) ou clair.
 *
 * Un SEUL point de vérité : la valeur est écrite sur `document.documentElement` en
 * `data-theme`, et c'est ce que les feuilles de style regardent (`:root[data-theme='clair']`
 * dans `assets/theme-modes.css`). Aucun composant ne repeint quoi que ce soit lui-même.
 *
 * Par défaut SOMBRE : personne qui n'y touche pas ne doit voir son application changer.
 */
/**
 * Un thème est désigné par son IDENTIFIANT, une chaîne libre — et non plus par une union de deux
 * valeurs. C'est ce qui permet d'en ajouter sans toucher au type. Le contrôle ne vient donc plus
 * du compilateur mais du REGISTRE ci-dessous : une valeur absente du registre est refusée à la
 * lecture, exactement comme avant (cas vérifié : `galaxy` mémorisé retombe sur le sombre).
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
  // Premier theme qui ne soit ni le sombre d origine ni son inverse clair : ses couleurs
  // viennent de la maquette maison sketches/galaxy-dark-gold-pink/obisidian-nebula. Sa BASE est
  // sombre, donc ses accents et ses filets sont ceux d un fond noir.
  { id: 'obsidian-nebula', libelle: 'Obsidian Nebula', base: 'sombre' },
  // Le VIF : or eclatant, rose franc, filets prune. Palette de la maquette maison
  // sketches/galaxy-dark-gold-pink/solar-rose-command.
  { id: 'solar-rose', libelle: 'Solar Rose', base: 'sombre' },
  // Le TERRE : or assourdi, rose brique, filets brun dore. Palette de la maquette maison
  // black-versailles. Attention : la maquette d origine changeait aussi la typographie et
  // les formes (serif, losanges) -- ce theme ne porte que son chromatisme.
  { id: 'black-versailles', libelle: 'Black Versailles', base: 'sombre' },
  // TROIS CLAIRS DE PLUS, chacun pendant d un sombre. Base CLAIRE : c est elle qui
  // commande la variante d accent, les teintes de nuit etant illisibles sur fond clair.
  // Aucune maquette maison n en proposait (les douze sont sombres, mesure du 2026-09-07) :
  // ces palettes sont PROPOSEES, a corriger a l oeil.
  { id: 'ardoise', libelle: 'Ardoise', base: 'clair' },
  { id: 'parchemin', libelle: 'Parchemin', base: 'clair' },
  { id: 'rose-poudre', libelle: 'Rose poudre', base: 'clair' }
]

export const THEME_MODE_STORAGE_KEY = 'autowin-theme-mode.v1'
const THEME_MODE_PAR_DEFAUT: ThemeId = 'sombre'

/** Un identifiant n'est valable que s'il est DANS le registre. */
export function estThemeConnu(valeur: unknown): valeur is ThemeId {
  return typeof valeur === 'string' && THEMES.some((t) => t.id === valeur)
}

/** La base du thème donné, pour choisir la variante d'accent. Inconnu -> sombre. */
export function baseDuTheme(id: ThemeId): ThemeBase {
  return THEMES.find((t) => t.id === id)?.base ?? 'sombre'
}

/** Lit le thème mémorisé. Toute valeur absente, abîmée ou inconnue retombe sur le sombre. */
export function lireThemeMode(): ThemeId {
  try {
    const brut = globalThis.localStorage?.getItem(THEME_MODE_STORAGE_KEY)
    return estThemeConnu(brut) ? brut : THEME_MODE_PAR_DEFAUT
  } catch {
    // localStorage indisponible (contexte de test, mode privé) : le sombre reste le repli.
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
  if (mode === THEME_MODE_PAR_DEFAUT) racine.removeAttribute('data-theme')
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
  if (base === THEME_MODE_PAR_DEFAUT) racine.removeAttribute('data-base')
  else racine.setAttribute('data-base', base)
  accorderBoutonsDeFenetre(racine)
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
function accorderBoutonsDeFenetre(racine: Element): void {
  const pont = (globalThis as { api?: { setTitlebarSymbolColor?: (c: string) => unknown } }).api
  if (!pont?.setTitlebarSymbolColor) return
  try {
    const calculee = globalThis.getComputedStyle?.(racine).getPropertyValue('--text').trim()
    const couleur = enHexadecimal(calculee)
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
