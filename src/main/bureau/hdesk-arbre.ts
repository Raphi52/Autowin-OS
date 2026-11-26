import { execFile } from 'node:child_process'
import { join } from 'node:path'
import {
  COORDONNEE_MAX,
  ELEMENT_MAX,
  ID_BUREAU,
  estGesteElement,
  refusAct,
  type GesteElement,
  type GesteTv,
  type ImageTv,
  type OrigineCapture,
  type ResultatGeste
} from './hdesk-tv'

/**
 * ARBRE D'ACCESSIBILITÉ DU BUREAU CACHÉ, POUR LES OUTILS DU CHAT.
 *
 * Constat du 2026-11-03 : dans un bureau caché, un agent ne visait que des pixels. Il lisait mal une
 * capture unie, ses clics restaient sans effet sur une fenêtre WPF non agrandie, et il visait FAUX
 * dès que la capture était recadrée : `bureau_cache_observer` rend l'image recadrée de
 * scripts/hdesk-tv.ps1 (mesure : origine (7,57) pour la Table des caractères), mais
 * `bureau_cache_agir` envoyait ses x/y tels quels à hdesk-act.ps1, qui attend des pixels de l'ÉCRAN du
 * bureau. La petite TV, elle, ajoutait déjà l'origine (`CapteurHdesk.versEcran`).
 *
 * D'où `outilsBureauCacheDuChat` : l'observation joint l'arbre en texte (positions en pixels de
 * l'IMAGE), et l'action convertit x/y comme la TV, ou appuie par nom (scripts/hdesk-act.ps1 -Element).
 *
 * LECTURE PAR ZONE (2026-11-26, reprise de la lecture par racine de vercel-labs/agent-desktop) : le texte
 * est borné à ARBRE_TEXTE_MAX ; sur un écran WPF chargé (95 éléments), il s'arrêtait au 4e des 9
 * scénarios visibles, et le reste était perdu sans moyen de le demander. Quand le texte déborde, il
 * propose maintenant les ZONES où ce reste se trouve, et `racine` (bureau_cache_observer) relit une zone
 * seule : seuls ses descendants, avec leurs propres repères.
 */

/** Éléments rendus par scripts/hdesk-arbre.ps1 ; le reste est compté dans `omis`. */
export const ARBRE_PLAFOND = 500
/** Texte de l'arbre joint à une observation : il entre dans le contexte du modèle à chaque capture. */
export const ARBRE_TEXTE_MAX = 4000
/**
 * Lecture de l'arbre : PowerShell + chargement du C# (compilé une fois, scripts/hdesk-types.ps1),
 * plus l'arbre lui-même — mesure du 2026-11-08 : 0,6 à 0,9 s pour la Table des caractères.
 */
const ARBRE_DELAI_MS = 20_000

export interface ElementArbre {
  /** Repère `@<lecture>:e<n>` : vise CET élément, refusé s'il a disparu ou changé depuis la lecture. */
  ref?: string
  type: string
  nom?: string
  id?: string
  libelle?: string
  techno?: string
  actif: boolean
  /** Rectangle en pixels de l'ÉCRAN du bureau ; absent = élément sans position. */
  x?: number
  y?: number
  largeur?: number
  hauteur?: number
  horsEcran?: boolean
  coche?: string
  valeur?: string
  /** Champ dont la valeur se remplit par `valeur` dans bureau_cache_agir (jamais un mot de passe). */
  modifiable?: boolean
  fenetre: number
}

export interface ArbreHdesk {
  /** Identifiant de la lecture, celui des repères ; absent d'un ancien script. */
  lecture?: string
  /** Lecture d'une zone (`-Racine`) : l'élément lu, dont `elements` sont les descendants. */
  racine?: ElementArbre
  fenetres: string[]
  total: number
  omis: number
  elements: ElementArbre[]
}

/** `code` : celui d'un refus de la zone demandée (« [PERIME] … », scripts/hdesk-arbre.ps1). */
export type LectureArbre =
  { ok: true; arbre: ArbreHdesk } | { ok: false; message: string; code?: string }

/**
 * Lire une seule zone : `racine` = repère @lecture:eN, id, nom ou libellé d'un élément ; `origine` =
 * celle de l'image regardée, pour que les positions citées dans un refus soient celles de l'image.
 */
