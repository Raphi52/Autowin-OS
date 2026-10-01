/**
 * SCRIPTS D'UNE COPIE DE TRAVAIL — la partie qui touche le disque et les processus.
 *
 * Voir `shared/scripts-copie.ts` pour la déclaration (`.autowin/scripts.json`) et ce qui va au-delà
 * de Conductor. Ici :
 * - `lireScriptsCopie` : trouve la déclaration d'un dossier (Autowin, sinon Conductor, sinon le
 *   lancement détecté dans `package.json`) ;
 * - `preparerCopie` : copie les fichiers locaux déclarés puis joue la préparation, avec un délai ;
 *   appelée par le coordinateur juste APRÈS la création d'une copie d'agent (hors du Worker git,
 *   dont le délai de ~34 s couperait un `npm ci`) ;
 * - `LancementsParDossier` : le bouton « Lancer » — un processus long par conversation, sa sortie,
 *   son adresse locale, et un arrêt qui emporte tout l'ARBRE de processus qu'il a créé, et lui seul.
 *
 * Aucune fonction ici ne jette vers son appelant : une préparation ratée est RAPPORTÉE (code de
 * sortie, dernières lignes), jamais une panne de la création de la copie.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve, sep } from 'node:path'
import {
  adresseLocale,
  blocSuivant,
  CONFIG_AUTOWIN,
  CONFIG_CONDUCTOR,
  developperVariables,
  lancementDetecte,
  lireConfigAutowin,
  lireConfigConductor,
  portDeBase,
  sansCodesCouleur,
  variablesDeCopie,
  type EtatLancement,
  type ScriptsCopie
} from '../shared/scripts-copie'

export type { EtatLancement }

export interface ScriptsLus {
  scripts?: ScriptsCopie
  /** Déclaration présente mais invalide : à MONTRER, jamais à ignorer. */
  erreur?: string
}

async function lireSiPresent(chemin: string): Promise<string | undefined> {
  try {
    return await readFile(chemin, 'utf8')
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw erreur
  }
}

/** La déclaration d'un dossier : Autowin d'abord, puis Conductor, puis `package.json` (lancement seul). */
export async function lireScriptsCopie(dossier: string): Promise<ScriptsLus> {
  try {
    const autowin = await lireSiPresent(join(dossier, CONFIG_AUTOWIN))
    if (autowin !== undefined) {
      const lu = lireConfigAutowin(autowin)
      return lu.ok ? { scripts: lu.scripts } : { erreur: lu.erreur }
    }
    const conductor = await lireSiPresent(join(dossier, CONFIG_CONDUCTOR))
    const deConductor = conductor !== undefined ? lireConfigConductor(conductor) : null
    if (deConductor) return { scripts: deConductor }
    const pkg = await lireSiPresent(join(dossier, 'package.json'))
    const detecte = pkg !== undefined ? lancementDetecte(pkg) : null
    return detecte ? { scripts: detecte } : {}
  } catch (erreur) {
    return { erreur: `lecture des scripts impossible : ${(erreur as Error).message}` }
  }
}

/** Vrai si personne n'écoute sur ce port local. */
export function portEstLibre(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const serveur = createServer()
    serveur.once('error', () => ok(false))
    serveur.listen(port, '127.0.0.1', () => serveur.close(() => ok(true)))
  })
}

/** Le premier bloc de ports libre à partir du bloc propre à `nom` (20 blocs essayés au plus). */
export async function choisirPort(
  nom: string,
  estLibre: (port: number) => Promise<boolean> = portEstLibre
): Promise<number> {
  const depart = portDeBase(nom)
  let port = depart
  for (let essai = 0; essai < 20; essai++) {
    if (await estLibre(port)) return port
    port = blocSuivant(port)
  }
  return depart
}

