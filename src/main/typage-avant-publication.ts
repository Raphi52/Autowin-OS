import { execFile, spawn } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { appliquerLeTour, ouvrirCopieDeBase, type CopieDeBase } from './comparaison-a-la-base'

/**
 * LE TYPAGE DE CE QUI PART, PAS CELUI DE L'ARBRE PARTAGÉ (conv-954, 2026-10-15).
 *
 * LE DÉFAUT, vécu ce jour-là : le commit automatique `9d6bb850` a publié
 * `src/main/raccourci-demarrer-dev.ts`, dont une fonction prenait un nouveau paramètre obligatoire,
 * SANS `src/main/index.ts` qui l'appelle — écarté parce qu'un autre fil y avait aussi des lignes.
 * main ne compilait plus et deux tests y étaient rouges. Le contrôle d'avant publication n'a rien
 * vu : il rejoue les tests DANS L'ARBRE PARTAGÉ, où `index.ts` modifié était toujours là, et il ne
 * joue aucun typage.
 *
 * LA CORRECTION : typer ce qui PART — une copie propre du dernier commit, les fichiers du tour posés
 * dessus (même copie que `comparaison-a-la-base.ts`). Coût mesuré sur ce dépôt : 9 s pour
 * `tsconfig.node.json`, 14 s pour `tsconfig.web.json`, joués seulement pour les projets touchés.
 *
 * UN ROUGE DÉJÀ PRÉSENT NE BLOQUE PAS (même règle que les tests, choix de l'utilisateur conv-246) :
 * si le typage est rouge, il est rejoué sur le dernier commit seul, et seule une erreur NOUVELLE
 * bloque. Une erreur se reconnaît à son fichier, son code et son message, sans ligne ni colonne :
 * une ligne ajoutée plus haut ne la fait pas passer pour nouvelle.
 *
 * Ce que cela NE prouve PAS : le comportement (les tests s'en chargent ensuite), ni les fichiers hors
 * des deux projets TypeScript (scripts `.mjs`, `.cjs`).
 */

export type ProjetTypage = 'node' | 'web'

export const CONFIG_DU_PROJET: Record<ProjetTypage, string> = {
  node: 'tsconfig.node.json',
  web: 'tsconfig.web.json'
}

/**
 * Les projets TypeScript qu'un fichier publié peut casser. `src/shared` n'est inclus par aucun des
 * deux, mais tous deux l'importent ; `src/preload/*.d.ts` est inclus par les deux.
 */
export function projetsTouches(fichiers: readonly string[]): ProjetTypage[] {
  const projets = new Set<ProjetTypage>()
  for (const brut of fichiers) {
    const fichier = brut.split('\\').join('/')
    if (!/\.(ts|tsx|mts|cts)$/.test(fichier)) continue
    if (fichier.startsWith('src/shared/')) {
      projets.add('node')
      projets.add('web')
    } else if (fichier.startsWith('src/renderer/')) projets.add('web')
    else if (fichier.startsWith('src/preload/')) {
      projets.add('node')
      if (fichier.endsWith('.d.ts')) projets.add('web')
    } else if (fichier.startsWith('src/main/') || fichier.startsWith('electron.vite.config.'))
      projets.add('node')
  }
  return (['node', 'web'] as const).filter((projet) => projets.has(projet))
}

/**
 * Les erreurs d'une sortie `tsc --pretty false`, chacune réduite à `fichier: TSxxxx: message` — sans
 * ligne ni colonne. Les lignes de suite (indentées) précisent le message : elles sont ignorées.
 */
export function erreursDeTypage(sortie: string): string[] {
  const erreurs: string[] = []
  for (const ligne of sortie.split(/\r?\n/)) {
    const situee = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(ligne)
    if (situee) {
      erreurs.push(`${situee[1].split('\\').join('/')}: ${situee[2]}: ${situee[3].trim()}`)
      continue
    }
    const globale = /^error (TS\d+): (.*)$/.exec(ligne)
    if (globale) erreurs.push(`${globale[1]}: ${globale[2].trim()}`)
  }
  return erreurs
}

