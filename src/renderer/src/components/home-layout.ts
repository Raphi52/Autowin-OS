/**
 * La disposition de la page d'accueil : position et taille des tuiles, en fonctions PURES.
 *
 * Aucune grille, aucun point d'accroche : une tuile occupe le pixel où on l'a posée. C'est une
 * décision de l'utilisateur, prise après avoir REJETÉ une grille à douze colonnes puis un modèle à
 * élan — « je veux pas les lancer je veux les poser ». Les deux conséquences que ce fichier doit
 * garantir sont donc : ce qu'on pose ne bouge plus, et ce qu'on relit est ce qu'on avait posé.
 *
 * Écrit hors React pour que la pose, les bornes et la persistance soient testables sans monter
 * d'interface — c'est là que vivent les défauts, pas dans le rendu.
 */

export type HomeWidgetId =
  | 'mails'
  | 'agenda'
  | 'routines'
  | 'notifications'
  | 'conversations'
  | 'jarvis'
  | 'enregistrements'

export interface HomeWidgetBox {
  id: HomeWidgetId
  /** Pixels depuis le bord gauche de la scène. */
  x: number
  /** Pixels depuis le haut de la scène. */
  y: number
  w: number
  h: number
  /** Profondeur dans la scène, en pixels et NÉGATIVE vers le fond. Décor de relief, pas de layout. */
  z: number
}

export type HomeLayout = HomeWidgetBox[]

/** Sous cette taille un widget ne montre plus rien d'utile ; il n'y a pas de maximum. */
export const MIN_WIDGET_WIDTH = 208
export const MIN_WIDGET_HEIGHT = 116

/** Hauteur de l'étiquette de titre, qui vit AU-DESSUS du panneau et non dedans. */
export const WIDGET_LABEL_HEIGHT = 24

export const HOME_WIDGET_TITLES: Readonly<Record<HomeWidgetId, string>> = {
  mails: 'Interlocuteurs',
  agenda: 'Agenda',
  routines: 'Départs des routines',
  notifications: 'Remontées des agents',
  conversations: 'Conversations',
  jarvis: 'Jarvis',
  enregistrements: 'Enregistrements'
}

/**
 * La disposition d'origine, exprimee en FRACTIONS de la surface et non en pixels.
 *
 * Mesure du 2026-08-21 dans l'app reelle : avec des pixels absolus calibres sur 1440, une fenetre de
 * 491 px de large mettait QUATRE tuiles sur cinq entierement hors champ — la vue etait inutilisable
 * et rien ne le signalait. Une disposition doit se lire par rapport a la surface qui la porte.
 */
interface RelativeSpec {
  /** Colonne, 0-based. */
  col: number
  colSpan: number
  /** Ligne de depart et nombre de lignes occupees, dans une grille de `ROWS` lignes. */
  row: number
  rowSpan: number
  z: number
}

/**
 * Cinq lignes, pas deux.
 *
 * Une grille a deux lignes obligeait a exprimer les hauteurs en fractions libres, et ces fractions
 * DEBORDAIENT leur ligne : mesure du 2026-08-21 dans l'app, la tuile des remontees d'agents (0,58
 * d'une ligne de 0,5) recouvrait la tuile juste en dessous. Avec des lignes entieres, un
 * chevauchement devient impossible par construction — c'est de l'arithmetique, plus du reglage.
 */
const ROWS = 6
/**
 * Deux colonnes demandent plus de rangees : sept tuiles a deux rangees minimum ne tiennent pas sur
 * les six rangees de l'arrangement large.
 */
const MEDIUM_ROWS = 10

const WIDE: Readonly<Record<HomeWidgetId, RelativeSpec>> = {
  mails: { col: 0, colSpan: 1, row: 0, rowSpan: 4, z: 0 },
  // Les enregistrements sont sous les mails : on les consulte apres coup, pas en parlant.
  enregistrements: { col: 0, colSpan: 1, row: 4, rowSpan: 2, z: -50 },
  agenda: { col: 1, colSpan: 1, row: 0, rowSpan: 2, z: -30 },
  routines: { col: 1, colSpan: 1, row: 2, rowSpan: 4, z: -60 },
  notifications: { col: 2, colSpan: 1, row: 0, rowSpan: 2, z: -20 },
  // Jarvis est en colonne de droite, a hauteur d'oeil : c'est l'endroit qu'on regarde en parlant.
  jarvis: { col: 2, colSpan: 1, row: 2, rowSpan: 2, z: -40 },
  conversations: { col: 2, colSpan: 1, row: 4, rowSpan: 2, z: -120 }
}