/**
 * L'environnement d'un script : celui de l'utilisateur, MOINS les variables propres à l'app.
 * `ELECTRON_*` d'abord : `ELECTRON_RENDERER_URL` ferait charger l'interface d'Autowin à un projet
 * electron-vite, `ELECTRON_RUN_AS_NODE` transformerait son Electron en simple Node. `AUTOWIN_*`
 * ensuite : seules NOS valeurs pour cette copie doivent arriver.
 */
export function environnementDeScript(
  variables: Record<string, string>,
  base: Readonly<NodeJS.ProcessEnv> = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [cle, valeur] of Object.entries(base)) {
    if (valeur === undefined || /^(ELECTRON_|AUTOWIN_)/i.test(cle)) continue
    env[cle] = valeur
  }
  return { ...env, ...variables }
}

/** Taille gardée de la sortie : la FIN, qui porte l'erreur ou l'adresse du serveur. */
const SORTIE_MAX = 16_000

export interface ProcessusLance {
  pid?: number
  fin: Promise<{ code: number | null; signal: NodeJS.Signals | null; erreur?: string }>
  sortie: () => string
  arreter: () => Promise<void>
}

/** Arrête le processus ET ses enfants (un `npm run dev` lance node, qui lance vite…), eux seuls. */
export function arreterArbre(enfant: ChildProcess): Promise<void> {
  const pid = enfant.pid
  if (!pid || enfant.exitCode !== null || enfant.signalCode !== null) return Promise.resolve()
  if (process.platform === 'win32') {
    return new Promise((ok) => {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => ok())
    })
  }
  return new Promise((ok) => {
    const tuer = (signal: NodeJS.Signals): void => {
      try {
        process.kill(-pid, signal)
      } catch {
        // Groupe déjà terminé.
      }
    }
    tuer('SIGTERM')
    const force = setTimeout(() => tuer('SIGKILL'), 5_000)
    enfant.once('exit', () => {
      clearTimeout(force)
      ok()
    })
  })
}

/** Lance une ligne de commande dans un shell, sortie gardée en mémoire bornée. */
export function lancerCommande(
  commande: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; surSortie?: (morceau: string) => void }
): ProcessusLance {
  let sortie = ''
  const enfant = spawn(commande, {
    cwd: options.cwd,
    env: options.env,
    shell: true,
    windowsHide: true,
    // Hors Windows, un groupe de processus à part : c'est ce qui permet d'arrêter l'arbre entier.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const recevoir = (morceau: Buffer): void => {
    const texte = morceau.toString('utf8')
    sortie = (sortie + texte).slice(-SORTIE_MAX)
    options.surSortie?.(texte)
  }
  enfant.stdout?.on('data', recevoir)
  enfant.stderr?.on('data', recevoir)
  const fin = new Promise<{ code: number | null; signal: NodeJS.Signals | null; erreur?: string }>(
    (ok) => {
      enfant.once('error', (erreur) => ok({ code: null, signal: null, erreur: erreur.message }))
      enfant.once('close', (code, signal) => ok({ code, signal }))
    }
  )
  return { pid: enfant.pid, fin, sortie: () => sortie, arreter: () => arreterArbre(enfant) }
}

/** Les dernières lignes non vides d'une sortie, sans codes couleur. */
export function dernieresLignes(sortie: string, n: number): string[] {
  return sansCodesCouleur(sortie)
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-n)
}

export const DELAI_PREPARATION_MS = 10 * 60_000

export interface ResultatPreparation {
  /** Une phrase pour la trace du run. */
  resume: string
  ok: boolean
  copies: string[]
  absents: string[]
  commande?: string
  code?: number | null
  dureeMs?: number
  expire?: boolean
  dernieresLignes?: string[]
}

/** Une commande git en asynchrone : jamais sur le fil principal en synchrone, jamais d'exception. */
export function gitAsync(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((ok) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 30_000 }, (erreur, stdout) => {
      const code = erreur ? (typeof erreur.code === 'number' ? erreur.code : 128) : 0
      ok({ code, stdout: String(stdout ?? '') })
    })
  })
}

