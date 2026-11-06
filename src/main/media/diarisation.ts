/**
 * LA SÉPARATION DES VOIX D'UN SEUL FICHIER AUDIO (diarisation), et son installation.
 *
 * POURQUOI CE FICHIER EXISTE. Le widget Transcription sépare déjà les voix par la SOURCE du son :
 * le micro d'un côté, la sortie système (Teams) de l'autre. C'est exact, sans rien deviner. Mais un
 * mp3 DÉJÀ enregistré a tout mélangé dans une seule piste : il faut alors deviner à l'oreille qui
 * parle. C'est `pyannote.audio`, et il n'est PAS livré avec l'application.
 *
 * TROIS CHOIX QUI PORTENT TOUT LE RESTE :
 *
 *  1. L'INSTALLATION EST EXPLICITE, JAMAIS DANS LE DOS. Elle descend `torch` : ~2,5 Go. Un
 *     téléchargement de cette taille déclenché par une case cochée serait une facture surprise sur
 *     une connexion d'entreprise. D'où un bouton, comme pour l'écoute hors ligne de Jarvis.
 *
 *  2. ON N'INSTALLE PAS PYTHON. Si l'interpréteur manque, on le DIT et on s'arrête. Poser un
 *     runtime entier sur le poste de quelqu'un dépasse de loin ce qu'un bouton d'un widget peut
 *     légitimement faire ; et un `pip` lancé sans Python échoue de toute façon.
 *
 *  3. « INSTALLÉ » NE VEUT PAS DIRE « UTILISABLE ». Le paquet pip ne suffit pas : le modèle se
 *     télécharge chez Hugging Face et exige un jeton gratuit. L'état distingue donc les deux, sinon
 *     on promet une fonction qui échouera au premier fichier — le pire des deux mondes.
 *
 * Aucune diarisation n'est exécutée ici : ce module POSE la brique et dit honnêtement où elle en
 * est. Le traitement d'un fichier viendra derrière, une fois la brique réellement présente.
 */
import { spawn } from 'node:child_process'

/** Le paquet qui porte la séparation des voix. */
export const PAQUET_DIARISATION = 'pyannote.audio'

/** Ce que pèse l'installation, annoncé AVANT de la lancer (torch en représente l'essentiel). */
export const MEGAOCTETS_DIARISATION = 2_500

export interface EtatDiarisation {
  /** Le paquet répond à l'import : la brique est là. */
  installe: boolean
  /** Un interpréteur Python a été trouvé. Faux ⇒ rien n'est installable, et on le dit. */
  pythonPresent: boolean
  /** Le jeton Hugging Face, sans lequel le modèle ne se télécharge pas. */
  jetonPresent: boolean
  /** Poids annoncé à l'utilisateur avant le clic. */
  megaoctets: number
  /** Renseigné quand la dernière tentative a échoué — le message brut, jamais masqué. */
  erreur: string | null
}

/** Lancer un programme et rendre sa sortie : l'unique porte vers le système de ce module. */
export type Lanceur = (
  commande: string,
  args: readonly string[]
) => Promise<{ code: number; sortie: string }>

/** Le lanceur réel. Sortie standard et d'erreur fusionnées : un échec pip parle surtout en stderr. */
export const lanceurSysteme: Lanceur = (commande, args) =>
  new Promise((resoudre) => {
    const enfant = spawn(commande, [...args], { windowsHide: true })
    let sortie = ''
    enfant.stdout?.on('data', (bloc) => (sortie += String(bloc)))
    enfant.stderr?.on('data', (bloc) => (sortie += String(bloc)))
    enfant.on('error', (erreur) => resoudre({ code: -1, sortie: String(erreur) }))
    enfant.on('close', (code) => resoudre({ code: code ?? -1, sortie }))
  })

/**
 * Le jeton Hugging Face, lu dans l'environnement sous ses DEUX noms courants.
 *
 * La bibliothèque accepte historiquement `HF_TOKEN` et `HUGGINGFACE_TOKEN` ; n'en lire qu'un
 * afficherait « jeton manquant » à quelqu'un qui l'a pourtant configuré.
 */
export function jetonHuggingFace(env: NodeJS.ProcessEnv = process.env): string | null {
  const brut = env.HF_TOKEN ?? env.HUGGINGFACE_TOKEN ?? env.HUGGING_FACE_HUB_TOKEN ?? ''
  const valeur = brut.trim()
  return valeur.length > 0 ? valeur : null
}

/**
 * L'état de la brique, mesuré et jamais supposé.
 *
 * On teste l'IMPORT, pas la présence d'un dossier : un paquet à moitié installé (téléchargement
 * coupé, dépendance native absente) laisse des fichiers sur le disque tout en étant inutilisable.
 * Seul l'import tranche.
 */
export async function etatDiarisation(
  lancer: Lanceur = lanceurSysteme,
  python = 'python',
  env: NodeJS.ProcessEnv = process.env
): Promise<EtatDiarisation> {
  const jetonPresent = jetonHuggingFace(env) !== null
  const version = await lancer(python, ['--version'])
  if (version.code !== 0) {
    return {
      installe: false,
      pythonPresent: false,
      jetonPresent,
      megaoctets: MEGAOCTETS_DIARISATION,
      erreur: 'Python est introuvable sur ce poste : la séparation des voix ne peut pas être posée.'
    }
  }
  const importe = await lancer(python, ['-c', 'import pyannote.audio'])
  return {
    installe: importe.code === 0,
    pythonPresent: true,
    jetonPresent,
    megaoctets: MEGAOCTETS_DIARISATION,
    erreur: null
  }
}

/**
 * Poser la brique, UNE fois.
 *
 * L'état est RELU après coup plutôt que déduit du code de sortie de pip : `pip` peut rendre 0 en
 * ayant laissé une installation qui ne s'importe pas. Ce qui compte est ce qui marche ensuite.
 */
export async function installerDiarisation(
  lancer: Lanceur = lanceurSysteme,
  python = 'python',
  env: NodeJS.ProcessEnv = process.env
): Promise<EtatDiarisation> {
  const avant = await etatDiarisation(lancer, python, env)
  if (!avant.pythonPresent) return avant
  if (avant.installe) return avant

  const pose = await lancer(python, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    PAQUET_DIARISATION
  ])
  const apres = await etatDiarisation(lancer, python, env)
  if (apres.installe) return apres
  return {
    ...apres,
    // La sortie de pip est rendue TELLE QUELLE : c'est elle qui nomme la vraie cause (réseau coupé,
    // proxy, compilateur manquant). La résumer ferait perdre la seule information utile.
    erreur: pose.sortie.trim().slice(-800) || 'Installation échouée, sans message.'
  }
}