const MEDIUM: Readonly<Record<HomeWidgetId, RelativeSpec>> = {
  mails: { col: 0, colSpan: 1, row: 0, rowSpan: 3, z: 0 },
  notifications: { col: 1, colSpan: 1, row: 0, rowSpan: 3, z: -20 },
  agenda: { col: 0, colSpan: 1, row: 3, rowSpan: 3, z: -30 },
  // Jarvis fait face aux mails. Aucune ligne a une seule rangee ici : sous deux rangees,
  // MIN_WIDGET_HEIGHT (116 px) depasse le pas de la grille et les tuiles se chevauchent des que la
  // fenetre est courte — c'est le defaut deja mesure le 2026-08-21 sur le hublot (historique).
  jarvis: { col: 1, colSpan: 1, row: 3, rowSpan: 3, z: -40 },
  routines: { col: 1, colSpan: 1, row: 6, rowSpan: 2, z: -60 },
  conversations: { col: 0, colSpan: 1, row: 6, rowSpan: 2, z: -120 },
  enregistrements: { col: 0, colSpan: 1, row: 8, rowSpan: 2, z: -50 }
}

/** L'ordre de lecture en colonne unique : ce qu'on regarde en premier, en haut. */
const NARROW_ORDER: HomeWidgetId[] = [
  'jarvis',
  'enregistrements',
  'notifications',
  'routines',
  'agenda',
  'mails',
  'conversations'
]

/**
 * Marges de la surface.
 *
 * `PAD_TOP` n'est qu'un DEFAUT : la vraie hauteur reservee en haut est celle de l'en-tete, MESUREE au
 * rendu et passee en `top`. Une constante ne peut pas suivre un en-tete qui se replie sur deux
 * rangees quand la fenetre est etroite — a 142 px fixes, les tuiles passaient dessous.
 */
const PAD_X = 28
const PAD_TOP = 142
// Une bande de decor RESTE visible en bas et sur les cotes. Ce n'est pas de la marge decorative :
// mesure du 2026-08-21 sur capture de l'app, cinq tuiles etalees sur toute la surface masquaient le
// decor 3D en entier, et l'effet qu'on venait de construire ne se voyait nulle part.
const PAD_BOTTOM = 58
const GAP = 20
/**
 * Ecart VERTICAL entre deux rangees.
 *
 * Il ne peut pas valoir `GAP` : l'etiquette de titre vit AU-DESSUS du panneau
 * (`WIDGET_LABEL_HEIGHT`, 24 px) et se pose donc DANS cet ecart. A 20 px, le titre d'une tuile
 * mordait le bas de la tuile du dessus — constate sur capture de l'app le 2026-09-01,
 * « ENREGISTREMENTS » ecrit par-dessus la derniere ligne d'« Interlocuteurs ». L'ecart horizontal,
 * lui, ne porte aucune etiquette et reste a `GAP`.
 */
const V_GAP = WIDGET_LABEL_HEIGHT + 8
/**
 * Largeur maximale d'une colonne.
 *
 * Sans plafond, les tuiles s'etirent pour remplir un ecran large et le decor disparait derriere
 * elles. Le bloc est alors CENTRE, ce qui laisse une bande de decor symetrique de chaque cote.
 */
const MAX_COLUMN_WIDTH = 384
/**
 * Part de la largeur utile laissee au decor, a DROITE.
 *
 * Le bloc etait CENTRE : sur une surface de 1514 px, cela laissait ~420 px de vide a gauche, entre la
 * barre laterale et la premiere colonne, pendant que les sujets de mails etaient tronques faute de
 * place. Deux bandes depareillees se lisent comme une erreur de mise en page ; une seule bande, du
 * cote ou le decor porte ses planetes, se lit comme un choix. Releve en pilotant l'app le 2026-08-21.
 */
const DECOR_BAND = 0.1

