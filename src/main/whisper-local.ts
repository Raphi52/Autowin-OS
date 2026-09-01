/**
 * RECONNAISSANCE VOCALE LOCALE (whisper.cpp) — le moteur d'écoute de Jarvis, hors ligne.
 *
 * POURQUOI CE FICHIER EXISTE. Symptôme rapporté : « quand j'active l'écoute, il n'entend pas quand
 * je dis son nom ».
 *
 * CE QUI EST MESURÉ (et le seul fait sur lequel s'appuyer). Sur cette application, le moteur
 * `webkitSpeechRecognition` rend le code d'erreur `network` — le widget l'affiche désormais en
 * clair (`JarvisWidget.tsx`, branche `onerror`), et une capture datée du 2026-08-31 17:30 le
 * montre à l'écran, tuile JARVIS : « Reconnaissance vocale interrompue : network », micro coupé.
 * Artefact conservé :
 *   .autowin-data/autowin-os/chat-artifacts/conv-1-36524fd8f6747fc2/
 *     513f3515-955c-4eda-808d-f945a0291c12-606a3ad6f591b5ea/
 *     tool-capture-6-1-1-desktop-current.jpg-01baaac40218f405.jpg
 * Rien n'est donc jamais transcrit : ce n'est pas le mot « Jarvis » qui est mal reconnu.
 *
 * CE QUI RESTE UNE HYPOTHÈSE (non vérifiée ici, à ne pas citer comme un fait). L'explication
 * courante de ce code — la reconnaissance de Chrome passe par un service Google dont la clé n'est
 * pas embarquée dans les binaires Electron — n'a été confirmée par AUCUNE mesure de ce dépôt.
 * Elle n'est pas nécessaire à la décision : le code `network` observé suffit à établir que le
 * moteur natif ne rend rien sur cette machine, et un moteur local le remplace sans en dépendre.
 *
 * CE QUE FAIT CE MODULE. Il pose un moteur qui n'a besoin de personne : la CLI de whisper.cpp
 * (exécutable autonome, aucun `node-gyp`, aucun ABI Electron à reconstruire) et un modèle GGML
 * téléchargés UNE seule fois dans `userData`. Ensuite, plus rien ne sort de la machine.
 *
 * DEUX GARDES QUI NE DOIVENT PAS ÊTRE « SIMPLIFIÉES ».
 *  - `etatWhisper` ne dit « installé » que si le modèle ET la CLI sont sur le disque. Un état
 *    optimiste ferait basculer le widget sur un moteur absent, et rendrait le silence — exactement
 *    le défaut d'origine, déplacé.
 *  - le téléchargement écrit dans `<fichier>.part` et ne renomme qu'à la fin. Une coupure réseau
 *    laisse alors un fichier de travail, jamais un modèle tronqué qui passerait pour installé.
 */
import { execFile } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  type Dirent
} from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import { cpus, tmpdir } from 'node:os'
import { join, posix, sep } from 'node:path'

/**
 * Le modèle. `small` quantifié en q5_1 : ~190 Mo au lieu de 466 Mo pour le `small` complet, pour une
 * qualité de français très proche. Le `base` (148 Mo) tient moins bien les phrases courtes en
 * français — or « Jarvis » suivi d'un ordre bref est exactement ce cas.
 */
export const MODELE_WHISPER = {
  nom: 'ggml-small-q5_1.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
  megaoctets: 190,
  /** Sous ce seuil, le fichier reçu n'est pas un modèle : page d'erreur HTML, redirection, coupure. */
  octetsMinimum: 20_000_000
} as const

/** La CLI. Archive officielle Windows x64, publiée par le dépôt whisper.cpp. */
export const BINAIRE_WHISPER = {
  version: 'v1.7.6',
  archive: 'whisper-bin-x64.zip',
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip',
  megaoctets: 25,
  octetsMinimum: 200_000
} as const

