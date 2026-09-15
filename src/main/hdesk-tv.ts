/**
 * PETITE TV DU BUREAU CACHE (conv-528, 2026-09-13). Quand un agent travaille dans un bureau Windows
 * cache (scripts/hdesk-lancer.ps1), le fil montre ce qui s'y passe, en lecture seule.
 *
 * - Bureaux VIVANTS : enumeres par le processus de capture (`list`). Un bureau ferme disparait de
 *   la liste — c'est la seule verite de « ferme », le registre peut etre perime.
 * - Lien TRAVAIL <-> BUREAU : %LOCALAPPDATA%/autowin-hdesk/<id>.json (hors depot : les agents
 *   tournent dans des copies de travail) ecrit par hdesk-lancer.ps1
 *   (-Travail, -Conversation).
 * - Processus de capture OUVERT (scripts/hdesk-tv.ps1) : compile le C# une fois. S'il meurt, repli
 *   sur hdesk-observe.ps1 par image. Il s'arrete apres INACTIVITE_MS sans demande (TV fermee,
 *   fil quitte) et a la sortie de l'app.
 */
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Racine des scripts de capture. Installée, l'app vit dans `app.asar`, que PowerShell ne sait pas
 * ouvrir : electron-builder.yml extrait les scripts (asarUnpack) dans `app.asar.unpacked`. Sans cette
 * substitution, la TV marche en dev et ne voit AUCUN bureau une fois installée (mesure 2026-09-13 :
 * instance packagée, bureau caché vivant, panneau absent). Même parade que resolveOutlookScriptPath.
 */
export function racineScriptsHorsArchive(appPath: string): string {
  return join(
    appPath
      .split(/[\\/]/)
      .map((s) => (s === 'app.asar' ? 'app.asar.unpacked' : s))
      .join(sep)
  )
}

export const ID_BUREAU = /^[a-zA-Z0-9_-]+$/
export const INACTIVITE_MS = 8000

export interface EntreeRegistre {
  id: string
  travail?: string
  conversationId?: string
  pid?: number
  lanceLe?: string
}

export interface BureauTv {
  id: string
  travail: string
  conversationId?: string
  lanceLe?: string
}

export type ImageTv =
  | { statut: 'ok'; id: string; dataUrl: string; width: number; height: number }
  | { statut: 'uni'; id: string; dataUrl: string }
  | { statut: 'ferme'; id: string }
  | { statut: 'erreur'; id: string; message: string }

export function lireRegistre(dossier: string): EntreeRegistre[] {
  if (!existsSync(dossier)) return []
  const entrees: EntreeRegistre[] = []
  for (const nom of readdirSync(dossier)) {
    if (!nom.endsWith('.json')) continue
    try {
      const brut = JSON.parse(readFileSync(join(dossier, nom), 'utf8').replace(/^\uFEFF/, ''))
      if (typeof brut?.id === 'string' && ID_BUREAU.test(brut.id)) entrees.push(brut)
    } catch {
      // Fichier illisible : ignore, le bureau reste listable sans libelle.
    }
  }
  return entrees
}

/**
 * Bureaux a montrer dans un fil : les VIVANTS relies a CE fil, plus recent d'abord.
 */
export function fusionnerBureaux(
  vivants: readonly string[],
  registre: readonly EntreeRegistre[],
  conversationId?: string
): BureauTv[] {
  const parId = new Map(registre.map((e) => [e.id, e]))
  const tous: BureauTv[] = vivants
    .filter((id) => ID_BUREAU.test(id))
    .map((id) => {
      const e = parId.get(id)
      return {
        id,
        travail: e?.travail?.trim() || 'travail non relié',
        ...(e?.conversationId ? { conversationId: e.conversationId } : {}),
        ...(e?.lanceLe ? { lanceLe: e.lanceLe } : {})
      }
    })
    .sort((a, b) => (b.lanceLe ?? '').localeCompare(a.lanceLe ?? ''))
  // Seuls les bureaux de CE fil : un bureau non relie (reste de test, autre fil) devenait un onglet
  // anonyme « travail non relie » (mesure 2026-09-13 : 6 onglets orphelins). Le lanceur exige
  // desormais -Travail et -Conversation, donc un bureau d'agent ne peut plus naitre non relie.
  return conversationId ? tous.filter((b) => b.conversationId === conversationId) : []
}

