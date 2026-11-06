import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * PONTS ENTRE LE BRAIN PERSO ET LE BRAIN D'ÉQUIPE (conv-1262, 2026-10-29, demande utilisateur :
 * « le brain personnel peut avoir des ponts vectoriels avec le brain d'entreprise ? » puis « oui
 * ajoute ça »).
 *
 * Les deux Brains sont indexés par le MÊME modèle (`brain/tooling/brain_retrieval.py`, MODEL) : leurs
 * vecteurs vivent dans le même espace et se comparent directement. On RELIT donc les deux index
 * déjà écrits sur disque (`tooling/index/CURRENT` → `generations/<g>/meta.jsonl` + `emb.npy`) :
 * aucun modèle à charger, aucun texte envoyé nulle part.
 *
 * SENS UNIQUE : un pont part d'une note perso vers ses voisines d'équipe. Il n'est ÉCRIT nulle
 * part — il est recalculé en mémoire par la vue — et rien ne touche le Brain d'équipe : il ne
 * sait pas qu'une note perso pointe vers lui (promesse « privé, jamais partagé » du Brain perso).
 */

/** Voisines d'équipe gardées par note perso : au-delà, le graphe devient une pelote. */
export const PONTS_PAR_NOTE = 3

/**
 * Similarité minimale d'un pont (cosinus entre vecteurs moyens de notes). Mesures du 2026-10-29 sur
 * l'index d'équipe (1 871 notes) :
 * - `scripts/sonde-ponts-brain.mts` : les notes d'équipe se ressemblent toutes un peu — une paire
 *   tirée au HASARD vaut 0,55 en médiane (p90 0,72). Un seuil bas relierait n'importe quoi ;
 * - 5 notes HORS SUJET (recette, vacances, course à pied, chat, cadeaux), plongées par le même
 *   modèle : meilleure voisine d'équipe entre 0,32 et 0,58 ;
 * - 3 notes DANS LE SUJET : vraie voisine à 0,78-0,79, voisines suivantes 0,57-0,66.
 * 0,65 écarte tout le hors-sujet (marge 0,07) et garde les vraies voisines : on préfère un pont
 * manquant à un pont faux, qui ferait croire à un lien entre la vie perso et le savoir d'équipe.
 * Changer ce seuil = rejouer les mesures.
 */
export const PONTS_SIMILARITE_MIN = 0.65

export interface PontBrain {
  /** Identifiant de la note perso (chemin relatif sans `.md`, ex. `knowledge/x`). */
  perso: string
  /** Identifiant de la note d'équipe voisine. */
  equipe: string
  similarite: number
}

export interface MatriceNpy {
  lignes: number
  dim: number
  donnees: Float32Array
}

/**
 * Lit un tableau `.npy` float32 petit-boutiste à deux dimensions, tel que l'écrit `np.save`
 * (`brain_index.py`, `write_index_snapshot`). Tout autre format est refusé, jamais deviné.
 */
export function lireNpyFloat32(octets: Uint8Array): MatriceNpy {
  const magie = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]
  if (octets.length < 10 || magie.some((octet, index) => octets[index] !== octet))
    throw new Error('fichier .npy invalide : signature absente')
  const version = octets[6]
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
  const longueurEntete = version === 1 ? vue.getUint16(8, true) : vue.getUint32(8, true)
  const debutEntete = version === 1 ? 10 : 12
  const entete = new TextDecoder('latin1').decode(
    octets.subarray(debutEntete, debutEntete + longueurEntete)
  )
  if (!/'descr'\s*:\s*'<f4'/.test(entete)) throw new Error('fichier .npy : float32 attendu')
  if (/'fortran_order'\s*:\s*True/.test(entete)) throw new Error('fichier .npy : ordre C attendu')
  const forme = entete.match(/'shape'\s*:\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/)
  if (!forme) throw new Error('fichier .npy : matrice à deux dimensions attendue')
  const lignes = Number(forme[1])
  const dim = Number(forme[2])
  const debut = debutEntete + longueurEntete
  const fin = debut + lignes * dim * 4
  if (fin > octets.length) throw new Error('fichier .npy tronqué')
  // COPIE réelle : l'alignement sur 4 octets d'un Buffer lu sur disque n'est pas garanti, et
  // `Buffer#slice` ne copie PAS (vue sur le pool partagé) — `.buffer` rendait alors tout le pool.
  const donnees = new Float32Array(new Uint8Array(octets.subarray(debut, fin)).buffer)
  return { lignes, dim, donnees }
}

