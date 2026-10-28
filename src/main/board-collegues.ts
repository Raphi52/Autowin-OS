/**
 * LA RELECTURE DES BOARDS DES COLLÈGUES (demande utilisateur du 2026-10-28, conv-1210).
 *
 * Demande : « fais afficher dans mon Board les post-it des collègues qui écrivent dans le même
 * dossier de la GED, avec leur nom sur chaque post-it et en lecture seule ». Chaque poste écrit son
 * Board dans `<dossier du Board>\<son compte Windows>\board.json` (`board-dossier.ts`, conv-1206) ;
 * ce module relit ceux des AUTRES sous-dossiers.
 *
 * Le fichier vient d'un partage d'équipe : c'est une DONNÉE, jamais une source sûre. Tout ce qui en
 * sort est contrôlé champ par champ (type, longueur, nombre) et ce qui ne passe pas est écarté ; rien
 * n'y est exécuté, et la vue n'en fait que du texte.
 *
 * Un partage réseau peut être lent ou injoignable (hors VPN) : la relecture ne bloque jamais le
 * calcul du Board (canal à part), deux relectures sont espacées d'au moins `DELAI_ENTRE_LECTURES_MS`,
 * et un fichier inchangé (même date, même taille) n'est pas relu.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  BoardDUnCollegue,
  BoardsDesCollegues,
  DemandeDuFichier,
  EtageDuFichier,
  PostItDuFichier,
  StatutDuFichier
} from '../shared/board-collegues'

export const FORMAT_LU = 'autowin-board/1'
export const DELAI_ENTRE_LECTURES_MS = 15_000
/** 2,7 Mo mesurés pour 1 043 post-it (conv-1206) : 40 Mo laisse dix fois la place, pas plus. */
export const TAILLE_MAX_D_UN_BOARD = 40 * 1024 * 1024
export const COLLEGUES_MAX = 50
export const POSTITS_MAX = 10_000
export const DEMANDES_MAX = 500
const TEXTE_MAX = 4_000

const ETAGES: readonly EtageDuFichier[] = ['a-faire', 'refuse', 'en-cours', 'sans-preuve', 'prouve']
const STATUTS: readonly StatutDuFichier[] = ['refuse', 'en-cours', 'sans-preuve', 'prouve']

const objet = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** Une chaîne bornée, sans caractère de contrôle qui casserait une ligne affichée. */
function texte(v: unknown, max = TEXTE_MAX): string | null {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const propre = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  return propre.length > max ? `${propre.slice(0, max - 1)}…` : propre
}

function date(v: unknown): string | null {
  const t = texte(v, 40)
  return t && Number.isFinite(Date.parse(t)) ? t : null
}

function statut(v: unknown): StatutDuFichier | null {
  return typeof v === 'string' && (STATUTS as readonly string[]).includes(v)
    ? (v as StatutDuFichier)
    : null
}

function etage(v: unknown): EtageDuFichier | null {
  return typeof v === 'string' && (ETAGES as readonly string[]).includes(v)
    ? (v as EtageDuFichier)
    : null
}

function personne(v: unknown): { nom: string; email?: string } | undefined {
  const o = objet(v)
  const nom = o && texte(o.nom, 200)
  if (!o || !nom) return undefined
  const email = texte(o.email, 320)
  return { nom, ...(email ? { email } : {}) }
}

function demandeLue(v: unknown): DemandeDuFichier | null {
  const o = objet(v)
  if (!o) return null
  const titre = texte(o.titre)
  const s = statut(o.statut)
  if (titre === null || !s || typeof o.rang !== 'number' || !Number.isInteger(o.rang)) return null
  const constat = texte(o.constat) ?? ''
  const messageId = texte(o.messageId, 200)
  const d = date(o.date)
  const demandeur = personne(o.demandeur)
  const workItems = Array.isArray(o.workItems)
    ? o.workItems.slice(0, 50).flatMap((w) => {
        const wo = objet(w)
        const sourceId = wo && texte(wo.sourceId, 200)
        const id = wo && texte(wo.id, 40)
        if (!wo || !sourceId || !id) return []
        const titreW = texte(wo.titre, 400)
        return [{ sourceId, id, ...(titreW ? { titre: titreW } : {}) }]
      })
    : []
  return {
    rang: o.rang,
    ...(messageId ? { messageId } : {}),
    titre,
    statut: s,
    constat,
    ...(d ? { date: d } : {}),
    ...(demandeur ? { demandeur } : {}),
    ...(workItems.length ? { workItems } : {})
  }
}

function postItLu(v: unknown): PostItDuFichier | null {
  const o = objet(v)
  if (!o) return null
  const conversationId = texte(o.conversationId, 80)
  const titre = texte(o.titre)
  const projet = objet(o.projet)
  const cle = projet && texte(projet.cle, 1000)
  const libelle = projet && texte(projet.libelle, 400)
  const e = etage(o.etage)
  const preuve = statut(o.etatPreuve)
  const derniere = date(o.derniereDemande)
  if (!conversationId || titre === null || !cle || !libelle || !e || !preuve || !derniere)
    return null
  const demandes = Array.isArray(o.demandes)
    ? o.demandes
        .slice(-DEMANDES_MAX)
        .map(demandeLue)
        .filter((d): d is DemandeDuFichier => d !== null)
    : []
  // Un post-it sans demande lisible ne peut pas être posé dans le temps : écarté.
  if (!demandes.length) return null
  const manuelBrut = objet(o.manuel)
  const manuelEtage = manuelBrut && etage(manuelBrut.etage)
  const manuelA = manuelBrut && date(manuelBrut.a)
  const demandeur = personne(o.demandeur)
  return {
    conversationId,
    titre,
    projet: { cle, libelle },
    etage: e,
    etatPreuve: preuve,
    ...(manuelEtage && manuelA ? { manuel: { etage: manuelEtage, a: manuelA } } : {}),
    derniereDemande: derniere,
    ...(demandeur ? { demandeur } : {}),
    demandes
  }
}