/**
 * Materialise la disposition d'origine pour une surface donnee.
 *
 * Trois arrangements, choisis sur la LARGEUR utile : trois colonnes quand il y a la place, deux quand
 * il y en a moyennement, une seule colonne empilee sinon. Le seuil n'est pas esthetique — il decoule
 * de `MIN_WIDGET_WIDTH` : sous 3 x 208 px plus les ecarts, une troisieme colonne serait ecrasee sous
 * sa taille minimale et deborderait.
 */
export function defaultHomeLayout(
  viewport: { width: number; height: number; top?: number } = { width: 1440, height: 900 }
): HomeLayout {
  const top = Math.max(24, Math.round(viewport.top ?? PAD_TOP))
  const usableWidth = Math.max(MIN_WIDGET_WIDTH, viewport.width - PAD_X * 2)
  const usableHeight = Math.max(MIN_WIDGET_HEIGHT * 2, viewport.height - top - PAD_BOTTOM)

  const columns =
    usableWidth >= MIN_WIDGET_WIDTH * 3 + GAP * 2
      ? 3
      : usableWidth >= MIN_WIDGET_WIDTH * 2 + GAP
        ? 2
        : 1

  if (columns === 1) {
    const tuiles = NARROW_ORDER.length
    const height = Math.max(
      MIN_WIDGET_HEIGHT,
      Math.round((usableHeight - GAP * (tuiles - 1)) / tuiles)
    )
    // Le PAS de l'empilement, distinct de la hauteur des tuiles. Sur une surface trop courte, cinq
    // tuiles a leur hauteur minimale ne tiennent pas : empiler pleine hauteur poussait la derniere
    // etiquette SOUS le bord, donc hors d'atteinte. On resserre alors le pas et les tuiles se
    // chevauchent en cascade — un chevauchement se rattrape a la souris, une tuile hors champ non.
    const pitch = Math.min(
      height + GAP,
      Math.max(
        WIDGET_LABEL_HEIGHT + 6,
        Math.floor((usableHeight - MIN_WIDGET_HEIGHT) / (tuiles - 1))
      )
    )
    return NARROW_ORDER.map((id, index) => ({
      id,
      x: PAD_X,
      y: top + index * pitch,
      w: usableWidth,
      h: height,
      z: WIDE[id].z
    }))
  }

  const spec = columns === 3 ? WIDE : MEDIUM
  // La largeur des colonnes suit la surface, avec un plancher a `MAX_COLUMN_WIDTH` : sur un grand
  // ecran, plafonner a 384 px gaspillait la place ET tronquait les sujets en meme temps.
  const largeurBloc = usableWidth * (1 - DECOR_BAND)
  const columnWidth = Math.max(
    MIN_WIDGET_WIDTH,
    Math.min(
      Math.round((usableWidth - GAP * (columns - 1)) / columns),
      Math.max(MAX_COLUMN_WIDTH, Math.round((largeurBloc - GAP * (columns - 1)) / columns))
    )
  )
  const originX = PAD_X
  // Deux colonnes n'ont pas la meme grille que trois : voir `MEDIUM_ROWS`.
  const gridRows = columns === 3 ? ROWS : MEDIUM_ROWS
  const rowHeight = Math.max(24, Math.round((usableHeight - V_GAP * (gridRows - 1)) / gridRows))

  return HOME_WIDGET_IDS.map((id) => {
    const entry = spec[id]
    return {
      id,
      x: originX + entry.col * (columnWidth + GAP),
      y: top + entry.row * (rowHeight + V_GAP),
      w: columnWidth * entry.colSpan + GAP * (entry.colSpan - 1),
      // La hauteur inclut les ecarts ENJAMBES : sans eux, une tuile sur trois lignes finit deux
      // ecarts trop courte et la colonne parait mal alignee.
      h: Math.max(MIN_WIDGET_HEIGHT, rowHeight * entry.rowSpan + V_GAP * (entry.rowSpan - 1)),
      z: entry.z
    }
  })
}

export const HOME_WIDGET_IDS: HomeWidgetId[] = [
  'mails',
  'enregistrements',
  'agenda',
  'routines',
  'notifications',
  'conversations',
  'jarvis'
]

