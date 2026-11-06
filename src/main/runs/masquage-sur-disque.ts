/**
 * LES VALEURS DU COFFRE NE RESTENT PAS EN CLAIR DANS LES FICHIERS QU'ÉCRIT L'AGENT.
 *
 * Pourquoi ici : tout ce qui ENTRE dans Autowin est masqué à la pompe du routeur
 * (`providers/sortie-masquee.ts`). Deux fichiers lui échappent, parce que c'est le processus de
 * l'agent qui les écrit, pas Autowin :
 * - le journal `run-stdout/<jeton>.stdout.jsonl` et sa sortie d'erreur, où le relais redirige la
 *   sortie du CLI pour qu'elle survive à l'app ;
 * - la copie de session du CLI Claude, `<config>/projects/<dossier encodé>/<session>.jsonl`, et ses
 *   sorties d'outils trop longues, `<session>/tool-results/`.
 * Autowin ne peut pas filtrer ces écritures : il les corrige sur place, juste après.
 *
 * MÊME LONGUEUR, À LA MÊME PLACE. Ces fichiers sont encore écrits pendant qu'on les corrige (le CLI y
 * ajoute ses lignes) et relus par position (`tailJsonLines` reprend à un offset après un
 * redémarrage). Réécrire le fichier entier perdrait les lignes ajoutées pendant la réécriture, et un
 * texte plus court décalerait toutes les positions. Seuls les octets de la valeur sont donc écrasés,
 * par un texte ASCII de la même taille : `[secret:NOM]` complété d'astérisques, ou des astérisques
 * seuls quand l'étiquette ne tient pas. Ce texte n'a ni guillemet ni antislash : le JSON reste
 * valide, et le CLI reprend sa session (`--resume`) avec la valeur masquée.
 */
import { createHash } from 'node:crypto'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LONGUEUR_MIN_MASQUAGE, valeursPourAgent } from '../app/coffre-cles'
import { encoderCheminCli } from '../store/historique-cli-copie'

export interface MotifDeMasquage {
  nom: string
  /** La forme cherchée, en texte (une ligne déjà lue) et en octets (le fichier). */
  texte: string
  octets: Buffer
  /** Même nombre d'octets que `octets`. */
  remplacement: Buffer
}

export interface MotifsDeMasquage {
  liste: readonly MotifDeMasquage[]
  /** Change dès qu'une valeur du coffre change : une zone déjà nettoyée doit alors être relue. */
  empreinte: string
}

const AUCUN: MotifsDeMasquage = { liste: [], empreinte: '' }

/** `[secret:NOM]` complété d'astérisques à la taille exacte, ou des astérisques seuls. */
export function remplacementMemeLongueur(nom: string, octets: number): Buffer {
  const etiquette = `[secret:${nom}]`
  const texte = etiquette.length <= octets ? etiquette.padEnd(octets, '*') : '*'.repeat(octets)
  return Buffer.from(texte, 'ascii')
}

/**
 * Les formes à chercher pour chaque valeur : brute (sortie d'erreur, fichier texte) et échappée par
 * JSON quand elle diffère (une valeur avec guillemet ou antislash, dans un journal `stream-json`).
 * Les plus longues d'abord, comme `masquerValeurs` : une valeur qui en contient une autre est
 * masquée entière.
 */
export function motifsDeMasquage(valeurs: Record<string, string>): MotifsDeMasquage {
  const liste: MotifDeMasquage[] = []
  const empreinte = createHash('sha256')
  for (const [nom, valeur] of Object.entries(valeurs).sort(([a], [b]) => a.localeCompare(b))) {
    if (valeur.length < LONGUEUR_MIN_MASQUAGE) continue
    empreinte.update(`${nom}\u0000${valeur}\u0000`)
    const formes = new Set([valeur, JSON.stringify(valeur).slice(1, -1)])
    for (const texte of formes) {
      const octets = Buffer.from(texte, 'utf8')
      liste.push({ nom, texte, octets, remplacement: remplacementMemeLongueur(nom, octets.length) })
    }
  }
  liste.sort((a, b) => b.octets.length - a.octets.length || a.nom.localeCompare(b.nom))
  return liste.length ? { liste, empreinte: empreinte.digest('hex') } : AUCUN
}

/** Les valeurs du coffre du processus ; coffre fermé ou illisible → rien à masquer. */
export function motifsDuCoffre(): MotifsDeMasquage {
  try {
    return motifsDeMasquage(valeursPourAgent([]))
  } catch {
    return AUCUN
  }
}

export function contientUneValeur(texte: string, motifs: MotifsDeMasquage): boolean {
  return motifs.liste.some((m) => texte.includes(m.texte))
}

const TAILLE_MORCEAU = 1024 * 1024

/**
 * Écrase EN PLACE chaque valeur trouvée dans `chemin` à partir de l'octet `depuis` (reculé de la
 * longueur d'une valeur, pour celle qu'une lecture précédente aurait coupée). Rend le nombre de
 * remplacements et la taille lue, d'où repartir la fois suivante. Fichier absent → rien.
 *
 * Lu par morceaux qui se chevauchent : un journal de plusieurs dizaines de Mo ne passe jamais
 * entier en mémoire, et une valeur à cheval sur deux morceaux est vue entière dans le second.
 */
