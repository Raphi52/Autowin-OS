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
import { supprimerArbre } from './fs-supprimer'

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

/** Le processus existe-t-il encore ? `kill(pid, 0)` n'envoie rien : il ne fait que sonder. */
export function processusVivant(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM : il existe mais appartient a un autre utilisateur.
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Bureaux a montrer dans un fil : les VIVANTS relies a CE fil, plus recent d'abord.
 */
export function fusionnerBureaux(
  vivants: readonly string[],
  registre: readonly EntreeRegistre[],
  conversationId?: string,
  pidVivant: (pid: number) => boolean = processusVivant
): BureauTv[] {
  const parId = new Map(registre.map((e) => [e.id, e]))
  const tous: BureauTv[] = vivants
    .filter((id) => ID_BUREAU.test(id))
    // APP MORTE = BUREAU FINI (conv-536, 2026-09-24) : le bureau Windows survit a son application
    // (le capteur en tient une poignee), donc la TV restait « en direct » sur un Bloc-notes tue.
    .filter((id) => {
      const pid = parId.get(id)?.pid
      return typeof pid !== 'number' || pidVivant(pid)
    })
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

/** Coin haut-gauche de la capture dans l'ecran du bureau cache (pixels physiques). */
export interface OrigineCapture {
  x: number
  y: number
}

/**
 * Origine lue dans une reponse `shot` de scripts/hdesk-tv.ps1. Absente (repli hdesk-observe.ps1,
 * capture plein ecran) ou illisible : (0,0), l'image commence au coin de l'ecran.
 */
export function origineCapture(reponse: Record<string, unknown>): OrigineCapture {
  const lire = (v: unknown): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0
  return { x: lire(reponse.origineX), y: lire(reponse.origineY) }
}

/**
 * CLIC DANS UNE IMAGE RECADREE (conv-1009, 2026-10-16) : « Action refusée : Aucune fenetre en
 * (362,144) dans ce bureau ». La TV et la vue « Bureaux cachés » montrent une capture recadree autour
 * des fenetres, et le renderer rend le point en pixels de CETTE image ; hdesk-act.ps1 attend des
 * pixels de l'ECRAN du bureau. On ajoute donc l'origine du recadrage. Des coordonnees invalides
 * passent telles quelles : c'est argumentsAct qui les refuse, avec son message.
 */
export function pointEcran(g: GesteTv, origine: OrigineCapture | undefined): GesteTv {
  if (!origine || !Number.isFinite(g?.x) || !Number.isFinite(g?.y)) return g
  return { ...g, x: g.x + origine.x, y: g.y + origine.y }
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
      supprimerArbre(join(racine, nom))
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
      supprimerArbre(join(dossier, 'webview2', e.id))
      rmSync(join(dossier, `${e.id}.json`), { force: true })
      effaces.push(e.id)
    } catch {
      // Fichier encore tenu par un processus qui se termine : repris au prochain passage.
    }
  }
  // JOURNAL DES GESTES (conv-344) : part avec son bureau, qu'il ait une fiche ou non (ui-capture-*).
  for (const nom of existsSync(dossier) ? readdirSync(dossier) : []) {
    const m = /^([a-zA-Z0-9_-]+)\.gestes\.jsonl$/.exec(nom)
    if (!m || enVie.has(m[1])) continue
    try {
      rmSync(join(dossier, nom), { force: true })
    } catch {
      // Tenu à l'instant par un geste qui écrit : repris au prochain passage.
    }
  }
  return effaces
}

/** Liste brute des bureaux vivants : une ERREUR n'est jamais une liste vide (elle purgerait tout). */
export type ListeVivants = { ok: true; vivants: string[] } | { ok: false; message: string }

export class CapteurHdesk {
  private proc: ChildProcessWithoutNullStreams | null = null
  private tampon = ''
  private attente: Array<(r: Reponse) => void> = []
  private file: Promise<unknown> = Promise.resolve()
  private minuterie: NodeJS.Timeout | null = null
  private readonly dossierImages: string
  /** Origine du recadrage de la derniere image rendue, par bureau (conv-1009). */
  private readonly origines = new Map<string, OrigineCapture>()

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