export interface OptionsLecture {
  racine?: string
  origine?: OrigineCapture
}

export function argumentsArbre(
  dossierScripts: string,
  id: string,
  plafond = ARBRE_PLAFOND,
  options: OptionsLecture = {}
): string[] {
  if (typeof id !== 'string' || !ID_BUREAU.test(id))
    throw new Error('Identifiant de bureau invalide.')
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(dossierScripts, 'scripts', 'hdesk-arbre.ps1'),
    '-InstanceId',
    id,
    '-Plafond',
    String(plafond)
  ]
  const racine = typeof options.racine === 'string' ? options.racine.trim() : ''
  if (!racine) return args
  if (racine.length > ELEMENT_MAX)
    throw new Error(`Racine trop longue (${ELEMENT_MAX} caractères au plus).`)
  // Valeur COLLÉE au paramètre : séparée, une racine qui commence par un tiret (« — ») est lue par
  // PowerShell comme un nom de paramètre, et le script sort en code 2 sans message (mesure du 2026-11-26).
  args.push(`-Racine:${racine}`)
  const o = options.origine
  if (o && Number.isInteger(o.x) && Number.isInteger(o.y) && o.x >= 0 && o.y >= 0)
    args.push(
      '-OrigineX',
      String(Math.min(o.x, COORDONNEE_MAX)),
      '-OrigineY',
      String(Math.min(o.y, COORDONNEE_MAX))
    )
  return args
}

/** hdesk-arbre.ps1 écrit une ligne JSON ; tout autre forme est une lecture ratée, jamais un arbre vide. */
export function interpreterArbre(out: string): LectureArbre {
  const lignes = String(out ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
  const derniere = lignes.at(-1)
  if (!derniere) return { ok: false, message: 'Sortie de hdesk-arbre.ps1 illisible.' }
  try {
    const brut = JSON.parse(derniere) as Partial<ArbreHdesk>
    if (!Array.isArray(brut.elements) || !Array.isArray(brut.fenetres))
      return { ok: false, message: 'Sortie de hdesk-arbre.ps1 illisible.' }
    return {
      ok: true,
      arbre: {
        ...(typeof brut.lecture === 'string' && brut.lecture ? { lecture: brut.lecture } : {}),
        ...(brut.racine && typeof brut.racine === 'object' ? { racine: brut.racine } : {}),
        fenetres: brut.fenetres.map(String),
        total: Number.isFinite(brut.total) ? Number(brut.total) : brut.elements.length,
        omis: Number.isFinite(brut.omis) ? Number(brut.omis) : 0,
        elements: brut.elements.filter((e): e is ElementArbre => !!e && typeof e === 'object')
      }
    }
  } catch {
    return { ok: false, message: 'Sortie de hdesk-arbre.ps1 illisible.' }
  }
}

export function lireArbreHdesk(
  dossierScripts: string,
  id: string,
  options: OptionsLecture = {}
): Promise<LectureArbre> {
  let args: string[]
  try {
    args = argumentsArbre(dossierScripts, id, ARBRE_PLAFOND, options)
  } catch (e) {
    return Promise.resolve({ ok: false, message: (e as Error).message })
  }
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      args,
      { windowsHide: true, timeout: ARBRE_DELAI_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, out, errOut) => {
        // Un refus de la zone porte son code en tête (« [PERIME] … »), comme un appui refusé.
        if (err) resolve(refusAct(String(errOut || err.message).trim()))
        else resolve(interpreterArbre(String(out)))
      }
    )
  })
}

/** Contrôles d'abord : 200 cases d'une grille ne doivent pas cacher les boutons dans 4 000 caractères. */
const CONTROLES = new Set([
  'Button',
  'CheckBox',
  'RadioButton',
  'Edit',
  'ComboBox',
  'MenuItem',
  'TabItem',
  'Hyperlink',
  'SplitButton'
])

/**
 * Conteneurs proposés quand le texte déborde : les mêmes types que `Zones` de scripts/hdesk-arbre.cs, qui
 * les garde même sans nom pour qu'ils portent un repère.
 */
