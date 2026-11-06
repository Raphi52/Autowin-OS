import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Les chemins du dépôt et les scripts npm qu'un texte CITE, rejoués contre le dépôt.
 *
 * POURQUOI (scout du 05/11, piste ancien n° 9, conv-1602) : ce contrôle ne vivait que dans
 * `agents-md-faits.test.ts`, donc ne portait que sur AGENTS.md. Or la constitution, la consigne du
 * chat, les consignes d'étape (`phase-briefs.ts`) et les `skills/<nom>/SKILL.md` partent elles aussi
 * aux agents : un chemin renommé ou un script retiré y égare chaque tour, sans qu'aucun test le voie.
 * Sorti ici pour que tous ces textes passent par la même règle (`chemins-cites.test.ts`).
 */

/**
 * Mots des spans entre accents graves (un span peut être une commande : `node scripts/x.mjs --y`).
 *
 * fix-ok: trois nettoyages, causes mesurées le 05/11 sur les textes des agents (conv-1602) :
 *  - les clôtures ``` sont retirées avant l'appariement : la description d'une commande du chat cite
 *    « ```html-render ou ```html-interactif », et leurs accents désappariaient tous les spans suivants
 *    (un span de prose finissait sur « scripts/draft-carrousel.mjs) ») ;
 *  - la ponctuation collée au mot tombe : « (scripts/x.mjs) », « src/main/y.ts, » ;
 *  - un suffixe de ligne tombe : `src/main/juge/objections-juge.ts:30` cite le FICHIER, qui doit exister.
 */
export function motsCites(texte: string): string[] {
  return [...texte.replace(/`{3,}/g, '').matchAll(/`([^`\n]+)`/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .map((mot) =>
      mot
        .replace(/^[("'«]+/, '')
        .replace(/[)"'»,;.:]+$/, '')
        .replace(/:\d+(?:-\d+)?$/, '')
    )
    .filter(Boolean)
}

/**
 * Seuls ces préfixes désignent à coup sûr un chemin du DÉPÔT. Un nom nu (`x.ts`), un chemin de
 * données du poste (`turn-journals/<conv>/…`) ou relatif à un autre dossier (`assets/theme.css`)
 * reste hors contrôle : il ne dit pas où il vit.
 */
const PREFIXES_DU_DEPOT = /^(src|scripts|skills|\.githooks)\//

/** Les chemins du dépôt cités, placeholders compris (`skills/<nom>/SKILL.md`, `skills/*\/SKILL.md`). */
export function cheminsCites(texte: string): string[] {
  const mots = motsCites(texte).filter((m) => PREFIXES_DU_DEPOT.test(m) || m === '.gitignore')
  return [...new Set(mots)]
}

/** Un segment `<nom>` ou `*` vaut n'importe quelle entrée du dossier. */
export function existeAvecMotif(segments: string[], base: string): boolean {
  if (segments.length === 0) return existsSync(base)
  const [tete, ...reste] = segments
  if (tete === '') return existeAvecMotif(reste, base)
  if (/[<*]/.test(tete)) {
    if (!existsSync(base) || !statSync(base).isDirectory()) return false
    return readdirSync(base).some((entree) => existeAvecMotif(reste, join(base, entree)))
  }
  return existeAvecMotif(reste, join(base, tete))
}

/** Les scripts cités sous la forme `npm run X` (un span entier entre accents graves). */
export function scriptsNpmCites(texte: string): string[] {
  return [...new Set([...texte.matchAll(/`npm run ([\w:-]+)`/g)].map((m) => m[1]))]
}

/**
 * Ce que `texte` cite et qui n'existe pas : un chemin absent de `racine`, un `npm run X` absent de
 * `scripts` (le bloc `scripts` de package.json). Vide = rien de cassé.
 */
export function citationsCassees(
  texte: string,
  racine: string,
  scripts: Readonly<Record<string, string>>
): string[] {
  const chemins = cheminsCites(texte)
    .filter((c) => !existeAvecMotif(c.split('/'), racine))
    .map((c) => `chemin absent : ${c}`)
  const npm = scriptsNpmCites(texte)
    .filter((nom) => !Object.hasOwn(scripts, nom))
    .map((nom) => `script npm absent : npm run ${nom}`)
  return [...chemins, ...npm]
}