  /**
   * TOUS les bureaux vivants, sans filtre par fil — pour la vue « Bureaux cachés » (conv-344, scout
   * n°7). Passe par CE processus déjà ouvert : la vue lançait un PowerShell neuf à chaque tour de
   * liste (0,92 s mesurées, toutes les 4 s). Purge au passage les fiches des bureaux fermés (n°13),
   * comme `bureaux()`, mais seulement sur une liste réellement obtenue.
   */
  async listeVivants(): Promise<ListeVivants> {
    let r: Reponse
    try {
      r = await this.demander('list')
    } catch (e) {
      return { ok: false, message: `Processus de capture sans réponse (${(e as Error).message})` }
    }
    if (typeof r.erreur === 'string') return { ok: false, message: r.erreur }
    if (!Array.isArray(r.bureaux)) return { ok: false, message: 'Liste des bureaux illisible.' }
    const vivants = r.bureaux.map(String)
    purgerBureauxFermes(this.registre, vivants)
    return { ok: true, vivants }
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
      const img = interpreterCapture(id, r, () => readFileSync(png))
      // L'origine suit la DERNIERE image rendue de ce bureau : c'est elle que l'utilisateur voit et clique.
      if (img.statut === 'ok' || img.statut === 'uni') this.origines.set(id, origineCapture(r))
      else if (img.statut === 'ferme') this.origines.delete(id)
      return img
    } catch (e) {
      return { statut: 'erreur', id, message: e instanceof Error ? e.message : String(e) }
    } finally {
      // L'IMAGE PART EN MEMOIRE (dataUrl) : le fichier ne sert plus des la lecture. Demande conv-540
      // (2026-09-15) : « les screenshots pris faut qu'ils soient nettoyes direct ».
      rmSync(png, { force: true })
    }
  }

  /**
   * Geste pose sur l'image de ce bureau -> geste en pixels de son ecran. Limite assumee : si une
   * capture plus recente a deplace l'origine dans l'instant entre l'affichage et le clic (fenetre
   * ouverte au-dessus ou a gauche des autres), le clic suit la plus recente.
   */
  versEcran(g: GesteTv): GesteTv {
    return pointEcran(g, typeof g?.id === 'string' ? this.origines.get(g.id) : undefined)
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
    supprimerArbre(this.dossierImages)
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

/**
 * TV INTERACTIVE (conv-35, 2026-10-01) : « switcher vers les hdesk pour interagir avec ce qui s'y
 * passe ». Un geste de l'utilisateur dans la TV = un appel de scripts/hdesk-act.ps1 (messages fenêtre,
 * jamais la vraie souris ni le vrai clavier). Le script fait toujours un clic, puis la frappe éventuelle.
 */
export interface GesteTv {
  id: string
  x: number
  y: number
  texte?: string
  entree?: boolean
  /** conv-35 : touche nommée (liste TOUCHES_TV), crans de molette (+ = haut), frappe sans reclic. */
  touche?: string
  molette?: number
  sansClic?: boolean
}

/** Touches reconnues par scripts/hdesk-act.cs (dictionnaire Touches) — garder les deux listes alignées. */
export const TOUCHES_TV = [
  'Tab',
  'Echap',
  'Retour',
  'Entree',
  'Suppr',
  'Haut',
  'Bas',
  'Gauche',
  'Droite',
  'Debut',
  'Fin',
  'PageHaut',
  'PageBas',
  'CtrlA',
  'CtrlC',
  'CtrlV',
  'CtrlX',
  'CtrlZ'
] as const

/** Arguments PowerShell d'un geste ; lève si l'identifiant ou les coordonnées sont invalides. */
/** hdesk-act.cs range x et y sur 16 bits (lParam) : au-delà, le clic partirait AILLEURS (conv-344). */
export const COORDONNEE_MAX = 32767
/** Frappe bornée : un texte énorme bloquerait le geste jusqu'au délai de 20 s (conv-344). */
export const FRAPPE_MAX = 1000

/**
 * `registre` : dossier du journal des gestes (`<id>.gestes.jsonl`, conv-344) ; absent = celui du script
 * (%LOCALAPPDATA%/autowin-hdesk, le même que CapteurHdesk). Les TESTS passent un dossier temporaire.
 */
export function argumentsAct(racine: string, g: GesteTv, registre?: string): string[] {
  if (typeof g?.id !== 'string' || !ID_BUREAU.test(g.id))
    throw new Error('Identifiant de bureau invalide.')
  if (!Number.isFinite(g.x) || !Number.isFinite(g.y) || g.x < 0 || g.y < 0)
    throw new Error('Coordonnées invalides.')
  if (g.x > COORDONNEE_MAX || g.y > COORDONNEE_MAX)
    throw new Error(`Coordonnées hors bornes (${COORDONNEE_MAX} au plus).`)
  if (typeof g.texte === 'string' && g.texte.length > FRAPPE_MAX)
    throw new Error(`Texte trop long (${FRAPPE_MAX} caractères au plus).`)
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(racine, 'scripts', 'hdesk-act.ps1'),
    '-InstanceId',
    g.id,
    '-X',
    String(Math.round(g.x)),
    '-Y',
    String(Math.round(g.y))
  ]
  if (typeof g.texte === 'string' && g.texte) args.push('-Texte', g.texte)
  if (g.entree === true) args.push('-Entree')
  if (g.touche !== undefined) {
    if (!(TOUCHES_TV as readonly string[]).includes(g.touche)) throw new Error('Touche inconnue.')
    args.push('-Touche', g.touche)
  }
  if (g.molette !== undefined) {
    if (!Number.isInteger(g.molette) || g.molette === 0 || Math.abs(g.molette) > 20)
      throw new Error('Molette invalide.')
    args.push('-Molette', String(g.molette))
  }
  if (g.sansClic === true) args.push('-SansClic')
  if (typeof registre === 'string' && registre) args.push('-Registre', registre)
  return args
}