/** `chemin` reste-t-il sous `racine` une fois résolu ? Dernier rempart après la validation déclarative. */
function sous(racine: string, chemin: string): boolean {
  const r = resolve(racine)
  const c = resolve(racine, chemin)
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep)
}

/**
 * Prépare une copie fraîche : fichiers locaux déclarés, puis la commande de préparation.
 *
 * La déclaration est lue dans le DÉPÔT D'ORIGINE, jamais dans la copie : un agent qui modifie
 * `.autowin/scripts.json` dans sa copie ne change pas ce qui s'exécutera à la création des copies
 * suivantes tant que son travail n'a pas rejoint le dépôt. Un fichier déjà présent dans la copie
 * n'est JAMAIS écrasé. Rend `undefined` quand rien n'est déclaré : aucune ligne de bruit.
 */
export async function preparerCopie(
  copie: { depot: string; chemin: string; nom: string },
  options: {
    delaiMs?: number
    choisirPort?: (nom: string) => Promise<number>
    /** Appelé juste avant de lancer la commande : la trace peut dire « en cours ». */
    auDebut?: (texte: string) => void
  } = {}
): Promise<ResultatPreparation | undefined> {
  const { scripts, erreur } = await lireScriptsCopie(copie.depot)
  if (erreur)
    return {
      ok: false,
      resume: `Préparation de la copie non jouée : ${erreur}`,
      copies: [],
      absents: []
    }
  if (!scripts || scripts.source === 'package.json') return undefined
  if (!scripts.preparation && scripts.copier.length === 0) return undefined

  const copies: string[] = []
  const absents: string[] = []
  const nonIgnores: string[] = []
  for (const relatif of scripts.copier) {
    if (!sous(copie.depot, relatif) || !sous(copie.chemin, relatif)) continue
    const source = join(copie.depot, relatif)
    const destination = join(copie.chemin, relatif)
    try {
      await stat(source)
    } catch {
      absents.push(relatif)
      continue
    }
    /*
     * UN FICHIER COPIÉ NON IGNORÉ PAR GIT PARTIRAIT AVEC LE TRAVAIL DE L'AGENT : la publication
     * commite tout ce que la copie porte. Un `.env` recopié deviendrait un fichier du dépôt. On ne
     * copie donc que ce que git ignore dans la copie (code 1 = « non ignoré » ; hors dépôt git, 128,
     * il n'y a pas de publication à craindre).
     */
    if ((await gitAsync(copie.chemin, ['check-ignore', '-q', '--', relatif])).code === 1) {
      nonIgnores.push(relatif)
      continue
    }
    try {
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source, destination, constants.COPYFILE_EXCL)
      copies.push(relatif)
    } catch (e) {
      // EEXIST : déjà là, on n'écrase pas. Toute autre erreur est rapportée comme un absent.
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') absents.push(relatif)
    }
  }
  const partieFichiers = [
    copies.length ? `${copies.length} fichier(s) copié(s) (${copies.join(', ')})` : '',
    absents.length ? `introuvable(s) dans le dépôt : ${absents.join(', ')}` : '',
    nonIgnores.length
      ? `NON copié(s) car non ignoré(s) par git, ils partiraient avec le travail de l'agent : ${nonIgnores.join(', ')}`
      : ''
  ]
    .filter(Boolean)
    .join(', ')
  const fichiersOk = absents.length === 0 && nonIgnores.length === 0

  if (!scripts.preparation) {
    return {
      ok: fichiersOk,
      resume: `Préparation de la copie : ${partieFichiers}.`,
      copies,
      absents
    }
  }

  const port = await (options.choisirPort ?? choisirPort)(copie.nom)
  const variables = variablesDeCopie({
    depot: copie.depot,
    copie: copie.chemin,
    nom: copie.nom,
    port
  })
  const commande = developperVariables(scripts.preparation, variables)
  options.auDebut?.(`Préparation de la copie en cours : « ${scripts.preparation} »…`)
  const debut = Date.now()
  const processus = lancerCommande(commande, {
    cwd: copie.chemin,
    env: environnementDeScript(variables)
  })
  const delai = options.delaiMs ?? DELAI_PREPARATION_MS
  let expire = false
  let minuterie: ReturnType<typeof setTimeout> | undefined
  const fin = await Promise.race([
    processus.fin,
    new Promise<null>((ok) => {
      minuterie = setTimeout(() => ok(null), delai)
    })
  ])
  if (minuterie) clearTimeout(minuterie)
  if (fin === null) {
    expire = true
    await processus.arreter()
  }
  const dureeMs = Date.now() - debut
  const code = fin === null ? null : fin.code
  const lignes = dernieresLignes(processus.sortie(), 8)
  /*
   * CE QUE LA PRÉPARATION LAISSE DE PUBLIABLE. Une copie fraîche est propre : tout ce que `git
   * status` y voit maintenant vient de la préparation (fichier généré non ignoré, lockfile réécrit)
   * et serait commité avec le travail de l'agent. On ne l'efface pas — c'est peut-être voulu — on
   * le NOMME. Hors dépôt git, le statut échoue et il n'y a rien à dire.
   */
  const statut = expire
    ? { code: 128, stdout: '' }
    : await gitAsync(copie.chemin, ['status', '--porcelain', '--untracked-files=all'])
  const laisses =
    statut.code === 0
      ? statut.stdout
          .split(/\r?\n/)
          .map((l) => l.slice(3).trim())
          .filter(Boolean)
      : []
  const partieLaisses = laisses.length
    ? `ATTENTION : ${laisses.length} fichier(s) laissé(s) par la préparation et non ignoré(s) par git partiront avec le travail de l'agent (${laisses.slice(0, 5).join(', ')}${laisses.length > 5 ? ', …' : ''})`
    : ''
  const ok = !expire && code === 0 && fichiersOk && laisses.length === 0
  const secondes = Math.max(1, Math.round(dureeMs / 1000))
  const verdict = expire
    ? `ARRÊTÉE après ${Math.round(delai / 1000)} s (délai dépassé)`
    : fin?.erreur
      ? `IMPOSSIBLE à lancer : ${fin.erreur}`
      : code === 0
        ? `réussie en ${secondes} s`
        : `ÉCHOUÉE (code ${code ?? 'inconnu'}) en ${secondes} s`
  const derniere = !ok && lignes.length ? ` — dernière ligne : ${lignes[lignes.length - 1]}` : ''
  return {
    ok,
    resume:
      `Préparation de la copie (${scripts.source === 'conductor' ? CONFIG_CONDUCTOR : CONFIG_AUTOWIN}) : ` +
      `« ${scripts.preparation} » ${verdict}${partieFichiers ? `, ${partieFichiers}` : ''}${derniere}` +
      `${partieLaisses ? `. ${partieLaisses}` : ''}.`,
    copies,
    absents,
    commande,
    code,
    dureeMs,
    expire,
    dernieresLignes: lignes
  }
}