/**
 * Les noms successifs de la CLI, du plus récent au plus ancien. whisper.cpp a renommé `main.exe` en
 * `whisper-cli.exe` à la v1.7 ; l'archive d'une version intermédiaire peut contenir les deux.
 */
const NOMS_CLI = ['whisper-cli.exe', 'whisper-cli', 'main.exe', 'main'] as const

export interface EtatInstallationWhisper {
  enCours: boolean
  etape: string
  /** 0..1, ou null quand l'étape ne sait pas se mesurer (décompression). */
  fraction: number | null
  erreur: string | null
}

export interface EtatWhisper {
  installe: boolean
  binaire: string | null
  modele: string | null
  racine: string
  modeleNom: string
  megaoctets: number
  installation?: EtatInstallationWhisper
}

/** Le dossier d'installation, sous les données de l'application. */
export function racineWhisper(userData: string): string {
  return join(userData, 'whisper')
}

function listerRecursif(racine: string, prefixe = ''): string[] {
  let entrees: Dirent[]
  try {
    entrees = readdirSync(racine, { withFileTypes: true }) as Dirent[]
  } catch {
    return []
  }
  const trouves: string[] = []
  for (const entree of entrees) {
    const relatif = prefixe === '' ? entree.name : `${prefixe}/${entree.name}`
    if (entree.isDirectory()) trouves.push(...listerRecursif(join(racine, entree.name), relatif))
    else trouves.push(relatif)
  }
  return trouves
}

/**
 * LA bonne CLI parmi tout ce que l'archive contient. `bench`, `quantize`, `server`, `stream`,
 * `talk` démarrent aussi — en choisir un rendrait un processus vivant qui ne transcrit rien.
 */
export function trouverExecutable(fichiers: readonly string[]): string | null {
  for (const nom of NOMS_CLI) {
    const trouve = fichiers.find((f) => {
      const base = f.split(/[\\/]/).pop()?.toLowerCase()
      return base === nom
    })
    if (trouve) return trouve
  }
  return null
}

/** L'état RÉEL, lu sur le disque : ni cache, ni mémoire d'une installation passée. */
export function etatWhisper(racine: string): EtatWhisper {
  const modele = join(racine, MODELE_WHISPER.nom)
  const dossierBin = join(racine, 'bin')
  const relatif = trouverExecutable(listerRecursif(dossierBin))
  const binaire = relatif ? join(dossierBin, ...relatif.split(posix.sep)) : null
  return {
    installe: existsSync(modele) && binaire !== null && existsSync(binaire),
    binaire,
    modele: existsSync(modele) ? modele : null,
    racine,
    modeleNom: MODELE_WHISPER.nom,
    megaoctets: MODELE_WHISPER.megaoctets + BINAIRE_WHISPER.megaoctets
  }
}

/**
 * Les arguments de la CLI. `-nt` (sans horodatage) et `-l fr` sont supportés par les DEUX noms de
 * CLI, ancien comme récent : aucun drapeau récent ici, une archive plus ancienne fonctionnerait.
 * Rien n'est écrit à côté du WAV (`-otxt` absent) : la sortie est lue sur stdout.
 */
export function argumentsWhisper(p: { modele: string; wav: string; fils?: number }): string[] {
  return ['-m', p.modele, '-f', p.wav, '-l', 'fr', '-nt', '-t', String(p.fils ?? filsParDefaut())]
}

/**
 * Combien de fils donner a la CLI. MESURE du 2026-08-31 sur cette machine (16 coeurs), phrase de
 * ~3 s, modele small-q5_1 : 4 fils = 3921 ms, 8 fils = 2717 ms, 12 fils = 2404 ms. Rester a 4
 * coutait donc 1,5 s d'attente a chaque phrase, sur une interaction ou la seconde se sent.
 *
 * Quatre coeurs sont laisses a l'application : la transcription ne doit pas figer l'interface qui
 * l'affiche. Plancher a 4 (petites machines), plafond a 12 (au-dela le gain s'aplatit).
 */
