import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { watch, mkdtempSync, readdirSync, readFileSync, rmSync, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

/**
 * RELANCE AUTOMATIQUE DU MOTEUR EN DÉVELOPPEMENT — compiler en coulisse, relancer au repos.
 *
 * L'interface se recharge à chaud (serveur Vite). Le MOTEUR (processus principal + preload), lui,
 * n'est compilé qu'au démarrage : `--watch` a été retiré du script `dev` au commit 447b85d4 parce
 * qu'il relançait Electron à chaque modification, en pleine orchestration (deux runs de
 * l'utilisateur perdus, `conv-1267`). Depuis, chaque modification du moteur attendait un
 * redémarrage à la main — et l'agent finissait ses tours par « redémarre l'app » (conv-918).
 *
 * Ce module garde ce qui était bon dans `--watch` et retire ce qui tuait :
 * 1. il SURVEILLE `src/main`, `src/preload` et `src/shared` (les fichiers de test sont ignorés) ;
 * 2. il RECOMPILE le moteur seul dans un dossier temporaire (~3 s, `electron.vite.config.moteur.ts`)
 *    — `out/` n'est jamais touché, le processus en service le lit encore ;
 * 3. il compare l'EMPREINTE du résultat à celle du moteur chargé : une retouche de commentaire ou
 *    un retour arrière ne change pas le code compilé, donc ne relance rien ;
 * 4. un code qui NE COMPILE PAS ne relance jamais : la relance reconstruirait ce code cassé et
 *    l'app ne reviendrait pas. Le motif est affiché ;
 * 5. il ne relance que quand AUCUN agent ne tourne (aucun tour de chat, aucune orchestration),
 *    après un repos continu, et PRÉVIENT d'abord : un agent qui démarre pendant le préavis annule
 *    la relance, qui attend le repos suivant.
 *
 * Toutes les dépendances sont injectées : la machine à états se teste sans Electron, sans
 * compilation réelle et sans fichier.
 */

export type ResultatCompilation = { ok: true; empreinte: string } | { ok: false; erreur: string }

/**
 * La relance automatique ne vaut que pour l'instance de DÉVELOPPEMENT principale :
 * - jamais en version installée (pas de sources à surveiller) ;
 * - jamais dans une instance de test isolée ou une exécution de tâche programmée : leur relance
 *   passerait par le lanceur du dépôt et ouvrirait une seconde app complète ;
 * - seulement sous le serveur de développement (`ELECTRON_RENDERER_URL`, posé par `electron-vite
 *   dev`) : c'est lui que le lanceur recrée, et lui qui recompile le moteur au démarrage ;
 * - désactivable par `AUTOWIN_RELANCE_AUTO_MOTEUR=0`.
 */
export function relanceAutoMoteurPermise(contexte: {
  isPackaged: boolean
  instanceIsolee: boolean
  executionDeTache: boolean
  env: Readonly<Record<string, string | undefined>>
}): boolean {
  return (
    !contexte.isPackaged &&
    !contexte.instanceIsolee &&
    !contexte.executionDeTache &&
    Boolean(contexte.env['ELECTRON_RENDERER_URL']) &&
    contexte.env['AUTOWIN_RELANCE_AUTO_MOTEUR'] !== '0'
  )
}

export interface DependancesRelanceMoteur {
  /** Arme la surveillance des sources ; rend la fonction qui la coupe. */
  surveiller(surChangement: (chemin: string) => void): () => void
  /** Compile le moteur à part et rend l'empreinte de son code, ou l'erreur de compilation. */
  compiler(): Promise<ResultatCompilation>
  /** Vrai quand aucun agent ne tourne : ni tour de chat, ni orchestration. */
  auRepos(): boolean
  /** Message visible dans l'app (toast). */
  annoncer(texte: string): void
  /** Relance réelle de l'application. Appelée au plus une fois. */
  relancer(cause: string): void
  /**
   * Des sources ont-elles été modifiées APRÈS la compilation du moteur en service, mais avant que la
   * surveillance soit armée ? Si oui, l'empreinte de départ ne décrit pas le code chargé.
   */
  sourcesModifieesDepuisLeDemarrage?(): Promise<boolean>
  journaliser?(ligne: string): void
}

export interface ReglagesRelanceMoteur {
  /** Calme demandé après la dernière modification avant de compiler (rafales d'édition). */
  attenteApresModificationMs: number
  /** Fréquence de la vérification du repos. */
  intervalleVerificationMs: number
  /** Repos continu exigé avant d'annoncer la relance (un tour de reprise peut suivre de près). */
  reposMinimalMs: number
  /** Délai entre l'annonce et la relance : le temps de voir le message. */
  preavisMs: number
}

export const REGLAGES_RELANCE_MOTEUR: ReglagesRelanceMoteur = {
  attenteApresModificationMs: 3_000,
  intervalleVerificationMs: 5_000,
  reposMinimalMs: 15_000,
  preavisMs: 30_000
}

/** Un fichier de test n'entre pas dans le moteur compilé : sa modification ne mérite pas une compilation. */
const FICHIER_SANS_EFFET =
  /(^|[\\/])(__tests__|__snapshots__)([\\/]|$)|\.(test|spec)\.[cm]?[jt]sx?$/

export function changementSansEffetSurLeMoteur(chemin: string): boolean {
  return FICHIER_SANS_EFFET.test(chemin)
}

/** Première ligne utile d'une erreur de compilation, pour un toast lisible. */
function resumerErreur(erreur: string): string {
  const ligne =
    erreur
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /error|erreur|failed|cannot|could not|expected|unexpected/i.test(l)) ??
    erreur.trim().split(/\r?\n/)[0] ??
    ''
  return ligne.length > 220 ? `${ligne.slice(0, 220)}…` : ligne || 'motif non rapporté'
}

