/**
 * OÙ EST LE CLI ? — résolution partagée des trois providers installés par `npm -g`.
 *
 * Les trois adaptateurs (claude, codex, kimi) connaissaient chacun UN seul chemin en dur sous
 * `%APPDATA%\npm`. Hors de ce cas exact — npm prefix configuré, pnpm, volta, install machine — ils
 * échouaient : `spawn claude ENOENT` (repli mort, prouvé le 2026-07-29) ou « Codex CLI introuvable »,
 * qui est précisément l'échec du fan-out scout observé le même jour.
 *
 * On ne peut PAS régler ça avec `shell: true` : les trois spawnent en `shell: false`, et c'est ce qui
 * garantit l'absence d'injection d'arguments et un prompt système à espaces/accents intact. Un shim
 * `.cmd` n'est donc jamais exécutable ici — il faut le VRAI fichier (exe, .js, .mjs).
 *
 * Ce module cherche donc un fichier RELATIF À UN PRÉFIXE npm, dans l'ordre : le préfixe par défaut
 * (`%APPDATA%\npm`, comportement historique préservé), puis chaque dossier du PATH.
 *
 * MAIS le PATH est HÉRITÉ, donc hostile : le fichier élu ici est spawné avec le prompt système et la
 * conversation. Élire n'importe quel `claude.exe` posé dans n'importe quelle entrée de PATH, c'est
 * offrir l'exécution à quiconque écrit dans un dossier du PATH (`C:\tools`, un partage réseau
 * d'entreprise) — ou, pour une entrée RELATIVE, à un simple dépôt cloné. Deux gardes, donc :
 *  1. un candidat non ABSOLU, une racine de volume, le cwd ou `%TEMP%` sont refusés (`npmPrefixCandidates`) ;
 *  2. un binaire posé À PLAT n'est élu que si le dossier porte un `node_modules/` — la signature d'un
 *     vrai préfixe `npm -g` (`findNpmGlobalFile`).
 */
import { existsSync } from 'node:fs'
import { isAbsolute, join, normalize, parse } from 'node:path'

export interface NpmGlobalLookupDeps {
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}

/** Enlève les séparateurs de fin pour comparer deux chemins sans se faire piéger par `\`. */
function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

/** Même dossier ? Insensible à la casse (Windows) et aux séparateurs de fin. */
function isSamePath(a: string, b: string): boolean {
  return (
    trimTrailingSeparators(normalize(a)).toLowerCase() ===
    trimTrailingSeparators(normalize(b)).toLowerCase()
  )
}

/**
 * `child` est-il `parent` lui-même, ou dedans ? Comparaison insensible à la casse (Windows) et aux
 * deux séparateurs — on compare des chemins de confiance, pas des chaînes.
 */
function isSameOrUnder(child: string, parent: string): boolean {
  const a = trimTrailingSeparators(normalize(child)).toLowerCase()
  const b = trimTrailingSeparators(normalize(parent)).toLowerCase()
  if (!b) return false
  return a === b || a.startsWith(`${b}\\`) || a.startsWith(`${b}/`)
}

/**
 * Dossiers dans lesquels on n'élira JAMAIS un CLI, même s'ils sont dans le PATH.
 * Le fichier résolu ici est spawné AVEC le prompt système et le contenu de la conversation : un
 * dossier où n'importe quoi peut atterrir (dossier courant du process, `%TEMP%`) est un vecteur de
 * détournement, pas un préfixe npm.
 */
function untrustedPrefixes(env: NodeJS.ProcessEnv): {
  subtrees: string[]
  exact: string[]
} {
  // `%TEMP%` : les SOUS-dossiers y sont aléatoires et écrivables — tout le sous-arbre est suspect.
  // Le cwd : refusé LUI-MÊME (le cas `.` / `bin` d'une entrée relative). Pas son sous-arbre : un
  // `<repo>\node_modules\.bin` légitimement ajouté au PATH par npm/npx doit rester consultable.
  return {
    subtrees: [env.TEMP, env.TMP].filter((dir): dir is string => Boolean(dir)),
    exact: [process.cwd()]
  }
}

