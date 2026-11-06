/**
 * LE TÉLÉCHARGEMENT DES GROS FICHIERS — un seul endroit, pour whisper comme pour la voix Piper.
 *
 * POURQUOI CE FICHIER EXISTE. Le téléchargeur, le décompresseur et le contrôle de taille vivaient
 * à l'intérieur de `whisper-local.ts`. Ajouter un second moteur hors ligne (la voix Piper) aurait
 * recopié les trois — donc recopié aussi leurs trous.
 *
 * LE TROU QUI EST FERMÉ ICI. `octetsMinimum` était DÉCLARÉ dans whisper et lu par PERSONNE : une
 * page d'erreur HTML de 3 Ko enregistrée sous le nom du modèle passait pour « installé », et la
 * panne ne se voyait qu'à la première parole. `verifierTaille` est le lecteur manquant, et il
 * EFFACE le fichier douteux : un fichier trop court ne doit jamais survivre à son propre refus.
 */
import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { get as httpsGet } from 'node:https'
import { sep } from 'node:path'

export type Progres = (recus: number, total: number) => void

export type Telechargeur = (url: string, destination: string, progres?: Progres) => Promise<void>

export type Decompresseur = (archive: string, destination: string) => Promise<void>

/**
 * Refuse un fichier trop court POUR CE QU'IL PRÉTEND ÊTRE, et l'efface.
 *
 * Une redirection perdue, une coupure réseau ou une page d'erreur rendent un fichier bien nommé et
 * inutilisable. Sans ce contrôle, l'installation se déclare réussie et c'est l'usage qui échoue,
 * beaucoup plus tard et sans rapport visible avec le téléchargement.
 */
export function verifierTaille(chemin: string, octetsMinimum: number, quoi: string): void {
  let octets = 0
  try {
    octets = statSync(chemin).size
  } catch {
    octets = 0
  }
  if (octets >= octetsMinimum) return
  rmSync(chemin, { force: true })
  throw new Error(
    `${quoi} : fichier reçu incomplet (${octets} octets, minimum attendu ${octetsMinimum}). ` +
      'Téléchargement interrompu ou refusé — relancez l’installation.'
  )
}

/** Téléchargement réel : suit les redirections (HuggingFace et GitHub en posent toujours). */
export const telechargerReel: Telechargeur = (url, destination, progres) =>
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
export const decompresserReel: Decompresseur = (archive, destination) =>
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