/** `knowledge/a/b.md` → `knowledge/a/b` : la forme des identifiants du graphe de la vue. */
export function idDeNoteIndexee(chemin: string): string {
  return chemin.replace(/\\/g, '/').replace(/\.md$/i, '')
}

/**
 * Un vecteur par NOTE : moyenne de ses morceaux (une note longue est découpée à l'indexation),
 * renormalisée — le produit scalaire de deux vecteurs rendus est alors leur cosinus.
 */
export function vecteursParNote(
  chemins: readonly string[],
  matrice: MatriceNpy
): Map<string, Float32Array> {
  if (chemins.length !== matrice.lignes)
    throw new Error(
      `index incohérent : ${chemins.length} lignes de méta, ${matrice.lignes} vecteurs`
    )
  const sommes = new Map<string, Float32Array>()
  for (let ligne = 0; ligne < matrice.lignes; ligne += 1) {
    const id = idDeNoteIndexee(chemins[ligne])
    let somme = sommes.get(id)
    if (!somme) {
      somme = new Float32Array(matrice.dim)
      sommes.set(id, somme)
    }
    const decalage = ligne * matrice.dim
    for (let d = 0; d < matrice.dim; d += 1) somme[d] += matrice.donnees[decalage + d]
  }
  for (const vecteur of sommes.values()) {
    let norme = 0
    for (let d = 0; d < vecteur.length; d += 1) norme += vecteur[d] * vecteur[d]
    norme = Math.sqrt(norme) || 1
    for (let d = 0; d < vecteur.length; d += 1) vecteur[d] /= norme
  }
  return sommes
}

/**
 * Pour chaque note perso, ses `parNote` voisines d'équipe les plus proches au-dessus du seuil.
 * `equipeAutorisee` borne les cibles (corpus du dossier de travail) : un pont ne mène jamais vers
 * une note que la vue n'a pas le droit de montrer.
 */
export function calculerPonts(
  perso: ReadonlyMap<string, Float32Array>,
  equipe: ReadonlyMap<string, Float32Array>,
  options: {
    parNote?: number
    similariteMin?: number
    equipeAutorisee?: (id: string) => boolean
  } = {}
): PontBrain[] {
  const parNote = options.parNote ?? PONTS_PAR_NOTE
  const seuil = options.similariteMin ?? PONTS_SIMILARITE_MIN
  const cibles = [...equipe].filter(([id]) => options.equipeAutorisee?.(id) ?? true)
  const ponts: PontBrain[] = []
  for (const [idPerso, vecteurPerso] of perso) {
    const meilleurs: PontBrain[] = []
    for (const [idEquipe, vecteurEquipe] of cibles) {
      if (vecteurEquipe.length !== vecteurPerso.length) continue
      let produit = 0
      for (let d = 0; d < vecteurPerso.length; d += 1) produit += vecteurPerso[d] * vecteurEquipe[d]
      if (produit < seuil) continue
      if (meilleurs.length === parNote && produit <= meilleurs[parNote - 1].similarite) continue
      meilleurs.push({ perso: idPerso, equipe: idEquipe, similarite: produit })
      meilleurs.sort((a, b) => b.similarite - a.similarite || a.equipe.localeCompare(b.equipe))
      if (meilleurs.length > parNote) meilleurs.pop()
    }
    ponts.push(...meilleurs)
  }
  return ponts
}