export interface RelanceMoteurArmee {
  arreter(): void
  /** Pour le diagnostic et les tests. */
  etat(): {
    empreinteChargee: string | null | undefined
    relanceEnAttente: boolean
    preavisEnCours: boolean
  }
}

export function armerRelanceAutoMoteur(
  deps: DependancesRelanceMoteur,
  reglages: ReglagesRelanceMoteur = REGLAGES_RELANCE_MOTEUR
): RelanceMoteurArmee {
  const journal = (ligne: string): void => deps.journaliser?.(ligne)
  /**
   * Empreinte du moteur EN SERVICE. `undefined` : pas encore mesurée. `null` : inconnue (des
   * sources ont bougé pendant la mesure) — toute compilation réussie vaut alors changement.
   */
  let empreinteChargee: string | null | undefined
  let mesureInitialeEnCours = true
  let modifieePendantMesure = false
  let compilationEnCours = false
  let recompilerEnsuite = false
  let relanceEnAttente = false
  let reposDepuis: number | null = null
  let finPreavis: number | null = null
  let derniereErreurAnnoncee = ''
  let arrete = false
  let relancee = false
  let attente: ReturnType<typeof setTimeout> | null = null
  let verification: ReturnType<typeof setInterval> | null = null

  const couperVerification = (): void => {
    if (verification) clearInterval(verification)
    verification = null
    reposDepuis = null
  }

  const annulerRelance = (): void => {
    relanceEnAttente = false
    finPreavis = null
    couperVerification()
  }

  const verifierRepos = (): void => {
    if (arrete || relancee || !relanceEnAttente) return couperVerification()
    // Une modification est en cours de prise en compte : sa compilation décidera.
    if (compilationEnCours || attente) {
      reposDepuis = null
      return
    }
    if (!deps.auRepos()) {
      if (finPreavis !== null) {
        finPreavis = null
        deps.annoncer(
          'Redémarrage reporté : un agent vient de démarrer. Autowin redémarrera quand plus rien ne tournera.'
        )
        journal('préavis annulé : un agent a démarré')
      }
      reposDepuis = null
      return
    }
    const maintenant = Date.now()
    reposDepuis ??= maintenant
    if (finPreavis === null) {
      if (maintenant - reposDepuis < reglages.reposMinimalMs) return
      finPreavis = maintenant + reglages.preavisMs
      const secondes = Math.round(reglages.preavisMs / 1000)
      deps.annoncer(
        `Moteur modifié : Autowin redémarre dans ${secondes} s pour le charger (aucun agent ne tourne). Un message envoyé d'ici là reporte le redémarrage.`
      )
      journal(`préavis de ${secondes} s`)
      return
    }
    if (maintenant < finPreavis) return
    relancee = true
    arreterTout()
    journal('relance : moteur modifié, aucun agent en cours')
    deps.relancer('moteur modifie — relance automatique au repos (aucun agent en cours)')
  }

  const attendreLeRepos = (): void => {
    relanceEnAttente = true
    if (!verification) {
      reposDepuis = null
      verification = setInterval(verifierRepos, reglages.intervalleVerificationMs)
      verification.unref?.()
    }
  }

  const compilerEtDecider = async (): Promise<void> => {
    if (arrete || relancee) return
    if (compilationEnCours) {
      recompilerEnsuite = true
      return
    }
    compilationEnCours = true
    let resultat: ResultatCompilation
    try {
      resultat = await deps.compiler()
    } catch (e) {
      resultat = { ok: false, erreur: e instanceof Error ? e.message : String(e) }
    } finally {
      compilationEnCours = false
    }
    if (arrete || relancee) return
    // Des sources ont bougé PENDANT la compilation : son résultat est déjà périmé.
    if (recompilerEnsuite) {
      recompilerEnsuite = false
      return compilerEtDecider()
    }
    if (!resultat.ok) {
      // Relancer reconstruirait ce code cassé : l'app ne reviendrait pas. On attend la correction.
      annulerRelance()
      const resume = resumerErreur(resultat.erreur)
      journal(`compilation en échec : ${resume}`)
      if (resume !== derniereErreurAnnoncee) {
        derniereErreurAnnoncee = resume
        deps.annoncer(`Le moteur modifié ne compile pas : Autowin ne redémarre pas. ${resume}`)
      }
      return
    }
    derniereErreurAnnoncee = ''
    if (empreinteChargee && resultat.empreinte === empreinteChargee) {
      // Commentaire, test, retour arrière : le code compilé est celui qui tourne déjà.
      annulerRelance()
      journal('modification sans effet sur le code compilé : pas de relance')
      return
    }
    journal(`moteur changé (${resultat.empreinte.slice(0, 12)}) : relance au prochain repos`)
    attendreLeRepos()
  }

  const surChangement = (chemin: string): void => {
    if (arrete || relancee || changementSansEffetSurLeMoteur(chemin)) return
    if (mesureInitialeEnCours) modifieePendantMesure = true
    if (attente) clearTimeout(attente)
    attente = setTimeout(() => {
      attente = null
      void compilerEtDecider()
    }, reglages.attenteApresModificationMs)
    attente.unref?.()
  }

  let couperSurveillance: () => void = () => {}
  const arreterTout = (): void => {
    arrete = true
    if (attente) clearTimeout(attente)
    attente = null
    couperVerification()
    couperSurveillance()
  }

  // La surveillance AVANT la mesure : une modification pendant la mesure n'est pas perdue.
  couperSurveillance = deps.surveiller(surChangement)
  void (async () => {
    let initiale: ResultatCompilation
    let modifieesAvant = false
    try {
      ;[initiale, modifieesAvant] = await Promise.all([
        deps.compiler(),
        deps.sourcesModifieesDepuisLeDemarrage?.() ?? Promise.resolve(false)
      ])
    } catch (e) {
      initiale = { ok: false, erreur: e instanceof Error ? e.message : String(e) }
    }
    mesureInitialeEnCours = false
    if (arrete) return
    // Le moteur en service a compilé au démarrage : une mesure en échec, ou des sources plus
    // récentes que lui, veulent dire que le code chargé n'est plus celui du disque.
    empreinteChargee =
      initiale.ok && !modifieePendantMesure && !modifieesAvant ? initiale.empreinte : null
    journal(
      empreinteChargee
        ? `surveillance armée (moteur ${empreinteChargee.slice(0, 12)})`
        : 'surveillance armée (sources modifiées depuis le démarrage : la prochaine compilation réussie relancera)'
    )
    if (empreinteChargee === null && !attente && !compilationEnCours) {
      // Rien d'autre ne déclencherait la vérification : le changement a eu lieu avant la surveillance.
      void compilerEtDecider()
    }
  })()

  return {
    arreter: arreterTout,
    etat: () => ({
      empreinteChargee,
      relanceEnAttente,
      preavisEnCours: finPreavis !== null
    })
  }
}