/** Les erreurs d'`apres` absentes d'`avant`, en comptant les doublons (même erreur deux fois). */
export function nouvellesErreurs(apres: readonly string[], avant: readonly string[]): string[] {
  const restantes = new Map<string, number>()
  for (const erreur of avant) restantes.set(erreur, (restantes.get(erreur) ?? 0) + 1)
  const nouvelles: string[] = []
  for (const erreur of apres) {
    const n = restantes.get(erreur) ?? 0
    if (n > 0) restantes.set(erreur, n - 1)
    else nouvelles.push(erreur)
  }
  return nouvelles
}

export interface MesureTypage {
  /** Faux = `tsc` n'a pas pu être lancé (`raison` dit pourquoi). */
  lancee: boolean
  /** `null` = coupé au plafond de temps. */
  exitCode: number | null
  sortie: string
  raison?: string
}

/** Type le projet `projet` dans `racine`. */
export type Typeur = (racine: string, projet: ProjetTypage) => Promise<MesureTypage>

export type TypageAvantPublication =
  /** Aucun fichier publié n'appartient à un projet TypeScript : rien à typer. */
  | { statut: 'sans-objet' }
  | {
      statut: 'vert'
      projets: ProjetTypage[]
      /** Erreurs déjà présentes au dernier commit, toujours là : publié, et le rapport le DIT. */
      dejaRouges?: number
    }
  | { statut: 'echec'; projets: ProjetTypage[]; commande: string; erreurs: string[] }
  | { statut: 'non-verifie'; raison: string }

export function commandeDeTypage(projet: ProjetTypage): string {
  return `tsc --noEmit -p ${CONFIG_DU_PROJET[projet]} --composite false`
}

const PLAFOND_TYPAGE_MS = 5 * 60_000
const SORTIE_MAX = 1_000_000

/**
 * Typeur réel : le `tsc` des modules de la copie (reliés à ceux du dépôt), lancé avec l'exécutable
 * de l'app en mode Node (`ELECTRON_RUN_AS_NODE`), comme `relance-auto-moteur.ts` — aucune dépendance
 * à un `node` présent sur le PATH. `--pretty false` : une erreur par ligne, lisible par
 * `erreursDeTypage`.
 */