/** Le nom écrit sur les post-it d'un collègue : son demandeur le plus fréquent, sinon son compte. */
export function nomDuCollegue(poste: string, postIts: readonly PostItDuFichier[]): string {
  const comptes = new Map<string, number>()
  for (const p of postIts) {
    const nom = p.demandeur?.nom.trim()
    if (nom) comptes.set(nom, (comptes.get(nom) ?? 0) + 1)
  }
  let meilleur = poste
  let max = 0
  for (const [nom, n] of comptes)
    if (n > max) {
      meilleur = nom
      max = n
    }
  return meilleur
}

/**
 * Le Board d'un collègue lu dans le texte de son `board.json`, ou `null` s'il n'est pas un Board
 * (format inconnu, JSON cassé). Les post-it illisibles sont écartés un à un, pas le Board entier.
 */
export function boardDuCollegue(poste: string, contenu: string): BoardDUnCollegue | null {
  let brut: unknown
  try {
    brut = JSON.parse(contenu)
  } catch {
    return null
  }
  const o = objet(brut)
  if (!o || o.format !== FORMAT_LU || !Array.isArray(o.postIts)) return null
  const postIts = o.postIts
    .slice(0, POSTITS_MAX)
    .map(postItLu)
    .filter((p): p is PostItDuFichier => p !== null)
  const enregistreA = date(o.enregistreA)
  return {
    poste,
    nom: nomDuCollegue(poste, postIts),
    ...(enregistreA ? { enregistreA } : {}),
    postIts
  }
}

export interface LecteurDesCollegues {
  /** Les Boards des autres postes ; relus au plus toutes les `delaiMs`, jamais deux à la fois. */
  lire: () => Promise<BoardsDesCollegues>
}

export function creerLecteurDesCollegues(deps: {
  /**
   * Le dossier du Board choisi sur ce poste, et le sous-dossier de CE poste, qu'on ne relit pas (ce
   * sont nos propres post-it) ; `null` = aucun dossier, donc aucun collègue.
   */
  ou: () => { dossier: string; poste: string } | null
  maintenant?: () => number
  delaiMs?: number
}): LecteurDesCollegues {
  const maintenant = deps.maintenant ?? Date.now
  const delaiMs = deps.delaiMs ?? DELAI_ENTRE_LECTURES_MS
  /** Par fichier : sa date et sa taille au dernier passage, et ce qui en a été lu. */
  const cache = new Map<string, { mtimeMs: number; size: number; board: BoardDUnCollegue | null }>()
  let dernier: { dossier: string; a: number; resultat: BoardsDesCollegues } | null = null
  let enCours: Promise<BoardsDesCollegues> | null = null

  async function relire(dossier: string, poste: string): Promise<BoardsDesCollegues> {
    const moi = poste.toLowerCase()
    let entrees
    try {
      entrees = await readdir(dossier, { withFileTypes: true })
    } catch (e) {
      return {
        collegues: [],
        erreur: `Dossier du Board injoignable : ${e instanceof Error ? e.message : String(e)}`
      }
    }
    const postes = entrees
      .filter((e) => e.isDirectory() && e.name.toLowerCase() !== moi)
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, COLLEGUES_MAX)
    const collegues: BoardDUnCollegue[] = []
    const illisibles: string[] = []
    for (const poste of postes) {
      const fichier = join(dossier, poste, 'board.json')
      try {
        const s = await stat(fichier)
        if (!s.isFile()) continue
        if (s.size > TAILLE_MAX_D_UN_BOARD) {
          illisibles.push(`${poste} (fichier trop gros)`)
          continue
        }
        const connu = cache.get(fichier)
        let board: BoardDUnCollegue | null
        if (connu && connu.mtimeMs === s.mtimeMs && connu.size === s.size) board = connu.board
        else {
          board = boardDuCollegue(poste, await readFile(fichier, 'utf8'))
          cache.set(fichier, { mtimeMs: s.mtimeMs, size: s.size, board })
        }
        if (board) collegues.push(board)
        else illisibles.push(`${poste} (format inconnu)`)
      } catch (e) {
        // Pas de board.json dans ce sous-dossier : ce n'est pas un poste, rien à dire.
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') continue
        illisibles.push(`${poste} (${e instanceof Error ? e.message : String(e)})`)
      }
    }
    return {
      collegues,
      ...(illisibles.length ? { erreur: `Board illisible : ${illisibles.join(', ')}` } : {})
    }
  }

  return {
    lire() {
      const ici = deps.ou()
      if (!ici) return Promise.resolve({ collegues: [] })
      const { dossier, poste } = ici
      if (dernier && dernier.dossier === dossier && maintenant() - dernier.a < delaiMs)
        return Promise.resolve(dernier.resultat)
      if (enCours) return enCours
      enCours = relire(dossier, poste)
        .then((resultat) => {
          dernier = { dossier, a: maintenant(), resultat }
          return resultat
        })
        .finally(() => {
          enCours = null
        })
      return enCours
    }
  }
}