// ── Implémentations réelles ──────────────────────────────────────────────────────────────────────

/** Dossiers dont une modification peut changer le moteur. `src/shared` est importé des deux côtés. */
export const DOSSIERS_DU_MOTEUR = ['src/main', 'src/preload', 'src/shared'] as const

export function surveillerSourcesDuMoteur(
  racine: string,
  surChangement: (chemin: string) => void,
  journaliser: (ligne: string) => void = () => {}
): () => void {
  const veilleurs: FSWatcher[] = []
  for (const dossier of DOSSIERS_DU_MOTEUR) {
    try {
      const veilleur = watch(join(racine, dossier), { recursive: true }, (_evenement, fichier) => {
        surChangement(join(dossier, fichier ? fichier.toString() : ''))
      })
      veilleur.on('error', (e) => journaliser(`surveillance ${dossier} : ${e}`))
      veilleurs.push(veilleur)
    } catch (e) {
      journaliser(`surveillance impossible sur ${dossier} : ${e}`)
    }
  }
  return () => {
    for (const veilleur of veilleurs) veilleur.close()
  }
}

/** Empreinte du code compilé : les `.js` seulement (les `.map` portent les commentaires d'origine). */
export function empreinteDuCodeCompile(dossier: string): string {
  const fichiers: string[] = []
  const parcourir = (courant: string): void => {
    for (const entree of readdirSync(courant, { withFileTypes: true })) {
      const chemin = join(courant, entree.name)
      if (entree.isDirectory()) parcourir(chemin)
      else if (entree.name.endsWith('.js')) fichiers.push(chemin)
    }
  }
  parcourir(dossier)
  const hash = createHash('sha1')
  for (const chemin of fichiers
    .map((f) => ({ f, rel: relative(dossier, f).split(sep).join('/') }))
    .sort((a, b) => a.rel.localeCompare(b.rel))) {
    hash.update(chemin.rel).update('\0').update(readFileSync(chemin.f)).update('\0')
  }
  return hash.digest('hex')
}