/** Dossiers candidats comme préfixe npm global, du plus attendu au moins. Sans doublon. */
export function npmPrefixCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = []
  const untrusted = untrustedPrefixes(env)
  const push = (dir: string): void => {
    const clean = trimTrailingSeparators(dir.trim().replace(/^"|"$/g, ''))
    if (!clean) return
    // POURQUOI le refus du NON-ABSOLU : une entrée de PATH relative (`.`, `bin`, un `%VAR%` non
    // expansé) se résoudrait depuis le cwd du process — un dépôt cloné contenant un `claude.exe`
    // suffirait alors à faire spawner ce binaire avec tous les prompts. Le PATH est HÉRITÉ, donc
    // pas un PATH de confiance : on n'examine que ce qui est nommable de façon absolue.
    if (!isAbsolute(clean)) return
    const normalized = trimTrailingSeparators(normalize(clean))
    // La RACINE d'un volume (`C:\`) autorise par défaut la création de fichiers aux utilisateurs
    // authentifiés : ce n'est jamais un préfixe npm, c'est une boîte aux lettres ouverte.
    if (normalized === trimTrailingSeparators(parse(normalized).root)) return
    if (untrusted.subtrees.some((bad) => isSameOrUnder(normalized, bad))) return
    if (untrusted.exact.some((bad) => isSamePath(normalized, bad))) return
    if (!candidates.includes(normalized)) candidates.push(normalized)
  }
  // Le prefixe par defaut d'abord : ordre stable, aucune surprise sur un poste deja fonctionnel.
  if (env.APPDATA) push(join(env.APPDATA, 'npm'))
  for (const entry of (env.PATH ?? env.Path ?? '').split(';')) push(entry)
  return candidates
}

/**
 * Cherche `relativePath` (ex. `node_modules/@openai/codex/bin/codex.js`) sous un préfixe npm.
 * `directNames` permet de préférer un exécutable posé À PLAT dans le dossier (ex. `claude.exe`).
 * Rend `undefined` si rien n'existe — l'appelant décide alors quoi dire, honnêtement.
 */
export function findNpmGlobalFile(
  relativePath: string,
  deps: NpmGlobalLookupDeps & { directNames?: readonly string[] } = {}
): string | undefined {
  const env = deps.env ?? process.env
  const exists = deps.exists ?? existsSync
  for (const prefix of npmPrefixCandidates(env)) {
    // POURQUOI cette garde : un exécutable posé À PLAT dans un dossier quelconque du PATH n'est PAS
    // une installation npm — c'est exactement le scénario de détournement (un tiers dépose
    // `claude.exe` dans un dossier du PATH aux ACL laxistes, et l'app le spawne à chaque tour en lui
    // passant le prompt système et la conversation). On n'élit un binaire à plat que si le dossier
    // ressemble VRAIMENT à un préfixe npm, c'est-à-dire s'il porte le `node_modules/` que `npm -g`
    // y crée toujours. Le chemin PAQUETÉ ci-dessous, lui, contient déjà `node_modules/` : son
    // existence prouve la même chose.
    let looksLikeNpmPrefix = false
    try {
      looksLikeNpmPrefix = exists(join(prefix, 'node_modules'))
    } catch {
      // Un dossier du PATH illisible ne doit pas interrompre la recherche.
    }
    if (looksLikeNpmPrefix) {
      for (const name of deps.directNames ?? []) {
        const direct = join(prefix, name)
        try {
          if (exists(direct)) return direct
        } catch {
          /* idem */
        }
      }
    }
    const packaged = join(prefix, relativePath)
    try {
      if (exists(packaged)) return packaged
    } catch {
      /* idem */
    }
  }
  return undefined
}
