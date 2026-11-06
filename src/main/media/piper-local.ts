/**
 * LA VOIX DE JARVIS EN QUALITÉ NEURONALE (Piper), hors ligne.
 *
 * POURQUOI CE FICHIER EXISTE. Demande mesurée : « comment avoir des voix plus sympa dans Jarvis ».
 * Jusqu'ici Jarvis parlait avec `speechSynthesis`, c'est-à-dire avec les voix DÉJÀ installées sur
 * Windows. Leur qualité est le plafond du poste : aucun réglage de débit ou de hauteur ne la
 * dépasse. Une voix neuronale, elle, se télécharge.
 *
 * CE QUE FAIT CE MODULE. Exactement le patron déjà prouvé par `whisper-local.ts` : un exécutable
 * autonome et un modèle, téléchargés UNE seule fois dans `userData` sur un clic explicite. Ensuite,
 * plus rien ne sort de la machine — la synthèse tourne en local, sur le processeur.
 *
 * TROIS GARDES QUI NE DOIVENT PAS ÊTRE « SIMPLIFIÉES ».
 *  - `etatPiper` ne dit « installé » que si l'exécutable, le modèle ET sa fiche `.json` sont là.
 *    Piper refuse de démarrer sans la fiche : un état optimiste ferait taire Jarvis.
 *  - chaque fichier reçu est PESÉ (`verifierTaille`) : une page d'erreur porte aussi bien le nom
 *    d'un modèle, et « téléchargé » n'est pas « utilisable ».
 *  - rien ici n'est un préalable. Sans installation, `etat().installe` est faux et la fenêtre
 *    reparle avec la voix du système : un poste sans Piper marche comme avant.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, type Dirent } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import {
  decompresserReel,
  telechargerReel,
  verifierTaille,
  type Decompresseur,
  type Telechargeur
} from './telechargement'

/**
 * LA VOIX. `fr_FR-siwis-medium` : voix française, 22 kHz. Tailles RELEVÉES le 2026-09-02 sur les
 * en-têtes HTTP des adresses ci-dessous (`content-length`) : 63 201 294 et 4 875 octets.
 * La variante `low` ne pèse que 28 Mo mais descend à 16 kHz — or « une voix plus sympa » est
 * précisément ce qui est demandé, et c'est là que la différence s'entend.
 */
export const VOIX_PIPER = {
  nom: 'fr_FR-siwis-medium.onnx',
  url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
  /** La fiche du modèle (phonèmes, taux d'échantillonnage). Piper refuse de parler sans elle. */
  urlConfig:
    'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json',
  megaoctets: 63,
  octetsMinimum: 50_000_000,
  octetsMinimumConfig: 500
} as const

/** LE MOTEUR. Archive officielle Windows x64 du dépôt Piper. 22 477 236 octets relevés. */
export const BINAIRE_PIPER = {
  version: '2023.11.14-2',
  archive: 'piper_windows_amd64.zip',
  url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  megaoctets: 22,
  octetsMinimum: 15_000_000
} as const

const NOMS_PIPER = ['piper.exe', 'piper'] as const

export interface EtatInstallationPiper {
  enCours: boolean
  etape: string
  /** 0..1, ou null quand l'étape ne sait pas se mesurer (décompression). */
  fraction: number | null
  erreur: string | null
}

export interface EtatPiper {
  installe: boolean
  binaire: string | null
  voix: string | null
  racine: string
  voixNom: string
  megaoctets: number
  installation?: EtatInstallationPiper
}

