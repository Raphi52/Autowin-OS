/**
 * LA RELECTURE DES BOARDS DES COLLÈGUES (demande utilisateur du 2026-10-28).
 *
 * Demande : « fais afficher dans mon Board les post-it des collègues qui écrivent dans le même
 * dossier de la GED, avec leur nom sur chaque post-it et en lecture seule ». Chaque poste écrit son
 * Board dans `<dossier du Board>\<son compte Windows>\board.json` (`board-dossier.ts`) ;
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
} from '../../shared/board-collegues'
import { nomDuPosteLisible } from '../../shared/board-nom-du-poste'
import { objetOuNull as objet } from '../../shared/is-record'

export const FORMAT_LU = 'autowin-board/1'
export const DELAI_ENTRE_LECTURES_MS = 15_000
/** 2,7 Mo mesurés pour 1 043 post-it : 40 Mo laisse dix fois la place, pas plus. */
export const TAILLE_MAX_D_UN_BOARD = 40 * 1024 * 1024
export const COLLEGUES_MAX = 50
export const POSTITS_MAX = 10_000
export const DEMANDES_MAX = 500
const TEXTE_MAX = 4_000

const ETAGES: readonly EtageDuFichier[] = ['a-faire', 'refuse', 'en-cours', 'sans-preuve', 'prouve']
const STATUTS: readonly StatutDuFichier[] = ['refuse', 'en-cours', 'sans-preuve', 'prouve']

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
  // Le message entier : un fichier écrit avant ne l'a pas, la fiche montre alors le titre.
  const entier = texte(o.texte)
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
    ...(entier ? { texte: entier } : {}),
    statut: s,
    constat,
    ...(d ? { date: d } : {}),
    ...(demandeur ? { demandeur } : {}),
    ...(workItems.length ? { workItems } : {})
  }
}

/** `conv-1441/slug-xyz/RUN.md` : un fil, un dossier, le RUN.md — ni `..`, ni chemin absolu. */
const FICHE_LISIBLE = /^[\w-]+\/[\w-]+\/RUN\.md$/u

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
  // Le RUN.md de la tâche, tel que `fiches-de-demande.ts` le nomme : rien d'autre.
  const fiche = texte(o.fiche, 200)
  return {
    conversationId,
    ...(fiche && FICHE_LISIBLE.test(fiche) ? { fiche } : {}),
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

/**
 * Le nom écrit sur les post-it d'un collègue : celui que SON poste a écrit dans `board.json` (choisi
 * dans ses réglages, sinon son compte Windows), sinon son compte — le nom de son sous-dossier.
 *
 * Plus le demandeur git le plus fréquent : un poste avec une identité git affichait
 * un surnom git, un poste sans affichait son compte Windows — deux genres de noms côte à côte.
 */
export function nomDuCollegue(poste: string, nomEcrit: unknown): string {
  const nom = nomDuPosteLisible(nomEcrit)
  return nom ?? poste
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
    nom: nomDuCollegue(poste, o.nom),
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

/** Un RUN.md de collègue au-delà de cette taille n'est pas montré : c'est une fiche, pas un journal. */
export const TAILLE_MAX_D_UNE_FICHE = 512 * 1024

/**
 * Le RUN.md léger d'un post-it de collègue : « je dois pouvoir consulter les run.md de
 * mes collègues dans le board ». Son Board le recopie dans `<dossier>/<poste>/fiches/<fiche>`
 * (`board-dossier.ts`). Le poste et la fiche viennent de la vue : chacun est validé sur sa forme
 * pour qu'aucun `..` ni chemin absolu ne fasse lire autre chose que ce sous-dossier.
 * `null` = pas (encore) recopié : son Autowin n'a pas réécrit son Board depuis cette version.
 */
export async function lireFicheDUnCollegue(
  dossier: string,
  poste: unknown,
  fiche: unknown
): Promise<string | null> {
  // Un compte Windows : lettres, chiffres, point, tiret, espace ; jamais de séparateur de chemin.
  if (typeof poste !== 'string' || !/^[\p{L}\p{N}_. @-]{1,100}$/u.test(poste)) return null
  if (poste === '.' || poste === '..') return null
  if (typeof fiche !== 'string' || !FICHE_LISIBLE.test(fiche)) return null
  const chemin = join(dossier, poste, 'fiches', fiche)
  try {
    const s = await stat(chemin)
    if (!s.isFile() || s.size > TAILLE_MAX_D_UNE_FICHE) return null
    return await readFile(chemin, 'utf8')
  } catch {
    return null
  }
}