export type ActionHdesk = {
  instanceId?: string
  x?: number
  y?: number
  cible?: string
  messages?: unknown
}
export type ResultatGeste = { ok: true; action?: ActionHdesk } | { ok: false; message: string }

// hdesk-act.ps1 ecrit son JSON {instanceId,x,y,cible,messages} sur la derniere ligne JSON de stdout.
export function resultatAct(out: string): ResultatGeste {
  const lignes = String(out || '')
    .split(/\r?\n/)
    .reverse()
  for (const l of lignes) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try {
      return { ok: true, action: JSON.parse(t) as ActionHdesk }
    } catch {
      /* ligne non JSON : on continue */
    }
  }
  return { ok: true }
}

export function agirHdesk(racine: string, g: GesteTv, registre?: string): Promise<ResultatGeste> {
  let args: string[]
  try {
    args = argumentsAct(racine, g, registre)
  } catch (e) {
    return Promise.resolve({ ok: false, message: (e as Error).message })
  }
  return new Promise((resolve) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 20000 }, (err, out, errOut) => {
      if (err) resolve({ ok: false, message: String(errOut || err.message).trim() })
      else resolve(resultatAct(String(out)))
    })
  })
}

/**
 * BASCULE DE L'ECRAN REEL (conv-35, option) : scripts/hdesk-basculer.ps1 porte lui-meme les trois
 * sorties (fenetre « Revenir », Échap, minuterie). Lance DETACHE : un arret ou un
 * plantage d'Autowin ne doit jamais laisser l'utilisateur sur le bureau cache.
 *
 * PAS DE `spawn(..., { detached: true })` (conv-951, 2026-10-16) : Windows PowerShell 5.1 lance en
 * DETACHED_PROCESS sort en ~0,1 s avec le code 0 SANS executer sa commande (mesure : `-Command "exit 7"`
 * rend 0 detache, 7 attache ; le journal « Windows PowerShell » n'avait jamais vu demarrer
 * hdesk-basculer.ps1). Le bouton rendait pourtant ok d'avance : echec muet. Le script part donc par
 * scripts/lancer-detache.ps1 (Win32_Process.Create via WMI : console cachee, hors du Job d'Autowin,
 * il survit a un plantage de l'app), et l'app ATTEND son verdict dans un fichier d'etat (-Statut).
 */