const ZONES = new Set([
  'List',
  'Tree',
  'Table',
  'DataGrid',
  'Tab',
  'Group',
  'Pane',
  'Document',
  'ToolBar',
  'Custom'
])
/** Zones citées au plus quand le texte déborde, et place gardée pour elles. */
const ZONES_MAX = 6
const ZONES_RESERVE = 700
/** Place gardée pour la ligne finale (« … N élément(s) non montré(s) : … »). */
const FIN_RESERVE = 220
/** Nom d'une zone dans la liste des zones : un titre de 200 caractères mangerait la place des autres. */
const ZONE_NOM_MAX = 60

const nomme = (e: ElementArbre): boolean => !!(e.nom || e.libelle || e.id)
const avecRect = (e: ElementArbre): boolean =>
  Number.isFinite(e.x) &&
  Number.isFinite(e.y) &&
  Number.isFinite(e.largeur) &&
  Number.isFinite(e.hauteur)
const centre = (e: ElementArbre, o: OrigineCapture): string =>
  `(${Math.round(e.x! + e.largeur! / 2 - o.x)},${Math.round(e.y! + e.hauteur! / 2 - o.y)})`

function ligneElement(e: ElementArbre, o: OrigineCapture): string {
  const montre = e.nom || e.libelle || ''
  let l = `${e.type}${montre ? ` « ${montre} »` : ''}`
  if (typeof e.ref === 'string' && e.ref) l += ` ${e.ref}`
  if (e.id && e.id !== montre) l += ` id=${e.id}`
  if (Number.isFinite(e.x) && Number.isFinite(e.largeur)) l += ` ${centre(e, o)}`
  if (e.actif === false) l += ' inactif'
  if (e.coche) l += ` coché=${e.coche}`
  if (typeof e.valeur === 'string' && e.valeur) l += ` valeur=« ${e.valeur} »`
  if (e.modifiable === true) l += ' remplissable'
  return l
}

function nomDeZone(z: ElementArbre): string {
  const montre = z.nom || z.libelle || z.id || ''
  const court = montre.length > ZONE_NOM_MAX ? `${montre.slice(0, ZONE_NOM_MAX - 1)}…` : montre
  const ref = typeof z.ref === 'string' && z.ref ? ` ${z.ref}` : ''
  return `${z.type}${court ? ` « ${court} »` : ''}${ref}`
}

export interface ZoneARelire {
  zone: ElementArbre
  /** Éléments non montrés dont le centre tombe dans la zone. */
  caches: number
  /** Éléments lisibles dans la zone, montrés ou non. */
  total: number
}

/**
 * Zones où se trouve ce qui n'a pas tenu dans le texte : un conteneur à l'écran, avec un repère, qui
 * contient (centre dans son rectangle, même fenêtre) au moins un élément non montré. Les plus chargées
 * d'abord ; à compte égal, la plus petite, et une zone qui ne cache rien de plus qu'une zone déjà citée
 * en elle est tue.
 */
export function zonesARelire(
  elements: ElementArbre[],
  nonMontres: ElementArbre[],
  max = ZONES_MAX
): ZoneARelire[] {
  const dans = (z: ElementArbre, e: ElementArbre): boolean => {
    if (e === z || e.fenetre !== z.fenetre || !avecRect(e)) return false
    const cx = e.x! + e.largeur! / 2
    const cy = e.y! + e.hauteur! / 2
    return cx >= z.x! && cx <= z.x! + z.largeur! && cy >= z.y! && cy <= z.y! + z.hauteur!
  }
  const contientRect = (grand: ElementArbre, petit: ElementArbre): boolean =>
    petit.x! >= grand.x! &&
    petit.y! >= grand.y! &&
    petit.x! + petit.largeur! <= grand.x! + grand.largeur! &&
    petit.y! + petit.hauteur! <= grand.y! + grand.hauteur!
  const lisibles = elements.filter((e) => !e.horsEcran && nomme(e))
  const candidates = elements
    .filter((z) => ZONES.has(z.type) && !z.horsEcran && !!z.ref && avecRect(z))
    .map((zone) => ({
      zone,
      caches: nonMontres.filter((e) => dans(zone, e)).length,
      total: lisibles.filter((e) => dans(zone, e)).length,
      aire: zone.largeur! * zone.hauteur!
    }))
    .filter((c) => c.caches > 0)
    .sort((a, b) => b.caches - a.caches || a.aire - b.aire)
  const choisies: typeof candidates = []
  for (const c of candidates) {
    if (choisies.some((d) => d.caches === c.caches && contientRect(c.zone, d.zone))) continue
    choisies.push(c)
    if (choisies.length >= max) break
  }
  return choisies.map(({ zone, caches, total }) => ({ zone, caches, total }))
}