export function clampWidgetBox(
  box: HomeWidgetBox,
  viewport: { width: number; height: number; top?: number }
): HomeWidgetBox {
  const w = Math.max(MIN_WIDGET_WIDTH, Math.round(box.w))
  const h = Math.max(MIN_WIDGET_HEIGHT, Math.round(box.h))
  // Un tiers de la tuile suffit à la reprendre ; en exiger plus la ferait sauter dès qu'on la pose
  // volontairement en bord d'écran.
  const grip = 0.34
  const x = Math.min(Math.max(-w * (1 - grip), Math.round(box.x)), viewport.width - w * grip)
  // Le haut reserve borne la remontee : sous l'en-tete, l'etiquette d'une tuile est illisible et sa
  // poignee inaccessible.
  const top = Math.max(0, Math.round(viewport.top ?? 0))
  const y = Math.min(Math.max(top, Math.round(box.y)), viewport.height - WIDGET_LABEL_HEIGHT * 2)
  return { id: box.id, x, y, w, h, z: box.z }
}

/**
 * Applique un déplacement ou un redimensionnement.
 *
 * Le déplacement et le redimensionnement sont la même opération vue de deux côtés : « cette tuile
 * occupe désormais cette boîte ». Tirer un bord OUEST ou NORD déplace aussi l'origine, sinon la tuile
 * grandirait du mauvais côté et le geste mentirait.
 */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

export function resizeWidgetBox(
  from: HomeWidgetBox,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewport: { width: number; height: number; top?: number }
): HomeWidgetBox {
  let { x, y, w, h } = from
  if (edge.includes('e')) w = Math.max(MIN_WIDGET_WIDTH, from.w + dx)
  if (edge.includes('s')) h = Math.max(MIN_WIDGET_HEIGHT, from.h + dy)
  if (edge.includes('w')) {
    w = Math.max(MIN_WIDGET_WIDTH, from.w - dx)
    x = from.x + (from.w - w)
  }
  if (edge.includes('n')) {
    h = Math.max(MIN_WIDGET_HEIGHT, from.h - dy)
    y = from.y + (from.h - h)
  }
  return clampWidgetBox({ ...from, x, y, w, h }, viewport)
}

export function moveWidgetBox(
  from: HomeWidgetBox,
  dx: number,
  dy: number,
  viewport: { width: number; height: number; top?: number }
): HomeWidgetBox {
  return clampWidgetBox({ ...from, x: from.x + dx, y: from.y + dy }, viewport)
}

export function replaceWidget(layout: HomeLayout, box: HomeWidgetBox): HomeLayout {
  return layout.map((entry) => (entry.id === box.id ? box : entry))
}

/**
 * Relit une disposition persistée.
 *
 * Les boîtes enregistrées sont rendues TELLES QUELLES : les « ranger » à la relecture ferait remonter
 * une tuile que l'utilisateur avait délibérément posée ailleurs, et la disposition ne survivrait donc
 * pas au redémarrage — c'est exactement la promesse du widget déplaçable.
 *
 * Un widget absent revient à son défaut : sans cela, ajouter un widget dans une version suivante le
 * rendrait invisible chez tout utilisateur ayant déjà une disposition enregistrée. Une entrée
 * inconnue ou mal formée est jetée sans bruit.
 */
export function parseHomeLayout(
  raw: unknown,
  viewport: { width: number; height: number } = { width: 1440, height: 900 }
): HomeLayout {
  const fallback = defaultHomeLayout(viewport)
  if (!Array.isArray(raw)) return fallback
  const known = new Map<HomeWidgetId, HomeWidgetBox>()
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as Record<string, unknown>
    const id = candidate.id
    if (typeof id !== 'string' || !HOME_WIDGET_IDS.includes(id as HomeWidgetId)) continue
    const numbers = [candidate.x, candidate.y, candidate.w, candidate.h, candidate.z ?? 0]
    if (numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value))) continue
    const [x, y, w, h, z] = numbers as number[]
    known.set(id as HomeWidgetId, {
      id: id as HomeWidgetId,
      x: Math.round(x),
      y: Math.round(y),
      w: Math.max(MIN_WIDGET_WIDTH, Math.round(w)),
      h: Math.max(MIN_WIDGET_HEIGHT, Math.round(h)),
      z
    })
  }
  if (known.size === 0) return fallback
  return fallback.map((box) => known.get(box.id) ?? box)
}