export const BASCULE_MAX_SECONDES = 120
/** Lancement WMI + compilation du C# du script + attente de sa fenetre « Revenir » (15 s max cote script). */
export const BASCULE_ATTENTE_MS = 30_000
const BASCULE_SONDE_MS = 200

/**
 * FERMER L'APP D'UN BUREAU CACHE (conv-222, lot 1 du RUN outils-agent-1-2-4-6-7) : scripts/hdesk-fermer.ps1
 * ferme PAR BUREAU, jamais par nom, et refuse le bureau d'une autre conversation. Codes du script :
 * 0 ferme / deja ferme · 1 entree invalide · 2 aucun bureau a ce nom · 5 autre conversation · 6 survivants.
 */
export type DemandeFermeture = {
  id: string
  /** Attente de la fermeture douce (WM_CLOSE) avant l'arret force, 1 a 30 s. Defaut du script : 5. */
  delaiDouxSecondes?: number
} & (
  | { conversationId: string; sansFiche?: false }
  /**
   * BUREAU SANS FICHE (conv-344) : `-SansFiche` du script, reserve a la vue « Bureaux caches », sur le
   * geste de l'utilisateur. Jamais de fil : le script refuse ce mode des qu'une fiche existe.
   * L'outil agent `bureau_cache_fermer` ne construit jamais cette forme.
   */
  | { sansFiche: true; conversationId?: undefined }
)

export interface ResultatFermeture {
  /** Le script a rendu 0 : plus rien ne vit dans ce bureau (ou rien n'y vivait deja). */
  ok: boolean
  code: number | null
  id?: string
  ferme?: boolean
  dejaFerme?: boolean
  fermesDoucement?: number[]
  forces?: number[]
  survivants?: number[]
  epargnes?: Array<{ pid: number; motif: string }>
  ficheRetiree?: boolean
  /** Le script a ferme en mode « sans fiche ». */
  sansFiche?: boolean
  conversationOccupante?: string
  erreur?: string
}

/** Arguments PowerShell de la fermeture ; leve si une entree est invalide (rien n'est lance). */
export function argumentsFermer(racine: string, d: DemandeFermeture): string[] {
  if (typeof d?.id !== 'string' || !ID_BUREAU.test(d.id))
    throw new Error('Identifiant de bureau invalide.')
  const sansFiche = d.sansFiche === true
  if (sansFiche && d.conversationId !== undefined)
    throw new Error(
      'Fermeture sans fiche : aucun fil ne doit etre passe (le script le refuserait).'
    )
  if (!sansFiche && (typeof d.conversationId !== 'string' || !ID_BUREAU.test(d.conversationId)))
    throw new Error('Conversation invalide : impossible de savoir quels bureaux sont les tiens.')
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(racine, 'scripts', 'hdesk-fermer.ps1'),
    '-Id',
    d.id,
    ...(sansFiche ? ['-SansFiche'] : ['-Conversation', d.conversationId as string])
  ]
  if (d.delaiDouxSecondes !== undefined) {
    if (
      !Number.isInteger(d.delaiDouxSecondes) ||
      d.delaiDouxSecondes < 1 ||
      d.delaiDouxSecondes > 30
    )
      throw new Error('Delai doux invalide : un entier de 1 a 30 secondes.')
    args.push('-DelaiDouxSecondes', String(d.delaiDouxSecondes))
  }
  return args
}

/** Lit la DERNIERE ligne JSON de la sortie du script ; le code de sortie fait foi pour `ok`. */
export function resultatFermeture(out: string, code: number | null): ResultatFermeture {
  for (const l of String(out || '')
    .split(/\r?\n/)
    .reverse()) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try {
      return { ...(JSON.parse(t) as Omit<ResultatFermeture, 'ok' | 'code'>), ok: code === 0, code }
    } catch {
      /* ligne non JSON : on continue */
    }
  }
  return {
    ok: false,
    code,
    erreur: `hdesk-fermer.ps1 n'a rendu aucun resultat lisible (code ${code}).`
  }
}

