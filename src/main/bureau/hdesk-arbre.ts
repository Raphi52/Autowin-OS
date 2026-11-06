import { execFile } from 'node:child_process'
import { join } from 'node:path'
import {
  ID_BUREAU,
  estGesteElement,
  type GesteElement,
  type GesteTv,
  type ImageTv,
  type OrigineCapture,
  type ResultatGeste
} from './hdesk-tv'

/**
 * ARBRE D'ACCESSIBILITÉ DU BUREAU CACHÉ, POUR LES OUTILS DU CHAT (conv-1457).
 *
 * Constat du 2026-11-03 : dans un bureau caché, un agent ne visait que des pixels. Il lisait mal une
 * capture unie, ses clics restaient sans effet sur une fenêtre WPF non agrandie, et il visait FAUX
 * dès que la capture était recadrée : `bureau_cache_observer` rend l'image recadrée de
 * scripts/hdesk-tv.ps1 (mesure : origine (7,57) pour la Table des caractères), mais
 * `bureau_cache_agir` envoyait ses x/y tels quels à hdesk-act.ps1, qui attend des pixels de l'ÉCRAN du
 * bureau. La petite TV, elle, ajoutait déjà l'origine (`CapteurHdesk.versEcran`, conv-1009).
 *
 * D'où `outilsBureauCacheDuChat` : l'observation joint l'arbre en texte (positions en pixels de
 * l'IMAGE), et l'action convertit x/y comme la TV, ou appuie par nom (scripts/hdesk-act.ps1 -Element).
 */

/** Éléments rendus par scripts/hdesk-arbre.ps1 ; le reste est compté dans `omis`. */
export const ARBRE_PLAFOND = 500
/** Texte de l'arbre joint à une observation : il entre dans le contexte du modèle à chaque capture. */
export const ARBRE_TEXTE_MAX = 4000
/** Lecture de l'arbre : PowerShell + compilation du C# (≈ 1 à 3 s), plus l'arbre lui-même. */
const ARBRE_DELAI_MS = 20_000

export interface ElementArbre {
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
  fenetre: number
}

export interface ArbreHdesk {
  fenetres: string[]
  total: number
  omis: number
  elements: ElementArbre[]
}

export type LectureArbre = { ok: true; arbre: ArbreHdesk } | { ok: false; message: string }

export function argumentsArbre(racine: string, id: string, plafond = ARBRE_PLAFOND): string[] {
  if (typeof id !== 'string' || !ID_BUREAU.test(id))
    throw new Error('Identifiant de bureau invalide.')
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(racine, 'scripts', 'hdesk-arbre.ps1'),
    '-InstanceId',
    id,
    '-Plafond',
    String(plafond)
  ]
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

export function lireArbreHdesk(racine: string, id: string): Promise<LectureArbre> {
  let args: string[]
  try {
    args = argumentsArbre(racine, id)
  } catch (e) {
    return Promise.resolve({ ok: false, message: (e as Error).message })
  }
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      args,
      { windowsHide: true, timeout: ARBRE_DELAI_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, out, errOut) => {
        if (err) resolve({ ok: false, message: String(errOut || err.message).trim() })
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

function ligneElement(e: ElementArbre, o: OrigineCapture): string {
  const montre = e.nom || e.libelle || ''
  let l = `${e.type}${montre ? ` « ${montre} »` : ''}`
  if (e.id && e.id !== montre) l += ` id=${e.id}`
  if (Number.isFinite(e.x) && Number.isFinite(e.largeur))
    l += ` (${Math.round(e.x! + e.largeur! / 2 - o.x)},${Math.round(e.y! + e.hauteur! / 2 - o.y)})`
  if (e.actif === false) l += ' inactif'
  if (e.coche) l += ` coché=${e.coche}`
  if (typeof e.valeur === 'string' && e.valeur) l += ` valeur=« ${e.valeur} »`
  return l
}

/**
 * L'arbre en texte court pour l'agent : positions = CENTRE en pixels de l'image jointe (origine du
 * recadrage retirée), éléments hors écran tus, `max` caractères au plus avec le compte du reste.
 */
export function texteArbre(
  lecture: LectureArbre,
  origine: OrigineCapture | undefined,
  max = ARBRE_TEXTE_MAX
): string {
  if (!lecture.ok)
    return `Arbre d'accessibilité indisponible (${lecture.message}) : vise x/y sur l'image.`
  const { arbre } = lecture
  const visibles = arbre.elements.filter((e) => !e.horsEcran)
  if (visibles.length === 0)
    return "Aucun élément lisible dans ce bureau (page web, rendu GPU ou fenêtre sans arbre d'accessibilité) : vise x/y sur l'image."
  const o = origine ?? { x: 0, y: 0 }
  const rang = (e: ElementArbre): number => (CONTROLES.has(e.type) ? 0 : 1)
  const ordonnes = visibles
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.fenetre - b.e.fenetre || rang(a.e) - rang(b.e) || a.i - b.i)
    .map((x) => x.e)
  const tete =
    "Arbre d'accessibilité (position = centre, en pixels de cette image). " +
    'bureau_cache_agir accepte `element` = id, nom ou libellé, à la place de x/y.'
  const lignes = [tete]
  let taille = tete.length
  let montres = 0
  let fenetre = -1
  for (const e of ordonnes) {
    const morceaux: string[] = []
    if (e.fenetre !== fenetre) morceaux.push(`[Fenêtre « ${arbre.fenetres[e.fenetre] ?? '?'} »]`)
    morceaux.push(ligneElement(e, o))
    const ajout = morceaux.reduce((n, m) => n + m.length + 1, 0)
    // Réserve pour la ligne finale « N éléments non montrés ».
    if (taille + ajout > max - 80) break
    lignes.push(...morceaux)
    taille += ajout
    fenetre = e.fenetre
    montres++
  }
  const reste = arbre.elements.length - montres + arbre.omis
  if (reste > 0)
    lignes.push(`… ${reste} élément(s) non montré(s) (hors écran ou au-delà de la limite).`)
  return lignes.join('\n')
}

export interface DependancesOutilsChat {
  /** Le capteur de la petite TV : mêmes images, mêmes origines de recadrage. */
  capteur: () => {
    image: (id: string) => Promise<ImageTv>
    versEcran: (g: GesteTv) => GesteTv
    origine: (id: string) => OrigineCapture | undefined
  }
  lireArbre: (id: string) => Promise<LectureArbre>
  agir: (g: GesteTv | GesteElement) => Promise<ResultatGeste>
}

export type ImageAvecArbre = ImageTv & { arbre?: string }

export function outilsBureauCacheDuChat(d: DependancesOutilsChat): {
  observer: (id: string) => Promise<ImageAvecArbre>
  agir: (g: GesteTv | GesteElement) => Promise<ResultatGeste>
} {
  return {
    async observer(id) {
      const img = await d.capteur().image(id)
      if (img.statut !== 'ok' && img.statut !== 'uni') return img
      // L'arbre APRÈS l'image : son origine est celle de l'image que l'agent va lire. Une panne de
      // l'arbre ne coûte jamais la capture.
      let lecture: LectureArbre
      try {
        lecture = await d.lireArbre(id)
      } catch (e) {
        lecture = { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
      return { ...img, arbre: texteArbre(lecture, d.capteur().origine(id)) }
    },
    agir(g) {
      if (estGesteElement(g)) return d.agir({ ...g, origine: d.capteur().origine(g.id) })
      // x/y de l'image recadrée → pixels de l'écran du bureau, comme la petite TV (conv-1009).
      return d.agir(d.capteur().versEcran(g))
    }
  }
}