interface Entree {
  processus?: ProcessusLance
  etat: EtatLancement
  /** Incrémenté à chaque démarrage : une fin tardive d'un ancien processus ne touche pas le nouveau. */
  generation: number
}

/**
 * Le bouton « Lancer » : UN processus par clé (la conversation), jamais deux. Lancer une seconde
 * fois pendant qu'il tourne ne fait rien ; il faut l'arrêter d'abord.
 */
export class LancementsParDossier {
  private readonly entrees = new Map<string, Entree>()

  constructor(
    private readonly options: {
      notifier?: (cle: string, etat: EtatLancement) => void
      choisirPort?: (nom: string) => Promise<number>
    } = {}
  ) {}

  private publier(cle: string, entree: Entree): EtatLancement {
    const copie = { ...entree.etat, lignes: [...entree.etat.lignes] }
    this.options.notifier?.(cle, copie)
    return copie
  }

  /** L'état courant ; sans lancement passé, la commande que « Lancer » jouerait. */
  async etat(cle: string, dossier: string): Promise<EtatLancement> {
    const entree = this.entrees.get(cle)
    if (entree && entree.etat.statut === 'en-cours') {
      return { ...entree.etat, lignes: [...entree.etat.lignes] }
    }
    const { scripts, erreur } = await lireScriptsCopie(dossier)
    const base = entree?.etat ?? { statut: 'arrete' as const, lignes: [] }
    return {
      ...base,
      lignes: [...base.lignes],
      commande: scripts?.lancement,
      source: scripts?.lancement ? scripts.source : undefined,
      erreur: erreur ?? (base.statut === 'echec' ? base.erreur : undefined)
    }
  }