export function fermerHdesk(racine: string, d: DemandeFermeture): Promise<ResultatFermeture> {
  let args: string[]
  try {
    args = argumentsFermer(racine, d)
  } catch (e) {
    return Promise.resolve({ ok: false, code: null, erreur: (e as Error).message })
  }
  return new Promise((resolve) => {
    // 60 s : delai doux (30 s max) + arret force (3 s) + enumeration des processus, avec marge.
    execFile('powershell.exe', args, { windowsHide: true, timeout: 60_000 }, (err, out) => {
      const code = err
        ? typeof (err as { code?: unknown }).code === 'number'
          ? (err as { code: number }).code
          : null
        : 0
      resolve(resultatFermeture(String(out), code))
    })
  })
}

/**
 * Fermeture de FIN DE RUN (dependance `fermerBureauCache` de l'orchestrateur) : PowerShell n'est lance
 * que si le bureau a une fiche au registre. La plupart des runs n'ouvrent aucune app ; lancer un
 * PowerShell par run pour lire « aucun bureau a ce nom » (code 2) serait du bruit. `undefined` = rien
 * a fermer.
 */
export function fermerBureauCacheSiOuvert(
  racine: string,
  d: DemandeFermeture,
  registre = join(process.env.LOCALAPPDATA ?? tmpdir(), 'autowin-hdesk'),
  fermer: (racine: string, d: DemandeFermeture) => Promise<ResultatFermeture> = fermerHdesk
): Promise<ResultatFermeture | undefined> {
  if (typeof d?.id !== 'string' || !ID_BUREAU.test(d.id)) return Promise.resolve(undefined)
  if (!existsSync(join(registre, `${d.id}.json`))) return Promise.resolve(undefined)
  return fermer(racine, d)
}

export function argumentsBascule(
  racine: string,
  id: string,
  maxSecondes = BASCULE_MAX_SECONDES
): string[] {
  if (typeof id !== 'string' || !ID_BUREAU.test(id))
    throw new Error('Identifiant de bureau invalide.')
  const max = Math.min(600, Math.max(5, Math.round(Number(maxSecondes) || BASCULE_MAX_SECONDES)))
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(racine, 'scripts', 'hdesk-basculer.ps1'),
    '-InstanceId',
    id,
    '-MaxSecondes',
    String(max)
  ]
}

export type ResultatBascule = { ok: true } | { ok: false; message: string }

/** Ce que la bascule demande au systeme ; injectable pour les tests. */
export interface DependancesBascule {
  /** Lance powershell.exe (attache, fenetre cachee) et rend son code et sa sortie standard. */
  executer: (args: string[]) => Promise<{ code: number | null; sortie: string }>
  /** Contenu du fichier d'etat, ou null tant qu'il n'existe pas. */
  lire: (chemin: string) => string | null
  supprimer: (chemin: string) => void
  attendre: (ms: number) => Promise<void>
  maintenant: () => number
  fichierStatut: (id: string) => string
}

export function dependancesBascule(): DependancesBascule {
  return {
    executer: (args) =>
      new Promise((resolve) => {
        execFile('powershell.exe', args, { windowsHide: true, timeout: 30_000 }, (err, out) => {
          const code = err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as { code: number }).code
              : null
            : 0
          resolve({ code, sortie: String(out ?? '') })
        })
      }),
    lire: (chemin) => {
      if (!existsSync(chemin)) return null
      try {
        return readFileSync(chemin, 'utf8')
      } catch {
        // Fichier tenu a l'instant par le script qui l'ecrit : la sonde suivante (200 ms) le relira,
        // et l'attente reste bornee par BASCULE_ATTENTE_MS.
        return null
      }
    },
    supprimer: (chemin) => rmSync(chemin, { force: true }),
    attendre: (ms) => new Promise((r) => setTimeout(r, ms)),
    maintenant: () => Date.now(),
    fichierStatut: (id) => join(tmpdir(), `autowin-bascule-${id}-${process.pid}-${Date.now()}.json`)
  }
}

