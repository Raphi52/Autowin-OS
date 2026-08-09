import { describe, expect, it } from 'vitest'
import { buildScopeEcho, formatScopeEcho, presumedPhase } from './chat-scope-echo'
import type { MentionSources } from './chat-mentions'

const SOURCES: MentionSources = {
  runs: [{ kind: 'run', id: 'workflow-bench-regression', label: 'wbr', hint: 'bloqué' }],
  files: [{ kind: 'file', id: 'src/a.ts', label: 'a.ts' }]
}

describe('presumedPhase', () => {
  it('reconnaît les verbes dominants', () => {
    expect(presumedPhase('corrige le bug')).toBe('build')
    expect(presumedPhase('explore les pistes')).toBe('scout')
    expect(presumedPhase('vérifie que c’est bon')).toBe('judge')
  })
  it('rend null quand rien ne tranche', () => {
    expect(presumedPhase('bonjour')).toBeNull()
  })
})

describe('buildScopeEcho', () => {
  it('n’affiche rien sur un prompt vide ou neutre', () => {
    expect(buildScopeEcho('   ', SOURCES)).toBeNull()
    expect(buildScopeEcho('bonjour', SOURCES)).toBeNull()
  })

  it('récapitule la phase présumée ET les cibles mentionnées', () => {
    const echo = buildScopeEcho(
      'corrige @fichier:src/a.ts pour @run:workflow-bench-regression',
      SOURCES
    )
    expect(echo).toEqual({
      phase: 'build',
      targets: ['fichier src/a.ts', 'run workflow-bench-regression']
    })
    expect(formatScopeEcho(echo!)).toBe(
      'phase probable : build — cibles : fichier src/a.ts · run workflow-bench-regression'
    )
  })

  it('affiche les cibles seules quand la phase est indéterminable', () => {
    const echo = buildScopeEcho('@run:workflow-bench-regression', SOURCES)
    expect(echo?.phase).toBeNull()
    expect(formatScopeEcho(echo!)).toBe('cibles : run workflow-bench-regression')
  })
})
