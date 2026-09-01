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
 * LE CONTEXTE AUDIO DE L'ENCODEUR, dimensionné sur la durée RÉELLE du segment.
 *
 * POURQUOI. L'encodeur de whisper traite une fenêtre de 30 s quoi qu'on lui donne : une phrase de
 * 2 s coûte donc autant qu'une de 30 s. MESURE du 2026-08-31 sur cette machine (i5-14400,
 * small-q5_1, 12 fils) : sur une phrase de 4,2 s, `encode time = 5974 ms` sur 7354 ms de total.
 * L'encodeur EST le coût ; le reste est du bruit.
 *
 * `-ac` borne cette fenêtre. Mesures appariées, texte transcrit IDENTIQUE dans les cinq cas :
 *   2,37 s → 2287 ms sans, 845 ms avec ac=512   (×2,7)
 *   3,32 s → 2366 ms sans, 906 ms avec ac=512   (×2,6)
 *   5,23 s → 2394 ms sans, 1052 ms avec ac=600  (×2,3)
 *   6,79 s → 2457 ms sans, 1263 ms avec ac=700  (×1,9)
 *  12,67 s → 2865 ms sans, 2534 ms avec ac=1300 (×1,1)
 *
 * POURQUOI PROPORTIONNEL, ET NON UNE CONSTANTE. Un `-ac` trop petit pour l'audio fourni ne dégrade
 * pas gentiment : il TRONQUE la fin et part en repli de température, donc il devient plus LENT que
 * pas de drapeau du tout. Mesuré, même machine :
 *   - ac=512 sur la phrase de 12,67 s : 20 443 ms (au lieu de 2865 ms) ET fin fausse — « et
 *     preuve-je une preuve » à la place de « et préviens-moi quand tout est terminé » ;
 *   - ac=256 sur la phrase de 4,2 s : 18 833 ms.
 * Une constante « qui va bien » est donc un piège : elle marche sur la phrase avec laquelle on l'a
 * réglée et sabote les autres.
 *
 * LE PLANCHER À 512 est mesuré, pas esthétique : c'est en dessous que le repli s'enclenche. La
 * formule théorique (1500 unités pour 30 s, soit 50/s) donnerait 210 pour 4,2 s — et 256 explose
 * déjà. On garde donc le DOUBLE de marge, plancher inclus.
 */
export const CONTEXTE_PLEIN = 1500
export const CONTEXTE_MINIMUM = 512

export function contexteAudio(secondes: number): number | null {
  if (!Number.isFinite(secondes) || secondes <= 0) return null
  const proportionnel = Math.ceil(secondes) * 100
  if (proportionnel >= CONTEXTE_PLEIN) return null
  return Math.max(CONTEXTE_MINIMUM, proportionnel)
}

/**
 * Les arguments de la CLI. `-nt` (sans horodatage) et `-l fr` sont supportés par les DEUX noms de
 * CLI, ancien comme récent : aucun drapeau récent ici, une archive plus ancienne fonctionnerait.
 * Rien n'est écrit à côté du WAV (`-otxt` absent) : la sortie est lue sur stdout.
 *
 * `--prompt` est ABSENT, et doit le rester. Essayé le 2026-08-31 pour biaiser le vocabulaire du
 * domaine : sur un segment faible (−18 dB), la CLI a RECRACHÉ le prompt mot pour mot
 * (« Jarvis, ouvre le gestionnaire, lance un run, depot, conversation. ») au lieu de transcrire.
 * Sur un moteur qui EXÉCUTE ce qu'il entend, un ordre fabriqué de toutes pièces est bien pire
 * qu'une transcription fausse : l'utilisateur n'a rien dit, et quelque chose s'exécute.
 */
export function argumentsWhisper(p: {
  modele: string
  wav: string
  fils?: number
  secondes?: number
}): string[] {
  const args = [
    '-m',
    p.modele,
    '-f',
    p.wav,
    '-l',
    'fr',
    '-nt',
    '-t',
    String(p.fils ?? filsParDefaut())
  ]
  const contexte = p.secondes === undefined ? null : contexteAudio(p.secondes)
  if (contexte !== null) args.push('-ac', String(contexte))
  return args
}

/**
 * La durée d'un WAV 16 bits mono, lue dans son en-tête. On ne devine pas : le champ `data` porte la
 * taille exacte, et c'est cette durée qui dimensionne `-ac`. Un en-tête illisible rend `null` —
 * l'appelant retombe alors sur le contexte plein, c'est-à-dire le comportement d'avant.
 */
export function dureeWavSecondes(wav: Uint8Array): number | null {
  if (wav.length < 44) return null
  const vue = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const octetsParSeconde = vue.getUint32(28, true)
  const octetsData = vue.getUint32(40, true)
  if (octetsParSeconde === 0) return null
  const utiles = Math.min(octetsData, wav.length - 44)
  if (utiles <= 0) return null
  return utiles / octetsParSeconde
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
        const secondes = dureeWavSecondes(wav)
        const { stdout, stderr } = await executer(
          courant.binaire,
          argumentsWhisper({
            modele: courant.modele,
            wav: fichier,
            ...(secondes === null ? {} : { secondes })
          })
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