export function filsParDefaut(coeurs: number = cpus().length): number {
  return Math.min(12, Math.max(4, coeurs - 4))
}

const LIGNE_JOURNAL =
  /^(whisper_|ggml_|main:|system_info:|operator\(\)|load_|init:|gpu_|error:|warning:|\s*$)/i
const HORODATAGE = /^\s*\[\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}\]\s*/
/** Les annotations de bruit : whisper les rend quand il n'y a PAS de parole. */
const BRUIT = /^[[(](blank_audio|silence|music|musique|sons?|applaudissements|rires|bruit)[\])]$/i

/**
 * De la sortie brute de la CLI à la PAROLE. Sans ce filtre, le journal du moteur (« loading
 * model… ») partirait en commande vers Jarvis — un ordre inventé à partir de rien.
 */
export function analyserTranscription(sortie: string): string {
  const morceaux: string[] = []
  for (const brute of sortie.split(/\r?\n/)) {
    const ligne = brute.replace(HORODATAGE, '').trim()
    if (ligne === '' || LIGNE_JOURNAL.test(ligne)) continue
    if (BRUIT.test(ligne)) continue
    morceaux.push(ligne)
  }
  return morceaux.join(' ').replace(/\s+/g, ' ').trim()
}

export type Executeur = (
  binaire: string,
  args: readonly string[]
) => Promise<{ stdout: string; stderr: string }>

export type Telechargeur = (
  url: string,
  destination: string,
  progres?: (recus: number, total: number) => void
) => Promise<void>

export type Decompresseur = (archive: string, destination: string) => Promise<void>

export interface ServiceWhisper {
  etat(): EtatWhisper
  installer(): Promise<EtatWhisper>
  transcrire(wav: Uint8Array): Promise<string>
}

/** Exécution réelle de la CLI : sortie plafonnée, temps borné — un moteur pendu ne fige pas l'app. */
const executerReel: Executeur = (binaire, args) =>
  new Promise((resoudre, rejeter) => {
    execFile(
      binaire,
      [...args],
      { timeout: 120_000, maxBuffer: 8_000_000, windowsHide: true },
      (erreur, stdout, stderr) => {
        if (erreur) rejeter(new Error(`whisper: ${erreur.message}${stderr ? ` — ${stderr}` : ''}`))
        else resoudre({ stdout, stderr })
      }
    )
  })

/** Téléchargement réel : suit les redirections (HuggingFace et GitHub en posent toujours). */
const telechargerReel: Telechargeur = (url, destination, progres) =>
  new Promise((resoudre, rejeter) => {
    const partiel = `${destination}.part`
    mkdirSync(destination.slice(0, destination.lastIndexOf(sep)) || '.', { recursive: true })
    const aller = (cible: string, sautsRestants: number): void => {
      httpsGet(cible, { headers: { 'user-agent': 'autowin-os', accept: '*/*' } }, (reponse) => {
        const code = reponse.statusCode ?? 0
        if (code >= 300 && code < 400 && reponse.headers.location) {
          reponse.resume()
          if (sautsRestants === 0) return rejeter(new Error('trop de redirections'))
          return aller(new URL(reponse.headers.location, cible).toString(), sautsRestants - 1)
        }
        if (code !== 200) {
          reponse.resume()
          return rejeter(new Error(`téléchargement refusé (HTTP ${code}) : ${cible}`))
        }
        const total = Number(reponse.headers['content-length'] ?? 0)
        let recus = 0
        const flux = createWriteStream(partiel)
        reponse.on('data', (bloc: Buffer) => {
          recus += bloc.length
          progres?.(recus, total)
        })
        reponse.pipe(flux)
        flux.on('error', rejeter)
        flux.on('finish', () => {
          flux.close(() => {
            // Renommage FINAL : tant qu'il n'a pas eu lieu, rien ne peut passer pour installé.
            renameSync(partiel, destination)
            resoudre()
          })
        })
      }).on('error', rejeter)
    }
    aller(url, 5)
  })

