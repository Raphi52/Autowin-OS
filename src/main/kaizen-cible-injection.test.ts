import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * VERROU de cohérence entre la target-map de la skill `kaizen` et la réalité de l'injection.
 *
 * Cause ancrée : `src/main/providers/claude.ts` lance le CLI avec `--setting-sources ""` → AUCUN
 * `CLAUDE.md` (utilisateur ou projet) n'est chargé sous Autowin. Une correction de comportement
 * global écrite dans `~/.claude/CLAUDE.md` n'atteint donc JAMAIS l'agent : le défaut revient, et le
 * kaizen suivant le re-trouve. La seule cible globale opérante est `src/main/constitution.ts`.
 *
 * Ce test casse si la skill redevient muette sur ce mécanisme ou réoriente le global vers CLAUDE.md.
 */
const SKILL = readFileSync(
  fileURLToPath(new URL('../../skills/kaizen/SKILL.md', import.meta.url)),
  'utf8'
)
const PROVIDER = readFileSync(
  fileURLToPath(new URL('./providers/claude.ts', import.meta.url)),
  'utf8'
)

describe('kaizen — la cible globale est la source RÉELLEMENT injectée', () => {
  it("garde l'ancre vérifiable du lancement nu du CLI (aucun CLAUDE.md chargé)", () => {
    // Si cette garantie disparaît du provider, la règle de la skill devient fausse : on le saura ici.
    expect(PROVIDER).toContain('--setting-sources ""')
    expect(SKILL).toContain('--setting-sources ""')
    expect(SKILL).toContain('src/main/providers/claude.ts')
  })

  it('route un réflexe GLOBAL sous Autowin vers constitution.ts, pas vers CLAUDE.md', () => {
    const globalAutowin = SKILL.split('\n').find(
      (l) => /\*\*global sous Autowin\*\*/.test(l)
    )
    expect(globalAutowin).toBeDefined()
    expect(globalAutowin).toContain('src/main/constitution.ts')
    expect(globalAutowin).not.toMatch(/CLAUDE\.md/)
  })

  it('ne mentionne CLAUDE.md/CONSTITUTION.md qu’en le réservant aux sessions HORS Autowin', () => {
    expect(SKILL).toContain('global sous Claude Code nu')
    expect(SKILL).toMatch(/hors Autowin/i)
    // La target-map ne doit plus offrir CLAUDE.md comme cible NUE d'un réflexe déclenché.
    const targetMap = SKILL.split('\n').find((l) =>
      l.includes('**un réflexe déclenché / une règle dure**')
    )
    expect(targetMap).toBeDefined()
    expect(targetMap).toContain('src/main/constitution.ts')
    expect(targetMap).toMatch(/sous Autowin/)
  })

  it('nomme la chaîne de précédence du contexte projet (premier trouvé gagne)', () => {
    expect(SKILL).toContain('src/main/context-files.ts')
    expect(SKILL).toMatch(/premier trouvé gagne/i)
  })
})
