/**
 * Les enregistrements parlés : la parole dictée ÉCRITE sur le disque, au fil de l'eau.
 *
 * Pourquoi ce fichier existe : jusqu'ici le texte dicté ne vivait que dans la mémoire de la fenêtre
 * (`ecoute.commandes`, plafonnée à 40 lignes). Une réunion de trois heures était donc perdue —
 * tronquée pendant, effacée au rechargement. Deux exigences en découlent, et elles sont la raison
 * d'être de chaque fonction ci-dessous :
 *
 *  1. L'écriture est INCRÉMENTALE : chaque phrase figée part sur le disque tout de suite. Écrire à
 *     l'arrêt seulement déplacerait le défaut d'origine — au premier plantage, tout est perdu.
 *  2. Le CHEMIN est décidé ICI, dans le processus principal. La fenêtre ne manipule qu'un
 *     identifiant de session ; elle ne peut donc pas faire écrire l'application ailleurs.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, stat, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

export interface FichierTranscript {
  nom: string
  chemin: string
  /** Taille sur le disque, en octets. */
  octets: number
  /** Dernière écriture, en millisecondes epoch. */
  le: number
}

export interface SessionTranscript {
  id: string
  nom: string
  chemin: string
}

const deuxChiffres = (n: number): string => String(n).padStart(2, '0')

/** Le dossier des enregistrements, dérivé des données de l'application. */
export function dossierTranscripts(userData: string): string {
  return join(userData, 'transcripts')
}

/**
 * Le nom du fichier d'une session : la DATE, triable telle quelle.
 *
 * Pas d'espace ni de deux-points : ce nom doit rester un nom de fichier valide sous Windows, et
 * rester lisible dans l'explorateur sans être décodé.
 */
export function nomFichierTranscript(le: number): string {
  const d = new Date(le)
  return (
    `enregistrement-${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-` +
    `${deuxChiffres(d.getDate())}_${deuxChiffres(d.getHours())}-` +
    `${deuxChiffres(d.getMinutes())}-${deuxChiffres(d.getSeconds())}.txt`
  )
}

export function enteteTranscript(le: number): string {
  const d = new Date(le)
  const jour = `${deuxChiffres(d.getDate())}/${deuxChiffres(d.getMonth() + 1)}/${d.getFullYear()}`
  return `# Enregistrement du ${jour} a ${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}\n\n`
}

/** Une phrase figée, horodatée : on doit pouvoir relire QUAND une chose a été dite. */
export function ligneTranscript(le: number, texte: string): string {
  const d = new Date(le)
  const heure = `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}:${deuxChiffres(d.getSeconds())}`
  return `[${heure}] ${texte.trim()}\n`
}

/**
 * Les sessions ouvertes et le dossier qui les porte.
 *
 * L'identifiant de session est la SEULE chose que la fenêtre connaît. Un identifiant inconnu est
 * refusé bruyamment : mieux vaut une erreur visible qu'un enregistrement qui n'écrit nulle part —
 * c'est exactement le défaut qu'on répare.
 */
export class ServiceTranscripts {
  /**
   * Chemin, fichier OUVERT et taille courante par session.
   *
   * Deux mesures faites sur ce poste dictent cette forme, parce qu'une dictée de trois heures fait
   * des milliers de phrases :
   *  - un `stat` après chaque phrase doublait les accès disque pour une taille qu'on vient
   *    soi-même d'écrire — la taille est donc SUIVIE en mémoire ;
   *  - rouvrir le fichier à chaque phrase (`appendFile`) coûtait ~20 ms l'unité (1000 phrases en
   *    19 s) — le fichier reste donc OUVERT pendant toute la session, et se ferme à l'arrêt.
   * Chaque écriture part quand même vers le système tout de suite : rien n'attend en mémoire.
   */
  private readonly sessions = new Map<
    string,
    { chemin: string; octets: number; fichier: FileHandle }
  >()

  constructor(private readonly racine: string) {}

  get dossier(): string {
    return this.racine
  }

  async demarrer(le: number = Date.now()): Promise<SessionTranscript> {
    await mkdir(this.racine, { recursive: true })
    const nom = nomFichierTranscript(le)
    const chemin = join(this.racine, nom)
    // `flag: 'a'` : deux sessions démarrées dans la même seconde partagent le nom — on ajoute à la
    // suite plutôt que d'effacer la première.
    await writeFile(chemin, enteteTranscript(le), { encoding: 'utf8', flag: 'a' })
    const id = randomUUID()
    // Le fichier peut déjà exister (deux sessions dans la même seconde) : on part de sa taille
    // RÉELLE, sinon le compteur affiché mentirait dès la première phrase.
    let octets = 0
    try {
      octets = (await stat(chemin)).size
    } catch {
      // Fichier illisible juste après son écriture : le compteur repart de zéro, rien n'est perdu.
    }
    const fichier = await open(chemin, 'a')
    this.sessions.set(id, { chemin, octets, fichier })
    return { id, nom, chemin }
  }

  async ajouter(id: string, texte: string, le: number = Date.now()): Promise<{ octets: number }> {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Enregistrement inconnu : ${id}`)
    const propre = texte.trim()
    if (propre === '') return { octets: session.octets }
    const ligne = ligneTranscript(le, propre)
    await session.fichier.write(ligne, null, 'utf8')
    session.octets += Buffer.byteLength(ligne, 'utf8')
    return { octets: session.octets }
  }

  async terminer(id: string): Promise<{ chemin: string } | null> {
    const session = this.sessions.get(id)
    if (!session) return null
    this.sessions.delete(id)
    // Fermer ne peut pas faire perdre l'enregistrement : tout est déjà parti sur le disque.
    try {
      await session.fichier.close()
    } catch {
      // Fichier déjà fermé (arrêt de l'application) : le contenu est écrit, il n'y a rien à sauver.
    }
    return { chemin: session.chemin }
  }

  /** Les derniers fichiers écrits, le plus récent en tête. */
  async lister(max = 10): Promise<FichierTranscript[]> {
    let noms: string[]
    try {
      noms = await readdir(this.racine)
    } catch {
      // Aucun enregistrement n'a encore été fait : une liste vide, pas une panne.
      return []
    }
    const fichiers: FichierTranscript[] = []
    for (const nom of noms) {
      if (!nom.endsWith('.txt')) continue
      const chemin = join(this.racine, nom)
      try {
        const info = await stat(chemin)
        if (!info.isFile()) continue
        fichiers.push({ nom, chemin, octets: info.size, le: info.mtimeMs })
      } catch {
        // Fichier disparu entre la liste et la lecture : il n'a rien à dire.
      }
    }
    return fichiers.sort((a, b) => b.le - a.le).slice(0, Math.max(1, max))
  }
}
