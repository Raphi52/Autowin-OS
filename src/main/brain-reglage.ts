import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { AUTOWIN_APP_DATA_DIR } from '../shared/app-identity'

/**
 * LE BRAIN CHOISI DANS LES RÉGLAGES (demande utilisateur du 2026-10-13, conv-923).
 *
 * Deux postes, deux formes de Brain : au travail, un simple DOSSIER sur un partage réseau, où Autowin
 * ne doit lancer aucune commande git ; à la maison, un DÉPÔT git. On renseigne donc un chemin et/ou
 * un dépôt :
 *  - chemin seul → simple dossier : Autowin y lit et y dépose, sans jamais committer ;
 *  - dépôt (avec ou sans chemin) → dépôt git : cloné s'il manque, et la clôture des runs y commite
 *    les notes qu'ils ont produites. Sans chemin, il vit dans le dossier local d'Autowin.
 *
 * Avant, la racine ne venait que de variables d'environnement et de `config.json` d'installation, et
 * la clôture d'un run lançait git sur le Brain quel qu'il soit : elle a commité et poussé dans le
 * Brain partagé des notes d'autres conversations (`5089af8`, 2026-10-13).
 *
 * Rangé à côté de la préférence du dossier de travail (`%APPDATA%\autowin-os`). Lu par
 * `brain-paths.ts`, qui n'est importé par aucun de ces modules : pas de dépendance circulaire.
 */
export interface BrainReglage {
  /** Dossier du Brain, chemin complet. */
  chemin?: string
  /** Dépôt git du Brain (adresse ou chemin). Absent : simple dossier, aucune commande git. */
  depot?: string
}

/** `undefined` sans `APPDATA` : un environnement de test qui ne le pose pas ne lit aucun réglage. */
export function brainReglageFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const base = env.APPDATA?.trim()
  return base ? join(base, AUTOWIN_APP_DATA_DIR, 'brain.json') : undefined
}

function texte(valeur: unknown): string | undefined {
  return typeof valeur === 'string' && valeur.trim() ? valeur.trim() : undefined
}

/** Garde un chemin COMPLET seulement : un chemin relatif dépendrait du dossier où l'app a démarré. */
export function normaliserBrainReglage(entree: { chemin?: unknown; depot?: unknown }): BrainReglage {
  const chemin = texte(entree.chemin)
  const depot = texte(entree.depot)
  return {
    ...(chemin && isAbsolute(chemin) ? { chemin: resolve(chemin) } : {}),
    ...(depot ? { depot } : {})
  }
}

/** Le réglage enregistré, ou `{}`. Ne bloque jamais le démarrage : illisible = aucun réglage. */
export function lireBrainReglage(env: NodeJS.ProcessEnv = process.env): BrainReglage {
  const fichier = brainReglageFile(env)
  if (!fichier) return {}
  try {
    return normaliserBrainReglage(JSON.parse(readFileSync(fichier, 'utf8')) as Record<string, unknown>)
  } catch {
    return {}
  }
}

export function effacerBrainReglage(env: NodeJS.ProcessEnv = process.env): void {
  const fichier = brainReglageFile(env)
  if (fichier) rmSync(fichier, { force: true })
}

function ecrireBrainReglage(reglage: BrainReglage, env: NodeJS.ProcessEnv): void {
  const fichier = brainReglageFile(env)
  if (!fichier) throw new Error('Dossier de données introuvable (APPDATA) : réglage non enregistré.')
  if (!reglage.chemin && !reglage.depot) {
    rmSync(fichier, { force: true })
    return
  }
  mkdirSync(dirname(fichier), { recursive: true })
  writeFileSync(fichier, `${JSON.stringify(reglage, null, 2)}\n`, 'utf8')
}

/** `git clone` sans fenêtre ; le dossier parent est créé, le dossier cible doit être absent ou vide. */
export async function clonerDepot(depot: string, dossier: string): Promise<void> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  mkdirSync(dirname(dossier), { recursive: true })
  await promisify(execFile)('git', ['clone', '--', depot, dossier], {
    windowsHide: true,
    timeout: 10 * 60_000
  })
}

/**
 * Enregistre un choix des Réglages, et refuse un Brain inutilisable plutôt que de l'enregistrer :
 * chemin incomplet, dossier introuvable, ou dépôt demandé sur un dossier rempli qui n'en est pas un.
 * Avec un dépôt, un dossier absent ou vide est cloné AVANT l'enregistrement.
 */
export async function appliquerBrainReglage(
  entree: { chemin?: unknown; depot?: unknown },
  deps: {
    /** Dossier du dépôt quand aucun chemin n'est donné (`defaultBrainRoot`). */
    racineParDefaut: string
    env?: NodeJS.ProcessEnv
    cloner?: (depot: string, dossier: string) => Promise<void>
  }
): Promise<BrainReglage> {
  const env = deps.env ?? process.env
  const brut = texte(entree.chemin)
  if (brut && !isAbsolute(brut)) {
    throw new Error(`Chemin incomplet : « ${brut} ». Donne le chemin entier, par exemple D:\\Brain.`)
  }
  const reglage = normaliserBrainReglage(entree)
  if (reglage.depot) {
    const dossier = reglage.chemin ?? deps.racineParDefaut
    const vide = !existsSync(dossier) || readdirSync(dossier).length === 0
    if (vide) {
      await (deps.cloner ?? clonerDepot)(reglage.depot, dossier)
    } else if (!existsSync(join(dossier, '.git'))) {
      throw new Error(
        `${dossier} existe déjà et n'est pas un dépôt git : choisis un dossier vide, ou retire le dépôt.`
      )
    }
  } else if (reglage.chemin && !existsSync(reglage.chemin)) {
    throw new Error(`Dossier introuvable : ${reglage.chemin}`)
  }
  ecrireBrainReglage(reglage, env)
  return reglage
}