/** Ligne de commande Windows : un argument vide ou a espace est entoure de guillemets (un chemin Windows n'en contient jamais). */
function ligneDeCommande(exe: string, args: readonly string[]): string {
  return [exe, ...args].map((a) => (a === '' || /\s/.test(a) ? `"${a}"` : a)).join(' ')
}

const chainePowerShell = (s: string): string => `'${s.replace(/'/g, "''")}'`

/**
 * Arguments PowerShell qui font lancer hdesk-basculer.ps1 par lancer-detache.ps1. -EncodedCommand :
 * aucun guillemet imbrique n'a a survivre a deux lignes de commande successives. Leve si l'id est invalide.
 */
export function argumentsLancementBascule(
  racine: string,
  id: string,
  statut: string,
  maxSecondes = BASCULE_MAX_SECONDES
): string[] {
  const commande = ligneDeCommande('powershell.exe', [
    ...argumentsBascule(racine, id, maxSecondes),
    '-Statut',
    statut
  ])
  const ps =
    `& ${chainePowerShell(join(racine, 'scripts', 'lancer-detache.ps1'))}` +
    ` -Commande ${chainePowerShell(commande)} -Dossier ${chainePowerShell(racine)}`
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(ps, 'utf16le').toString('base64')
  ]
}

/** Derniere ligne JSON d'une sortie PowerShell, ou null. */
function derniereLigneJson(sortie: string): Record<string, unknown> | null {
  for (const l of sortie.split(/\r?\n/).reverse()) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try {
      return JSON.parse(t) as Record<string, unknown>
    } catch {
      /* ligne non JSON : on continue */
    }
  }
  return null
}

/** Verdict du fichier d'etat ; null tant qu'il est absent ou en cours d'ecriture (JSON incomplet). */
function verdictBascule(texte: string | null): ResultatBascule | null {
  // Un BOM eventuel tombe avec le trim() de chaque ligne (U+FEFF est un blanc pour JavaScript).
  const j = texte ? derniereLigneJson(texte) : null
  if (j?.etat === 'bascule') return { ok: true }
  if (j?.etat === 'erreur') {
    const message =
      typeof j.message === 'string' && j.message.trim() ? j.message.trim() : 'erreur sans message.'
    return { ok: false, message }
  }
  return null
}

/**
 * Bascule l'ecran reel sur le bureau cache `id` et ne rend { ok: true } qu'une fois l'ecran REELLEMENT
 * bascule ; sinon le message d'erreur du script (affiche par la TV : « Bascule refusée : … »).
 */
export async function basculerHdesk(
  racine: string,
  id: string,
  deps: DependancesBascule = dependancesBascule(),
  attenteMs = BASCULE_ATTENTE_MS
): Promise<ResultatBascule> {
  let statut: string
  let args: string[]
  try {
    argumentsBascule(racine, id)
    statut = deps.fichierStatut(id)
    args = argumentsLancementBascule(racine, id, statut)
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
  deps.supprimer(statut)
  const lancement = await deps.executer(args)
  const lance = derniereLigneJson(lancement.sortie)
  if (typeof lance?.pid !== 'number') {
    const cause =
      typeof lance?.erreur === 'string'
        ? lance.erreur
        : `lancer-detache.ps1 a rendu le code ${lancement.code}`
    return { ok: false, message: `le script de bascule n'a pas pu être lancé (${cause}).` }
  }
  const fin = deps.maintenant() + attenteMs
  for (;;) {
    const verdict = verdictBascule(deps.lire(statut))
    if (verdict) {
      deps.supprimer(statut)
      return verdict
    }
    if (deps.maintenant() >= fin) break
    await deps.attendre(BASCULE_SONDE_MS)
  }
  deps.supprimer(statut)
  return {
    ok: false,
    message: `le script de bascule (processus ${lance.pid}) n'a donné aucune nouvelle en ${Math.round(attenteMs / 1000)} s.`
  }
}