/** Traduit une reponse `shot` en etat de TV. Bureau introuvable = ferme pendant qu'on regarde. */
export function interpreterCapture(
  id: string,
  reponse: { erreur?: string; uni?: boolean; width?: number; height?: number },
  lirePng: () => Buffer
): ImageTv {
  if (reponse.erreur) {
    if (/introuvable/i.test(reponse.erreur)) return { statut: 'ferme', id }
    return { statut: 'erreur', id, message: reponse.erreur }
  }
  const dataUrl = `data:image/png;base64,${lirePng().toString('base64')}`
  if (reponse.uni) return { statut: 'uni', id, dataUrl }
  return { statut: 'ok', id, dataUrl, width: reponse.width ?? 0, height: reponse.height ?? 0 }
}

type Reponse = Record<string, unknown> & { erreur?: string }

export const PREFIXE_DOSSIER = 'autowin-hdesk-tv-'

/**
 * Une app tuee (arret du dev server) ne passe jamais par detruire() : son dossier temporaire reste.
 * Mesure 2026-09-15 : 20 dossiers autowin-hdesk-tv-* orphelins dans %TEMP%. Purge au demarrage.
 */
export function purgerDossiersOrphelins(racine: string): number {
  let n = 0
  try {
    for (const nom of readdirSync(racine)) {
      if (!nom.startsWith(PREFIXE_DOSSIER)) continue
      rmSync(join(racine, nom), { recursive: true, force: true })
      n++
    }
  } catch {
    // Dossier temporaire illisible : rien a purger.
  }
  return n
}

/**
 * EFFACE LES RESTES D'UN BUREAU FERME : sa fiche `<id>.json` et son dossier `webview2/<id>` (pose par
 * hdesk-lancer.ps1). Le lanceur rend la main avant la fermeture de l'app : seule la liste des bureaux
 * VIVANTS sait qu'il est parti. Mesure 2026-09-15 : 39 fiches mortes dans %LOCALAPPDATA%/autowin-hdesk.
 * N'appeler qu'avec une liste REELLEMENT obtenue : une liste vide par erreur effacerait tout.
 */
export function purgerBureauxFermes(dossier: string, vivants: readonly string[]): string[] {
  const enVie = new Set(vivants)
  const effaces: string[] = []
  for (const e of lireRegistre(dossier)) {
    if (enVie.has(e.id)) continue
    try {
      rmSync(join(dossier, 'webview2', e.id), { recursive: true, force: true })
      rmSync(join(dossier, `${e.id}.json`), { force: true })
      effaces.push(e.id)
    } catch {
      // Fichier encore tenu par un processus qui se termine : repris au prochain passage.
    }
  }
  return effaces
}

export class CapteurHdesk {
  private proc: ChildProcessWithoutNullStreams | null = null
  private tampon = ''
  private attente: Array<(r: Reponse) => void> = []
  private file: Promise<unknown> = Promise.resolve()
  private minuterie: NodeJS.Timeout | null = null
  private readonly dossierImages: string

  constructor(
    private readonly racine: string,
    private readonly registre = join(process.env.LOCALAPPDATA ?? tmpdir(), 'autowin-hdesk')
  ) {
    purgerDossiersOrphelins(tmpdir())
    this.dossierImages = mkdtempSync(join(tmpdir(), PREFIXE_DOSSIER))
  }

  async bureaux(conversationId?: string): Promise<BureauTv[]> {
    const r = await this.demander('list')
    const vivants = Array.isArray(r.bureaux) ? (r.bureaux as string[]) : []
    if (!r.erreur && Array.isArray(r.bureaux)) purgerBureauxFermes(this.registre, vivants)
    return fusionnerBureaux(vivants, lireRegistre(this.registre), conversationId)
  }