/**
 * L'arbre en texte court pour l'agent : positions = CENTRE en pixels de l'image jointe (origine du
 * recadrage retirée), éléments hors écran tus, `max` caractères au plus avec le compte du reste. Quand
 * il déborde, il cite les zones où lire ce reste (`racine` de bureau_cache_observer). Un conteneur sans
 * nom n'est cité que là : seul, il ne dit rien à l'agent.
 */
export function texteArbre(
  lecture: LectureArbre,
  origine: OrigineCapture | undefined,
  max = ARBRE_TEXTE_MAX
): string {
  if (!lecture.ok)
    return `Arbre d'accessibilité indisponible (${lecture.message}) : vise x/y sur l'image.`
  const { arbre } = lecture
  const zone = arbre.racine
  const lisibles = arbre.elements.filter((e) => !e.horsEcran && nomme(e))
  if (lisibles.length === 0)
    return zone
      ? `Zone ${nomDeZone(zone)} : aucun élément lisible dedans. Relis sans \`racine\`, ou vise x/y sur l'image.`
      : "Aucun élément lisible dans ce bureau (page web, rendu GPU ou fenêtre sans arbre d'accessibilité) : vise x/y sur l'image."
  const o = origine ?? { x: 0, y: 0 }
  const rang = (e: ElementArbre): number => (CONTROLES.has(e.type) ? 0 : 1)
  const ordonnes = lisibles
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.fenetre - b.e.fenetre || rang(a.e) - rang(b.e) || a.i - b.i)
    .map((x) => x.e)
  const tete =
    (zone ? `Zone ${nomDeZone(zone)} lue seule : ses éléments, avec leurs propres repères. ` : '') +
    (arbre.lecture
      ? `Arbre d'accessibilité, lecture ${arbre.lecture} (position = centre, en pixels de cette image). ` +
        'bureau_cache_agir : `element` = repère @…:eN (le plus sûr : refusé si l’élément a changé depuis cette lecture), id, nom ou libellé, à la place de x/y ; `valeur` remplit un champ remplissable.'
      : "Arbre d'accessibilité (position = centre, en pixels de cette image). " +
        'bureau_cache_agir accepte `element` = id, nom ou libellé, à la place de x/y.')
  const remplir = (budget: number): { lignes: string[]; montres: Set<ElementArbre> } => {
    const lignes = [tete]
    const montres = new Set<ElementArbre>()
    let taille = tete.length
    let fenetre = -1
    for (const e of ordonnes) {
      const morceaux: string[] = []
      if (e.fenetre !== fenetre) morceaux.push(`[Fenêtre « ${arbre.fenetres[e.fenetre] ?? '?'} »]`)
      morceaux.push(ligneElement(e, o))
      const ajout = morceaux.reduce((n, m) => n + m.length + 1, 0)
      if (taille + ajout > budget) break
      lignes.push(...morceaux)
      taille += ajout
      fenetre = e.fenetre
      montres.add(e)
    }
    return { lignes, montres }
  }
  const caches = (montres: Set<ElementArbre>): ElementArbre[] =>
    ordonnes.filter((e) => !montres.has(e))
  const titreZones =
    'Zones où lire le reste — bureau_cache_observer avec `racine` = le repère de la zone :'
  // Lignes des zones dans `place` caractères (titre compris) ; aucune zone = rien, pas même le titre.
  const lignesZones = (zones: ZoneARelire[], place: number): string[] => {
    const l = [titreZones]
    let reste = place - titreZones.length - 1
    for (const z of zones) {
      const ligne = `${nomDeZone(z.zone)} ${centre(z.zone, o)} : ${z.caches} non montré(s) sur ${z.total}`
      if (ligne.length + 1 > reste) break
      l.push(ligne)
      reste -= ligne.length + 1
    }
    return l.length > 1 ? l : []
  }
  let rendu = remplir(max - FIN_RESERVE)
  let zones: string[] = []
  if (rendu.montres.size < ordonnes.length) {
    // Le texte déborde : on garde de la place pour dire OÙ est le reste, puis on rend aux éléments ce
    // que les zones n'ont pas pris. Plus d'éléments montrés = moins de cachés : la seconde liste de
    // zones n'est jamais plus longue que la première (marge pour les comptes qui changent de chiffres).
    const reduit = remplir(max - FIN_RESERVE - ZONES_RESERVE)
    const premieres = lignesZones(
      zonesARelire(arbre.elements, caches(reduit.montres)),
      ZONES_RESERVE
    )
    if (premieres.length > 0) {
      const place = premieres.reduce((n, l) => n + l.length + 1, 0) + 20
      const ajuste = remplir(max - FIN_RESERVE - place)
      const secondes = lignesZones(zonesARelire(arbre.elements, caches(ajuste.montres)), place)
      if (secondes.length > 0) {
        rendu = ajuste
        zones = secondes
      } else {
        rendu = reduit
        zones = premieres
      }
    }
  }
  const lignes = [...rendu.lignes, ...zones]
  const coupes = ordonnes.length - rendu.montres.size
  const horsEcran = arbre.elements.filter((e) => e.horsEcran && nomme(e)).length
  const parts: string[] = []
  if (coupes > 0) parts.push(`${coupes} au-delà de la limite de ce texte`)
  if (arbre.omis > 0) parts.push(`${arbre.omis} au-delà du plafond de lecture`)
  if (horsEcran > 0) parts.push(`${horsEcran} hors écran`)
  if (parts.length > 0) {
    const suite =
      coupes + arbre.omis === 0
        ? ''
        : zones.length > 0
          ? ' Lis une zone ci-dessus.'
          : ' Relis une zone avec `racine` = repère, id ou nom d’un conteneur.'
    lignes.push(
      `… ${coupes + arbre.omis + horsEcran} élément(s) non montré(s) : ${parts.join(', ')}.${suite}`
    )
  }
  return lignes.join('\n')
}