/**
 * Ramene une disposition dans la surface disponible.
 *
 * Appelee au montage et a chaque redimensionnement de la vue. C'est la parade au defaut mesure le
 * 2026-08-21 : une disposition enregistree sur un ecran large rendait quatre tuiles sur cinq
 * INATTEIGNABLES apres reduction de la fenetre, sans aucun signe.
 *
 * Volontairement un simple RECADRAGE, pas un rearrangement : une tuile deja visible n'est pas
 * touchee (la fonction est alors l'identite), et une tuile hors champ revient au bord le plus proche
 * plutot que d'etre replacee « proprement » — deplacer ce que l'utilisateur avait pose reste le
 * dernier recours, jamais le premier.
 */
export function fitLayoutToViewport(
  layout: HomeLayout,
  viewport: { width: number; height: number; top?: number }
): HomeLayout {
  return layout.map((box) =>
    clampWidgetBox(
      { ...box, w: Math.min(box.w, Math.max(MIN_WIDGET_WIDTH, viewport.width - PAD_X * 2)) },
      viewport
    )
  )
}

/**
 * Une disposition enregistree est-elle ENCORE une disposition pour cette surface ?
 *
 * Un simple recadrage ne suffit pas. Mesure du 2026-08-21 dans l'app, fenetre de 491 px : une
 * disposition posee sur trois colonnes larges, une fois recadree, empilait cinq tuiles de 376 px sur
 * une surface de 405 — elles se recouvraient a 155 % de la surface et le decor disparaissait derriere.
 * Recadrer corrige la POSITION ; ca ne transforme pas un arrangement en trois colonnes en un
 * arrangement en une colonne.
 *
 * Le critere est donc la surface CUMULEE : au-dela de la surface disponible, l'arrangement ne tient
 * structurellement pas, quoi qu'on recadre. On repart alors de la disposition d'origine pour cette
 * surface — c'est un dernier recours, et il est nomme.
 */
export function layoutFitsViewport(
  layout: HomeLayout,
  viewport: { width: number; height: number; top?: number }
): boolean {
  const surface = Math.max(1, viewport.width * viewport.height)
  const couvert = layout.reduce((total, box) => total + box.w * box.h, 0)
  if (couvert > surface * 1.12) return false
  // Une tuile plus large que la surface utile ne pourra jamais s'y poser proprement.
  if (layout.some((box) => box.w > viewport.width)) return false
  // Et aucune tuile ne doit DEBORDER du cadre a droite.
  //
  // Ce controle manquait, et le trou etait exactement du meme genre que celui qu'il devait empecher :
  // mesure du 2026-08-21 dans l'app, un agencement issu d'un ecran de 1920 px « tenait » par son aire
  // (0,93 de la surface) et par la largeur de chaque tuile, tout en depassant le bord droit de 180 px.
  // Un debordement que PERSONNE n'a choisi n'est pas une disposition valide pour cette surface.
  return layout.every((box) => box.x + box.w <= viewport.width)
}

/**
 * La disposition a utiliser pour cette surface : celle qui etait enregistree si elle tient encore,
 * sinon celle d'origine.
 */
export function reconcileLayout(
  stored: HomeLayout,
  viewport: { width: number; height: number; top?: number }
): HomeLayout {
  const recadre = fitLayoutToViewport(stored, viewport)
  return layoutFitsViewport(recadre, viewport) ? recadre : defaultHomeLayout(viewport)
}

export function serializeHomeLayout(layout: HomeLayout): string {
  return JSON.stringify(layout)
}

/** Disperse les tuiles dans la fenêtre. Sert la démonstration, et rien d'autre. */
export function scatterHomeLayout(
  layout: HomeLayout,
  viewport: { width: number; height: number },
  random: () => number
): HomeLayout {
  return layout.map((box) =>
    clampWidgetBox(
      {
        ...box,
        x: 30 + random() * Math.max(80, viewport.width - box.w - 60),
        y: 110 + random() * Math.max(80, viewport.height - box.h - 150),
        z: -220 + random() * 210
      },
      viewport
    )
  )
}