export function typeurTsc(executable: string): Typeur {
  return (racine, projet) =>
    new Promise((resolve) => {
      const tsc = join(racine, 'node_modules', 'typescript', 'lib', 'tsc.js')
      if (!existsSync(tsc)) {
        resolve({ lancee: false, exitCode: null, sortie: '', raison: `tsc introuvable : ${tsc}` })
        return
      }
      let sortie = ''
      const enfant = spawn(
        executable,
        [tsc, '--noEmit', '-p', join(racine, CONFIG_DU_PROJET[projet]), '--composite', 'false', '--pretty', 'false'],
        {
          cwd: racine,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      const garder = (morceau: Buffer): void => {
        if (sortie.length < SORTIE_MAX) sortie += morceau.toString()
      }
      enfant.stdout?.on('data', garder)
      enfant.stderr?.on('data', garder)
      let coupe = false
      const delai = setTimeout(() => {
        coupe = true
        enfant.kill()
      }, PLAFOND_TYPAGE_MS)
      delai.unref?.()
      enfant.on('error', (erreur) => {
        clearTimeout(delai)
        resolve({ lancee: false, exitCode: null, sortie, raison: `tsc impossible à lancer : ${erreur.message}` })
      })
      enfant.on('close', (code) => {
        clearTimeout(delai)
        resolve({ lancee: true, exitCode: coupe ? null : (code ?? 1), sortie })
      })
    })
}

const executer = promisify(execFile)

/** Remet dans la copie les fichiers du tour tels qu'au dernier commit (ajoutés par le tour = retirés). */
async function restaurerLaBase(copie: string, fichiers: readonly string[]): Promise<void> {
  for (const fichier of fichiers) {
    const existait = await executer('git', ['cat-file', '-e', `HEAD:${fichier}`], {
      cwd: copie,
      windowsHide: true
    }).then(
      () => true,
      () => false
    )
    if (existait) {
      await executer('git', ['checkout', 'HEAD', '--', fichier], { cwd: copie, windowsHide: true })
    } else if (existsSync(join(copie, fichier))) {
      unlinkSync(join(copie, fichier))
    }
  }
}

export async function typerCeQuiPart(entree: {
  repo: string
  /** Ce que le tour publie : chemins relatifs au dépôt. */
  fichiers: readonly string[]
  typer: Typeur
  ouvrirCopie?: (repo: string) => Promise<CopieDeBase>
  /** Pose les fichiers du tour sur la copie (défaut : `appliquerLeTour`). */
  appliquer?: (repo: string, copie: string, fichiers: readonly string[]) => void
  /** Remet la copie au dernier commit pour ces fichiers (défaut : `git checkout HEAD --`). */
  restaurer?: (copie: string, fichiers: readonly string[]) => Promise<void>
}): Promise<TypageAvantPublication> {
  const projets = projetsTouches(entree.fichiers)
  if (projets.length === 0) return { statut: 'sans-objet' }
  let copie: CopieDeBase
  try {
    copie = await (entree.ouvrirCopie ?? ouvrirCopieDeBase)(entree.repo)
  } catch (erreur) {
    return {
      statut: 'non-verifie',
      raison: `copie propre du dernier commit impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    }
  }
  const nonVerifie = (projet: ProjetTypage, mesure: MesureTypage, ou: string): TypageAvantPublication => ({
    statut: 'non-verifie',
    raison:
      mesure.lancee && mesure.exitCode === null
        ? `${commandeDeTypage(projet)} coupé au plafond de temps (${ou})`
        : (mesure.raison ?? `${commandeDeTypage(projet)} sans erreur lisible, code ${mesure.exitCode} (${ou})`)
  })
  try {
    ;(entree.appliquer ?? appliquerLeTour)(entree.repo, copie.chemin, entree.fichiers)
    const rouges = new Map<ProjetTypage, string[]>()
    for (const projet of projets) {
      const mesure = await entree.typer(copie.chemin, projet)
      if (!mesure.lancee || mesure.exitCode === null) return nonVerifie(projet, mesure, 'avec le tour')
      if (mesure.exitCode === 0) continue
      const erreurs = erreursDeTypage(mesure.sortie)
      // Un code non nul sans erreur lisible : tsc a planté, ce n'est pas un verdict sur le tour.
      if (erreurs.length === 0) return nonVerifie(projet, mesure, 'avec le tour')
      rouges.set(projet, erreurs)
    }
    if (rouges.size === 0) return { statut: 'vert', projets }

    // Rouge avec le tour : la même mesure sur le dernier commit seul départage le tour du déjà-rouge.
    await (entree.restaurer ?? restaurerLaBase)(copie.chemin, entree.fichiers)
    const nouvelles: string[] = []
    const commandes: string[] = []
    let dejaRouges = 0
    for (const [projet, apres] of rouges) {
      const base = await entree.typer(copie.chemin, projet)
      if (!base.lancee || base.exitCode === null) return nonVerifie(projet, base, 'au dernier commit')
      const avant = base.exitCode === 0 ? [] : erreursDeTypage(base.sortie)
      const propres = nouvellesErreurs(apres, avant)
      dejaRouges += apres.length - propres.length
      if (propres.length) {
        nouvelles.push(...propres)
        commandes.push(commandeDeTypage(projet))
      }
    }
    if (nouvelles.length) {
      return { statut: 'echec', projets, commande: commandes.join(' ; '), erreurs: nouvelles }
    }
    return { statut: 'vert', projets, ...(dejaRouges ? { dejaRouges } : {}) }
  } catch (erreur) {
    return {
      statut: 'non-verifie',
      raison: `typage impossible dans la copie : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    }
  } finally {
    await copie.fermer()
  }
}