/**
 * Décompression réelle. `Expand-Archive` de PowerShell est présent sur tout Windows supporté : pas
 * de dépendance npm supplémentaire, donc pas de binaire natif à reconstruire à chaque Electron.
 */
const decompresserReel: Decompresseur = (archive, destination) =>
  new Promise((resoudre, rejeter) => {
    mkdirSync(destination, { recursive: true })
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destination}' -Force`
      ],
      { timeout: 180_000, windowsHide: true },
      (erreur) => (erreur ? rejeter(erreur) : resoudre())
    )
  })

export function creerServiceWhisper(options: {
  racine: string
  executer?: Executeur
  telecharger?: Telechargeur
  decompresser?: Decompresseur
}): ServiceWhisper {
  const racine = options.racine
  const executer = options.executer ?? executerReel
  const telecharger = options.telecharger ?? telechargerReel
  const decompresser = options.decompresser ?? decompresserReel
  let installation: EtatInstallationWhisper = {
    enCours: false,
    etape: 'inactive',
    fraction: null,
    erreur: null
  }
  let enCours: Promise<EtatWhisper> | null = null

  const etat = (): EtatWhisper => ({ ...etatWhisper(racine), installation: { ...installation } })

  const poser = (etape: string, fraction: number | null): void => {
    installation = { enCours: true, etape, fraction, erreur: null }
  }

  const installerUneFois = async (): Promise<EtatWhisper> => {
    poser('préparation', 0)
    mkdirSync(racine, { recursive: true })
    try {
      const modele = join(racine, MODELE_WHISPER.nom)
      if (!existsSync(modele)) {
        poser('modèle', 0)
        await telecharger(MODELE_WHISPER.url, modele, (recus, total) =>
          poser('modèle', total > 0 ? recus / total : null)
        )
      }
      if (!etatWhisper(racine).binaire) {
        const archive = join(racine, BINAIRE_WHISPER.archive)
        poser('moteur', 0)
        await telecharger(BINAIRE_WHISPER.url, archive, (recus, total) =>
          poser('moteur', total > 0 ? recus / total : null)
        )
        poser('décompression', null)
        await decompresser(archive, join(racine, 'bin'))
        rmSync(archive, { force: true })
      }
      const final = etatWhisper(racine)
      if (!final.installe) {
        // Le seul échec qui compte : « téléchargé » n'est pas « utilisable ».
        throw new Error(
          `Installation whisper incomplète : ${final.modele ? '' : 'modèle absent '}${final.binaire ? '' : 'CLI whisper introuvable dans l’archive'}`.trim()
        )
      }
      installation = { enCours: false, etape: 'installé', fraction: 1, erreur: null }
      return final
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      installation = { enCours: false, etape: 'échec', fraction: null, erreur: message }
      throw cause
    }
  }

  return {
    etat,
    installer: () => {
      // Un double clic ne lance pas deux téléchargements de 190 Mo.
      if (!enCours) enCours = installerUneFois().finally(() => (enCours = null))
      return enCours
    },
    transcrire: async (wav) => {
      const courant = etatWhisper(racine)
      if (!courant.installe || !courant.binaire || !courant.modele) {
        throw new Error('Whisper local n’est pas installé : lancez l’installation une fois.')
      }
      const dossier = await mkdtemp(join(tmpdir(), 'autowin-whisper-'))
      const fichier = join(dossier, 'segment.wav')
      try {
        await writeFile(fichier, wav)
        const { stdout, stderr } = await executer(
          courant.binaire,
          argumentsWhisper({ modele: courant.modele, wav: fichier })
        )
        // La CLI écrit parfois la transcription sur stderr selon la version : on lit les deux.
        const texte = analyserTranscription(stdout)
        return texte === '' ? analyserTranscription(stderr) : texte
      } finally {
        await rm(dossier, { recursive: true, force: true })
      }
    }
  }
}
