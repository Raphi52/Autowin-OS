import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

/**
 * La passerelle Outlook LOCALE, côté process principal.
 *
 * Elle lance `scripts/outlook-local-snapshot.ps1`, qui lit le profil Outlook de la machine par
 * automation COM, et rend son instantané. Rien ne sort du poste : aucune requête réseau, aucun jeton,
 * aucune adresse envoyée où que ce soit. C'est la raison pour laquelle l'utilisateur a écarté
 * Microsoft Graph.
 *
 * Trois décisions structurent ce fichier, chacune adossée à une mesure de ce poste :
 *  - le script écrit son JSON dans un FICHIER, jamais sur la sortie standard : celle de PowerShell
 *    est rendue en cp1252 ici, et un accent y est perdu avant même d'arriver à Node ;
 *  - un ÉCHEC est une valeur, pas une exception muette : « Outlook fermé » et « lecture impossible »
 *    doivent atteindre l'écran, sinon une liste vide se lit comme « vous n'avez pas de mail » ;
 *  - un CACHE court, parce qu'un appel COM démarre un dialogue avec une application lourde et que la
 *    page d'accueil se rafraîchit périodiquement.
 */

export interface OutlookGatewayResult {
  ok: boolean
  [key: string]: unknown
}

export interface OutlookGatewayOptions {
  /** Racine du dépôt / de l'application, d'où le script est résolu. */
  appRoot: string
  /** Durée de vie du cache. Un appel plus rapproché rend l'instantané déjà lu. */
  ttlMs?: number
  /** Injection pour les tests : évite de dépendre d'un Outlook installé. */
  runner?: (scriptPath: string, outPath: string) => Promise<void>
  now?: () => number
}

const DEFAULT_TTL_MS = 60_000
/** Au-delà, on considère qu'Outlook ne répondra pas : il vaut mieux une erreur nommée qu'une attente. */
const TIMEOUT_MS = 45_000

function defaultRunner(scriptPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        // La politique d'exécution de la machine ne doit pas décider si l'app peut lire la boîte :
        // le script est livré AVEC l'application, il n'est pas téléchargé.
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Out',
        outPath
      ],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error) => {
        // Le code de sortie 1 est un ÉCHEC ÉCRIT par le script : le fichier contient alors sa cause,
        // qui est plus précise que le message d'`execFile`. On laisse donc la lecture décider.
        if (error && (error as { code?: number }).code !== 1) reject(error)
        else resolve()
      }
    )
  })
}

export class OutlookLocalGateway {
  private readonly appRoot: string
  private readonly ttlMs: number
  private readonly runner: (scriptPath: string, outPath: string) => Promise<void>
  private readonly now: () => number
  private cache: { at: number; result: OutlookGatewayResult } | null = null
  /** Lecture en cours : deux widgets qui interrogent en même temps ne doivent lancer QU'UN script. */
  private pending: Promise<OutlookGatewayResult> | null = null

  constructor(options: OutlookGatewayOptions) {
    this.appRoot = options.appRoot
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.runner = options.runner ?? defaultRunner
    this.now = options.now ?? (() => Date.now())
  }

  /** L'instantané, depuis le cache s'il est encore frais. */
  async snapshot(force = false): Promise<OutlookGatewayResult> {
    if (!force && this.cache && this.now() - this.cache.at < this.ttlMs) {
      return this.cache.result
    }
    if (this.pending) return this.pending
    this.pending = this.read()
      .then((result) => {
        // Seul un succès est mis en cache : garder une panne pendant une minute empêcherait de voir
        // qu'Outlook vient d'être ouvert.
        if (result.ok) this.cache = { at: this.now(), result }
        return result
      })
      .finally(() => {
        this.pending = null
      })
    return this.pending
  }

  private async read(): Promise<OutlookGatewayResult> {
    const scriptPath = resolveOutlookScriptPath(this.appRoot)
    let dossier: string | null = null
    try {
      dossier = await mkdtemp(join(tmpdir(), 'autowin-outlook-'))
      const outPath = join(dossier, 'snapshot.json')
      await this.runner(scriptPath, outPath)
      // Lu en UTF-8 explicitement : c'est l'encodage que le script écrit, et le défaut de la
      // plate-forme ne doit pas s'en mêler.
      const brut = await readFile(outPath, 'utf8')
      const parsed = JSON.parse(brut) as OutlookGatewayResult
      if (typeof parsed !== 'object' || parsed === null) {
        return { ok: false, erreur: 'la passerelle Outlook a rendu une réponse illisible' }
      }
      return parsed
    } catch (error) {
      return { ok: false, erreur: describeFailure(error) }
    } finally {
      if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Vide le cache. Sert au rafraîchissement demandé explicitement par l'utilisateur. */
  invalidate(): void {
    this.cache = null
  }
}

/**
 * Traduit une panne technique en une phrase qui dit quoi faire.
 *
 * « ENOENT » ou « code 0x80080005 » n'aident personne : ce qui aide est « Outlook n'est pas
 * installé » ou « Outlook n'a pas répondu ».
 */
export function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOENT/i.test(message) && /powershell/i.test(message)) {
    return 'PowerShell est introuvable : la passerelle Outlook locale ne peut pas démarrer.'
  }
  if (/ENOENT/i.test(message)) {
    return "Le script de lecture d'Outlook est introuvable dans l'installation."
  }
  if (/timed out|ETIMEDOUT|timeout/i.test(message)) {
    return "Outlook n'a pas répondu à temps. Est-il en cours de synchronisation ?"
  }
  if (/Unexpected (token|end)/i.test(message) || /JSON/i.test(message)) {
    return "La lecture d'Outlook s'est interrompue avant d'avoir fini d'écrire."
  }
  if (/8000401a|80080005|80040154|Class not registered|Serveur RPC|RPC server/i.test(message)) {
    return "Outlook a refusé l'accès. Ouvrez Outlook, puis réessayez."
  }
  return message
}

/**
 * Où trouver le script de lecture, en développement comme en packagé.
 *
 * En packagé, le code vit dans `app.asar` — et PowerShell ne sait pas ouvrir un fichier à
 * l'intérieur d'une archive. `electron-builder.yml` extrait donc ce script (`asarUnpack`), ce qui le
 * dépose dans un dossier frère nommé `app.asar.unpacked`. La substitution ci-dessous est la seule
 * chose qui relie les deux : sans elle, la passerelle fonctionne en développement et reste
 * introuvable une fois installée.
 */
export function resolveOutlookScriptPath(appPath: string): string {
  // Découpage sur les DEUX séparateurs plutôt qu'une expression régulière : sur Windows le séparateur
  // est l'antislash, et une classe de caractères qui ne le contient pas ne matche rien — un piège
  // silencieux, puisqu'on retombe alors sur le chemin dans l'archive.
  const segments = appPath.split(/[\\/]/)
  const racine = segments
    .map((segment) => (segment === 'app.asar' ? 'app.asar.unpacked' : segment))
    .join(sep)
  return join(racine, 'scripts', 'outlook-local-snapshot.ps1')
}