  async image(id: string): Promise<ImageTv> {
    if (!ID_BUREAU.test(id))
      return { statut: 'erreur', id, message: 'Identifiant de bureau invalide.' }
    // Recree si une AUTRE instance d'Autowin l'a purge comme orphelin a son demarrage.
    mkdirSync(this.dossierImages, { recursive: true })
    const png = join(this.dossierImages, `${id}.png`)
    let r: Reponse
    try {
      r = await this.demander(`shot ${id} ${png}`)
    } catch {
      r = await this.observerParScript(id, png)
    }
    try {
      return interpreterCapture(id, r, () => readFileSync(png))
    } catch (e) {
      return { statut: 'erreur', id, message: e instanceof Error ? e.message : String(e) }
    } finally {
      // L'IMAGE PART EN MEMOIRE (dataUrl) : le fichier ne sert plus des la lecture. Demande conv-540
      // (2026-09-15) : « les screenshots pris faut qu'ils soient nettoyes direct ».
      rmSync(png, { force: true })
    }
  }

  arreter(): void {
    if (this.minuterie) clearTimeout(this.minuterie)
    this.minuterie = null
    const p = this.proc
    this.proc = null
    for (const r of this.attente.splice(0)) r({ erreur: 'Processus de capture arrete.' })
    if (p && !p.killed) {
      p.stdin.end()
      p.kill()
    }
  }

  detruire(): void {
    this.arreter()
    rmSync(this.dossierImages, { recursive: true, force: true })
  }

  private demander(commande: string): Promise<Reponse> {
    const suite = this.file.then(() => this.envoyer(commande))
    this.file = suite.catch(() => undefined)
    return suite
  }

  private envoyer(commande: string): Promise<Reponse> {
    this.rearmer()
    const p = this.demarrer()
    return new Promise<Reponse>((resolve, reject) => {
      const delai = setTimeout(() => {
        this.arreter()
        reject(new Error('Capture sans reponse.'))
      }, 15000)
      this.attente.push((r) => {
        clearTimeout(delai)
        if (r.erreur === 'Processus de capture arrete.') reject(new Error(r.erreur))
        else resolve(r)
      })
      p.stdin.write(`${commande}\n`)
    })
  }

  private demarrer(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const p = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(this.racine, 'scripts', 'hdesk-tv.ps1')
      ],
      { windowsHide: true }
    )
    this.proc = p
    this.tampon = ''
    let pret = false
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (morceau: string) => {
      this.tampon += morceau
      let i: number
      while ((i = this.tampon.indexOf('\n')) >= 0) {
        const ligne = this.tampon.slice(0, i).trim()
        this.tampon = this.tampon.slice(i + 1)
        if (!ligne) continue
        let r: Reponse
        try {
          r = JSON.parse(ligne)
        } catch {
          continue
        }
        // fix-ok: src/main/hdesk-tv.ts doit sauter la ligne pret : scripts/hdesk-tv.ps1 emet {"pret":true} au demarrage ; sans ce saut, cette ligne repond a la 1re demande et tout se decale d'un cran (mesure 2026-09-13 : saut retire -> test bureau reel rouge, exit 1)
        if (!pret && r.pret === true) {
          pret = true
          continue
        }
        this.attente.shift()?.(r)
      }
    })
    p.on('exit', () => {
      if (this.proc === p) this.arreter()
    })
    p.on('error', () => {
      if (this.proc === p) this.arreter()
    })
    return p
  }

  private rearmer(): void {
    if (this.minuterie) clearTimeout(this.minuterie)
    this.minuterie = setTimeout(() => this.arreter(), INACTIVITE_MS)
  }

  /** Repli : une capture = un hdesk-observe.ps1 (plus lent, meme resultat). */
  private observerParScript(id: string, png: string): Promise<Reponse> {
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          join(this.racine, 'scripts', 'hdesk-observe.ps1'),
          '-InstanceId',
          id,
          '-Output',
          png
        ],
        { windowsHide: true, timeout: 20000 },
        (_err, stdout, stderr) => {
          try {
            const r = JSON.parse(String(stdout).trim())
            resolve({ uni: r.uni, width: r.width, height: r.height })
          } catch {
            resolve({ erreur: String(stderr).trim() || 'Capture impossible.' })
          }
        }
      )
    })
  }
}