const COMPILATION_MAX_MS = 120_000
const SORTIE_MAX = 4_000

/**
 * Compile le moteur seul avec le MÊME outil que `npm run dev` (electron-vite), dans un dossier
 * temporaire supprimé ensuite. Lancé avec l'exécutable de l'app en mode Node
 * (`ELECTRON_RUN_AS_NODE`) : aucune dépendance à un `node` présent sur le PATH.
 */
export function compilerLeMoteur(racine: string, executable: string): Promise<ResultatCompilation> {
  return new Promise((resolve) => {
    let sortie = ''
    let dossier = ''
    try {
      dossier = mkdtempSync(join(tmpdir(), 'autowin-moteur-'))
    } catch (e) {
      resolve({ ok: false, erreur: `dossier temporaire impossible : ${e}` })
      return
    }
    const nettoyer = (): void => {
      try {
        rmSync(dossier, { recursive: true, force: true })
      } catch {
        /* dossier temporaire : le système le videra */
      }
    }
    const enfant = spawn(
      executable,
      [
        join(racine, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
        'build',
        '-c',
        join(racine, 'electron.vite.config.moteur.ts'),
        '--outDir',
        dossier,
        '--logLevel',
        'error'
      ],
      {
        cwd: racine,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    const garder = (morceau: Buffer): void => {
      sortie = (sortie + morceau.toString()).slice(-SORTIE_MAX)
    }
    enfant.stdout?.on('data', garder)
    enfant.stderr?.on('data', garder)
    const delai = setTimeout(() => enfant.kill(), COMPILATION_MAX_MS)
    delai.unref?.()
    enfant.on('error', (e) => {
      clearTimeout(delai)
      nettoyer()
      resolve({ ok: false, erreur: `compilation impossible à lancer : ${e.message}` })
    })
    enfant.on('close', (code, signal) => {
      clearTimeout(delai)
      try {
        if (code === 0) {
          resolve({ ok: true, empreinte: empreinteDuCodeCompile(dossier) })
        } else {
          resolve({
            ok: false,
            erreur:
              sortie.trim() ||
              `compilation arrêtée (code ${code ?? '?'}, signal ${signal ?? 'aucun'})`
          })
        }
      } catch (e) {
        resolve({ ok: false, erreur: `empreinte illisible : ${e}` })
      } finally {
        nettoyer()
      }
    })
  })
}

/**
 * Une source du moteur est-elle plus récente que `depuisMs` ? Sert à détecter une modification faite
 * entre la compilation du démarrage et l'armement de la surveillance.
 */
export async function sourcesDuMoteurPlusRecentesQue(
  racine: string,
  depuisMs: number
): Promise<boolean> {
  const parcourir = async (dossier: string): Promise<boolean> => {
    let entrees
    try {
      entrees = await readdir(dossier, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entree of entrees) {
      const chemin = join(dossier, entree.name)
      if (entree.isDirectory()) {
        if (await parcourir(chemin)) return true
      } else if (!changementSansEffetSurLeMoteur(chemin)) {
        try {
          if ((await stat(chemin)).mtimeMs > depuisMs) return true
        } catch {
          /* fichier disparu entre-temps */
        }
      }
    }
    return false
  }
  for (const dossier of DOSSIERS_DU_MOTEUR) {
    if (await parcourir(join(racine, dossier))) return true
  }
  return false
}