export interface IndexBrain {
  generation: string
  /** Modèle et version qui ont produit les vecteurs : deux signatures différentes ne se comparent pas. */
  signature: string
  notes: Map<string, Float32Array>
}

const GENERATION_RE = /^[A-Za-z0-9._-]{1,128}$/

/** Génération courante de l'index d'un Brain, ou `undefined` s'il n'a jamais été indexé. */
export async function generationCourante(racine: string): Promise<string | undefined> {
  try {
    const generation = (await readFile(join(racine, 'tooling', 'index', 'CURRENT'), 'utf8')).trim()
    return GENERATION_RE.test(generation) ? generation : undefined
  } catch {
    return undefined
  }
}

/** Lit l'index courant d'un Brain et en tire un vecteur par note. */
export async function lireIndexBrain(racine: string): Promise<IndexBrain | undefined> {
  const generation = await generationCourante(racine)
  if (!generation) return undefined
  const dossier = join(racine, 'tooling', 'index', 'generations', generation)
  const [manifeste, meta, emb] = await Promise.all([
    readFile(join(dossier, 'manifest.json'), 'utf8'),
    readFile(join(dossier, 'meta.jsonl'), 'utf8'),
    readFile(join(dossier, 'emb.npy'))
  ])
  const signatureBrute = (
    JSON.parse(manifeste) as { embedding_signature?: Record<string, unknown> }
  ).embedding_signature
  const signature = signatureBrute
    ? JSON.stringify(Object.fromEntries(Object.entries(signatureBrute).sort()))
    : ''
  const chemins = meta
    .split('\n')
    .filter((ligne) => ligne.trim())
    .map((ligne) => String((JSON.parse(ligne) as { path?: unknown }).path ?? ''))
  const matrice = lireNpyFloat32(emb)
  return { generation, signature, notes: vecteursParNote(chemins, matrice) }
}

/*
 * L'index d'équipe pèse plusieurs dizaines de Mo, souvent sur un partage RÉSEAU (mesure du
 * 2026-10-29 : 19 773 morceaux, 42 Mo). On le garde en mémoire tant que sa génération ne change
 * pas : relire `CURRENT` (quelques octets) suffit à savoir s'il faut le recharger.
 */
const cacheIndex = new Map<string, IndexBrain>()

async function indexEnCache(racine: string): Promise<IndexBrain | undefined> {
  const generation = await generationCourante(racine)
  if (!generation) return undefined
  const enCache = cacheIndex.get(racine)
  if (enCache?.generation === generation) return enCache
  const lu = await lireIndexBrain(racine)
  if (lu) cacheIndex.set(racine, lu)
  return lu
}

export interface ResultatPonts {
  ponts: PontBrain[]
  /** Pourquoi aucun pont n'a pu être calculé ; absent quand le calcul a eu lieu. */
  raison?: string
}

/** Les ponts du Brain perso vers le Brain d'équipe, calculés en mémoire. */
export async function pontsEntreBrains(
  racinePerso: string,
  racineEquipe: string,
  options: { equipeAutorisee?: (id: string) => boolean } = {}
): Promise<ResultatPonts> {
  const [perso, equipe] = await Promise.all([indexEnCache(racinePerso), indexEnCache(racineEquipe)])
  if (!perso) return { ponts: [], raison: 'Brain perso pas encore indexé' }
  if (!equipe) return { ponts: [], raison: 'Brain d’équipe pas encore indexé' }
  if (perso.signature !== equipe.signature)
    return { ponts: [], raison: 'les deux Brains ne sont pas indexés par le même modèle' }
  return { ponts: calculerPonts(perso.notes, equipe.notes, options) }
}

/** Pour les tests : oublie les index gardés en mémoire. */
export function oublierIndexEnCache(): void {
  cacheIndex.clear()
}