/** Le dossier d'installation, sous les données de l'application. */
export function racinePiper(userData: string): string {
  return join(userData, 'piper')
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
 * L'exécutable Piper parmi tout ce que l'archive contient. Elle embarque aussi des bibliothèques
 * `onnxruntime` et des outils d'espeak : en prendre un au hasard rendrait un processus qui démarre
 * et ne produit aucun son.
 */
export function trouverPiper(fichiers: readonly string[]): string | null {
  for (const nom of NOMS_PIPER) {
    const trouve = fichiers.find((f) => f.split(/[\\/]/).pop()?.toLowerCase() === nom)
    if (trouve) return trouve
  }
  return null
}

/** L'état RÉEL, lu sur le disque : ni cache, ni mémoire d'une installation passée. */
export function etatPiper(racine: string): EtatPiper {
  const voix = join(racine, VOIX_PIPER.nom)
  const fiche = `${voix}.json`
  const dossierBin = join(racine, 'bin')
  const relatif = trouverPiper(listerRecursif(dossierBin))
  const binaire = relatif ? join(dossierBin, ...relatif.split(posix.sep)) : null
  const voixPresente = existsSync(voix) && existsSync(fiche)
  return {
    installe: voixPresente && binaire !== null && existsSync(binaire),
    binaire,
    voix: voixPresente ? voix : null,
    racine,
    voixNom: VOIX_PIPER.nom,
    megaoctets: VOIX_PIPER.megaoctets + BINAIRE_PIPER.megaoctets
  }
}

/**
 * Ce que Piper reçoit sur sa ligne de commande. Le texte N'Y FIGURE PAS : il est écrit sur
 * l'entrée standard. Une phrase contenant un guillemet ou une esperluette casserait la commande —
 * ou, pire, y glisserait autre chose.
 */
export function argumentsPiper(options: { voix: string; sortie: string }): string[] {
  return ['--model', options.voix, '--output_file', options.sortie]
}

export type ExecuteurPiper = (
  binaire: string,
  args: readonly string[],
  texte: string,
  dossier: string
) => Promise<void>

export interface ServicePiper {
  etat(): EtatPiper
  installer(): Promise<EtatPiper>
  /** Rend le WAV prononcé. La fenêtre le joue : ce processus n'a pas de haut-parleur. */
  synthetiser(texte: string): Promise<Uint8Array>
}

/**
 * Exécution réelle. Temps borné : une synthèse pendue ne doit pas laisser Jarvis muet ET occupé.
 * `cwd` est le dossier de l'exécutable — Piper y cherche ses données espeak-ng.
 */
const executerReel: ExecuteurPiper = (binaire, args, texte, dossier) =>
  new Promise((resoudre, rejeter) => {
    const enfant = spawn(binaire, [...args], { cwd: dossier, windowsHide: true })
    let erreurs = ''
    const minuteur = setTimeout(() => {
      enfant.kill()
      rejeter(new Error('piper : synthèse trop longue (30 s)'))
    }, 30_000)
    enfant.stderr?.on('data', (bloc: Buffer) => {
      erreurs = (erreurs + bloc.toString()).slice(-2_000)
    })
    enfant.on('error', (cause) => {
      clearTimeout(minuteur)
      rejeter(cause)
    })
    enfant.on('close', (code) => {
      clearTimeout(minuteur)
      if (code === 0) resoudre()
      else rejeter(new Error(`piper a échoué (code ${code})${erreurs ? ` — ${erreurs}` : ''}`))
    })
    enfant.stdin?.end(texte, 'utf8')
  })

export function creerServicePiper(options: {
  racine: string
  executer?: ExecuteurPiper
  telecharger?: Telechargeur
  decompresser?: Decompresseur
}): ServicePiper {
  const racine = options.racine
  const executer = options.executer ?? executerReel
  const telecharger = options.telecharger ?? telechargerReel
  const decompresser = options.decompresser ?? decompresserReel
  let installation: EtatInstallationPiper = {
    enCours: false,
    etape: 'inactive',
    fraction: null,
    erreur: null
  }
  let enCours: Promise<EtatPiper> | null = null

  const etat = (): EtatPiper => ({ ...etatPiper(racine), installation: { ...installation } })

  const poser = (etape: string, fraction: number | null): void => {
    installation = { enCours: true, etape, fraction, erreur: null }
  }

  const installerUneFois = async (): Promise<EtatPiper> => {
    poser('préparation', 0)
    mkdirSync(racine, { recursive: true })
    try {
      const voix = join(racine, VOIX_PIPER.nom)
      if (!existsSync(voix)) {
        poser('voix', 0)
        await telecharger(VOIX_PIPER.url, voix, (recus, total) =>
          poser('voix', total > 0 ? recus / total : null)
        )
        verifierTaille(voix, VOIX_PIPER.octetsMinimum, 'Voix Piper')
      }
      const fiche = `${voix}.json`
      if (!existsSync(fiche)) {
        poser('fiche de la voix', null)
        await telecharger(VOIX_PIPER.urlConfig, fiche)
        verifierTaille(fiche, VOIX_PIPER.octetsMinimumConfig, 'Fiche de la voix Piper')
      }
      if (!etatPiper(racine).binaire) {
        const archive = join(racine, BINAIRE_PIPER.archive)
        poser('moteur', 0)
        await telecharger(BINAIRE_PIPER.url, archive, (recus, total) =>
          poser('moteur', total > 0 ? recus / total : null)
        )
        verifierTaille(archive, BINAIRE_PIPER.octetsMinimum, 'Moteur Piper')
        poser('décompression', null)
        await decompresser(archive, join(racine, 'bin'))
        rmSync(archive, { force: true })
      }
      const final = etatPiper(racine)
      if (!final.installe) {
        // Le seul échec qui compte : « téléchargé » n'est pas « utilisable ».
        throw new Error(
          `Installation Piper incomplète : ${final.voix ? '' : 'voix absente '}${final.binaire ? '' : 'exécutable piper introuvable dans l’archive'}`.trim()
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
      // Un double clic ne lance pas deux téléchargements de 85 Mo.
      if (!enCours) enCours = installerUneFois().finally(() => (enCours = null))
      return enCours
    },
    synthetiser: async (texte) => {
      const courant = etatPiper(racine)
      if (!courant.installe || !courant.binaire || !courant.voix) {
        throw new Error('La voix Piper n’est pas installée : lancez l’installation une fois.')
      }
      const propre = texte.trim()
      if (propre === '') throw new Error('Rien à prononcer')
      const dossier = await mkdtemp(join(tmpdir(), 'autowin-piper-'))
      const sortie = join(dossier, 'voix.wav')
      try {
        await executer(
          courant.binaire,
          argumentsPiper({ voix: courant.voix, sortie }),
          propre,
          dirname(courant.binaire)
        )
        if (!existsSync(sortie)) throw new Error('piper n’a produit aucun son')
        return new Uint8Array(readFileSync(sortie))
      } finally {
        await rm(dossier, { recursive: true, force: true })
      }
    }
  }
}