  async demarrer(cle: string, dossier: string): Promise<EtatLancement> {
    const existante = this.entrees.get(cle)
    if (existante?.etat.statut === 'en-cours') return this.publier(cle, existante)
    const { scripts, erreur } = await lireScriptsCopie(dossier)
    const entree: Entree = {
      etat: { statut: 'arrete', lignes: [] },
      generation: (existante?.generation ?? 0) + 1
    }
    this.entrees.set(cle, entree)
    if (erreur || !scripts?.lancement) {
      entree.etat = {
        statut: 'echec',
        lignes: [],
        erreur: erreur ?? `aucun lancement déclaré (ajoute « lancement » dans ${CONFIG_AUTOWIN})`
      }
      return this.publier(cle, entree)
    }
    const port = await (this.options.choisirPort ?? choisirPort)(cle)
    const variables = variablesDeCopie({ depot: dossier, copie: dossier, nom: cle, port })
    const generation = entree.generation
    let tampon = ''
    let enAttente: ReturnType<typeof setTimeout> | undefined
    const processus = lancerCommande(developperVariables(scripts.lancement, variables), {
      cwd: dossier,
      env: environnementDeScript(variables),
      surSortie: (morceau) => {
        if (entree.generation !== generation) return
        tampon = (tampon + morceau).slice(-SORTIE_MAX)
        entree.etat.adresse ??= adresseLocale(tampon)
        // Regroupe les rafales de sortie : au plus une mise à jour de l'écran tous les 250 ms.
        if (enAttente) return
        enAttente = setTimeout(() => {
          enAttente = undefined
          if (entree.generation !== generation) return
          entree.etat.lignes = dernieresLignes(tampon, 40)
          this.publier(cle, entree)
        }, 250)
      }
    })
    entree.processus = processus
    entree.etat = {
      statut: 'en-cours',
      commande: scripts.lancement,
      source: scripts.source,
      port,
      lignes: [],
      depuis: Date.now()
    }
    void processus.fin.then((fin) => {
      if (enAttente) clearTimeout(enAttente)
      if (entree.generation !== generation || entree.etat.statut !== 'en-cours') return
      entree.processus = undefined
      entree.etat = {
        ...entree.etat,
        statut: fin.code === 0 ? 'termine' : 'echec',
        code: fin.code,
        erreur: fin.erreur,
        lignes: dernieresLignes(processus.sortie(), 40)
      }
      this.publier(cle, entree)
    })
    return this.publier(cle, entree)
  }

  async arreter(cle: string): Promise<EtatLancement> {
    const entree = this.entrees.get(cle)
    if (!entree) return { statut: 'arrete', lignes: [] }
    const processus = entree.processus
    entree.processus = undefined
    if (entree.etat.statut === 'en-cours') {
      entree.etat = {
        ...entree.etat,
        statut: 'arrete',
        lignes: dernieresLignes(processus?.sortie() ?? '', 40)
      }
    }
    await processus?.arreter()
    return this.publier(cle, entree)
  }

  /** À la fermeture de l'app : n'arrête QUE les processus lancés par ce bouton. */
  async arreterTout(): Promise<void> {
    await Promise.all([...this.entrees.keys()].map((cle) => this.arreter(cle)))
  }
}