export interface DependancesOutilsChat {
  /** Le capteur de la petite TV : mêmes images, mêmes origines de recadrage. */
  capteur: () => {
    image: (id: string) => Promise<ImageTv>
    versEcran: (g: GesteTv) => GesteTv
    origine: (id: string) => OrigineCapture | undefined
  }
  lireArbre: (id: string, options?: OptionsLecture) => Promise<LectureArbre>
  agir: (g: GesteTv | GesteElement) => Promise<ResultatGeste>
}

export type ImageAvecArbre = ImageTv & { arbre?: string }

export function outilsBureauCacheDuChat(d: DependancesOutilsChat): {
  /** `racine` : lire une seule zone (repère, id, nom ou libellé d'un élément) au lieu de tout l'arbre. */
  observer: (id: string, racine?: string) => Promise<ImageAvecArbre>
  agir: (g: GesteTv | GesteElement) => Promise<ResultatGeste>
} {
  return {
    async observer(id, racine) {
      const img = await d.capteur().image(id)
      if (img.statut !== 'ok' && img.statut !== 'uni') return img
      // L'arbre APRÈS l'image : son origine est celle de l'image que l'agent va lire. Une panne de
      // l'arbre ne coûte jamais la capture.
      const origine = d.capteur().origine(id)
      const zone = typeof racine === 'string' ? racine.trim() : ''
      let lecture: LectureArbre
      try {
        lecture = await d.lireArbre(id, zone ? { racine: zone, origine } : undefined)
      } catch (e) {
        lecture = { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
      if (zone && !lecture.ok)
        return {
          ...img,
          arbre: `Zone « ${zone} » non lue${lecture.code ? ` [${lecture.code}]` : ''} : ${lecture.message}`
        }
      return { ...img, arbre: texteArbre(lecture, origine) }
    },
    agir(g) {
      if (estGesteElement(g)) return d.agir({ ...g, origine: d.capteur().origine(g.id) })
      // x/y de l'image recadrée → pixels de l'écran du bureau, comme la petite TV.
      return d.agir(d.capteur().versEcran(g))
    }
  }
}
