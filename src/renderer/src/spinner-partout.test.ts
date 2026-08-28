import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Garde EXHAUSTIVE « le nouveau spinner PARTOUT » : tout libellé d'attente rendu dans le JSX
 * du renderer (« Chargement… », « Lecture… », « … en cours ») doit être accompagné de l'atome
 * `.spinner` de theme.css. Aucune liste fermée : le balayage couvre tout src/renderer.
 * Retirer le libellé ne suffit pas à faire passer — le spinner doit être là quand le libellé l'est.
 */
const SRC = __dirname

const fichiers = (dir: string): string[] => {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...fichiers(p))
    else if (p.endsWith('.tsx') && !p.includes('.test.')) out.push(p)
  }
  return out
}

/** Libellé d'attente rendu à l'écran (texte JSX ou littéral de chaîne affiché). */
const ATTENTE = /(?:Chargement|Lecture)\b[^<>{}\n]{0,60}…|[^<>{}\n]{0,40}en cours…/g
/** Exclusions : libellés d'ERREUR ou d'aria sur un squelette déjà animé. */
const estIndicateur = (ligne: string): boolean =>
  !/impossible|erreur|indisponible|périmé/i.test(ligne) &&
  !ligne.trimStart().startsWith('//') &&
  !ligne.trimStart().startsWith('*') &&
  // Ligne de PARSING (regex sur le markdown), pas un indicateur rendu à l'écran.
  !ligne.includes('RegExp') &&
  !ligne.includes(String.fromCharCode(47) + '^')

const SPINNER = /className="[^"]*\bspinner\b|conv-load-skeleton/

describe('spinner — le nouveau PARTOUT (balayage exhaustif)', () => {
  const cibles = fichiers(SRC)

  it('balaie réellement tout le renderer', () => {
    expect(cibles.length).toBeGreaterThan(50)
  })

  it('tout libellé d’attente est accompagné du spinner', () => {
    const fautifs: string[] = []
    for (const f of cibles) {
      const src = readFileSync(f, 'utf8')
      const lignes = src.split('\n')
      lignes.forEach((ligne, i) => {
        if (!estIndicateur(ligne)) return
        ATTENTE.lastIndex = 0
        if (!ATTENTE.test(ligne)) return
        const debut = src
          .split('\n')
          .slice(Math.max(0, i - 8), i + 3)
          .join('\n')
        if (!SPINNER.test(debut))
          fautifs.push(
            `${relative(SRC, f).split(String.fromCharCode(92)).join('/')}:${i + 1} ${ligne.trim()}`
          )
      })
    }
    expect(fautifs).toEqual([])
  })

  it('aucun ⏳ ne sert d’indicateur d’attente dans le JSX', () => {
    const fautifs: string[] = []
    for (const f of cibles) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((ligne, i) => {
          if (ligne.includes('⏳') && estIndicateur(ligne))
            fautifs.push(
              `${relative(SRC, f).split(String.fromCharCode(92)).join('/')}:${i + 1} ${ligne.trim()}`
            )
        })
    }
    expect(fautifs).toEqual([])
  })
})