export async function masquerFichierEnPlace(
  chemin: string,
  motifs: MotifsDeMasquage,
  depuis = 0
): Promise<{ remplacements: number; taille: number }> {
  if (motifs.liste.length === 0) return { remplacements: 0, taille: depuis }
  let fichier
  try {
    fichier = await open(chemin, 'r+')
  } catch {
    return { remplacements: 0, taille: depuis }
  }
  try {
    const taille = (await fichier.stat()).size
    const recouvrement = Math.max(...motifs.liste.map((m) => m.octets.length)) - 1
    const pas = Math.max(TAILLE_MORCEAU, recouvrement * 2 + 1)
    // Plus court qu'à la dernière lecture : le fichier a été réécrit, tout est à relire.
    let debut = depuis > taille ? 0 : Math.max(0, depuis - recouvrement)
    let remplacements = 0
    while (debut < taille) {
      const fin = Math.min(taille, debut + pas)
      const morceau = Buffer.alloc(fin - debut)
      const { bytesRead } = await fichier.read(morceau, 0, morceau.length, debut)
      const lu = morceau.subarray(0, bytesRead)
      for (const motif of motifs.liste) {
        for (let i = lu.indexOf(motif.octets); i >= 0; i = lu.indexOf(motif.octets, i + 1)) {
          // Recopié aussi dans le morceau lu : une valeur plus courte contenue dans celle-ci n'y est
          // plus retrouvée.
          motif.remplacement.copy(lu, i)
          await fichier.write(motif.remplacement, 0, motif.remplacement.length, debut + i)
          remplacements++
        }
      }
      if (fin >= taille || bytesRead === 0) break
      debut = fin - recouvrement
    }
    return { remplacements, taille }
  } finally {
    await fichier.close()
  }
}

/** Même geste, sans jamais faire échouer l'appelant : un fichier verrouillé est signalé, pas fatal. */
export async function masquerFichierSansEchec(
  chemin: string,
  motifs: MotifsDeMasquage,
  depuis = 0
): Promise<{ remplacements: number; taille: number }> {
  try {
    return await masquerFichierEnPlace(chemin, motifs, depuis)
  } catch (erreur) {
    // Jamais la valeur ni le contenu : le chemin et la cause suffisent à retrouver le fichier.
    console.warn(
      `[coffre] masquage sur disque impossible pour ${chemin} : ${(erreur as Error)?.message ?? erreur}`
    )
    return { remplacements: 0, taille: depuis }
  }
}

/** Ce qui est déjà nettoyé de chaque fichier de session : le CLI ne fait qu'y ajouter des lignes. */
const dejaNettoye = new Map<string, { empreinte: string; taille: number }>()
const PLAFOND_SUIVI = 2_000

async function fichiersSous(dossier: string): Promise<string[]> {
  let entrees
  try {
    entrees = await readdir(dossier, { withFileTypes: true })
  } catch {
    return []
  }
  const fichiers: string[] = []
  for (const entree of entrees) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) fichiers.push(...(await fichiersSous(chemin)))
    else if (entree.isFile()) fichiers.push(chemin)
  }
  return fichiers
}

async function existe(chemin: string): Promise<boolean> {
  return stat(chemin).then(
    () => true,
    () => false
  )
}

/** Le dossier du projet qui porte `<session>.jsonl` : le nom encodé d'abord, sinon on le cherche. */
async function dossierDeSession(
  projets: string,
  cwd: string,
  fichier: string
): Promise<string | undefined> {
  const attendu = join(projets, encoderCheminCli(cwd))
  if (await existe(join(attendu, fichier))) return attendu
  // Un chemin très long est raccourci par le CLI : on retrouve alors le dossier par la session.
  let dossiers: string[]
  try {
    dossiers = await readdir(projets)
  } catch {
    return undefined
  }
  for (const dossier of dossiers) {
    if (await existe(join(projets, dossier, fichier))) return join(projets, dossier)
  }
  return undefined
}

/**
 * Masque la copie de session du CLI Claude d'un appel fini : `<session>.jsonl` et tout ce que range
 * `<session>/` (sorties d'outils). Rend le nombre de remplacements. Appelée à la fin de chaque appel :
 * pendant l'appel, le CLI écrit encore la session, et c'est la fin qui garantit qu'il n'en reste rien.
 */
export async function masquerSessionClaude(entree: {
  configDir?: string
  cwd: string
  sessionId?: string
  motifs?: MotifsDeMasquage
}): Promise<number> {
  const { sessionId } = entree
  // Un identifiant de session est un UUID : rien d'autre ne doit composer un chemin.
  if (!sessionId || !/^[A-Za-z0-9-]+$/.test(sessionId)) return 0
  const motifs = entree.motifs ?? motifsDuCoffre()
  if (motifs.liste.length === 0) return 0
  const projets = join(entree.configDir || join(homedir(), '.claude'), 'projects')
  const dossier = await dossierDeSession(projets, entree.cwd, `${sessionId}.jsonl`)
  if (!dossier) return 0
  const fichiers = [
    join(dossier, `${sessionId}.jsonl`),
    ...(await fichiersSous(join(dossier, sessionId)))
  ]
  if (dejaNettoye.size > PLAFOND_SUIVI) dejaNettoye.clear()
  let total = 0
  for (const fichier of fichiers) {
    const connu = dejaNettoye.get(fichier)
    const depuis = connu?.empreinte === motifs.empreinte ? connu.taille : 0
    const { remplacements, taille } = await masquerFichierSansEchec(fichier, motifs, depuis)
    dejaNettoye.set(fichier, { empreinte: motifs.empreinte, taille })
    total += remplacements
  }
  return total
}
