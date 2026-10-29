import { describe, expect, it } from 'vitest'
import { effortParDefautDeLEtape, type ReasoningEffort } from './roles'

/** La liste que le CLI Claude accepte (`models.ts`, CLAUDE_EFFORTS). */
const CLAUDE: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

describe("effortParDefautDeLEtape — l'effort d'une étape quand l'utilisateur n'a rien réglé pour elle", () => {
  it('table complète pour un réglage xhigh, sur les 3 niveaux de difficulté', () => {
    const table = (difficulte: 'critical' | 'standard' | 'trivial'): Record<string, string> =>
      Object.fromEntries(
        ['build', 'git', 'scout', 'frame', 'terrain', 'clean', 'think', 'learn'].map(
          (etape) => [etape, effortParDefautDeLEtape(etape, difficulte, 'xhigh', CLAUDE) ?? '—']
        )
      )
    expect(table('critical')).toEqual({
      build: 'xhigh',
      git: 'xhigh',
      scout: 'xhigh',
      frame: 'xhigh',
      terrain: 'xhigh',
      clean: 'high',
      think: 'high',
      learn: 'high'
    })
    expect(table('standard')).toEqual({
      build: 'xhigh',
      git: 'xhigh',
      scout: 'high',
      frame: 'high',
      terrain: 'high',
      clean: 'medium',
      think: 'medium',
      learn: 'medium'
    })
    expect(table('trivial')).toEqual({
      build: 'xhigh',
      git: 'xhigh',
      scout: 'medium',
      frame: 'medium',
      terrain: 'medium',
      clean: 'low',
      think: 'low',
      learn: 'low'
    })
  })

  it("pas de réglage d'effort sur le rôle → rien n'est calculé", () => {
    expect(effortParDefautDeLEtape('clean', 'standard', undefined, CLAUDE)).toBeUndefined()
  })

  it('liste du modèle absente ou vide → le réglage repart tel quel', () => {
    expect(effortParDefautDeLEtape('clean', 'standard', 'xhigh', undefined)).toBe('xhigh')
    expect(effortParDefautDeLEtape('clean', 'standard', 'xhigh', [])).toBe('xhigh')
  })

  it('réglage absent de la liste du modèle → tel quel, aucune valeur inventée', () => {
    expect(effortParDefautDeLEtape('clean', 'standard', 'ultra', CLAUDE)).toBe('ultra')
  })

  it('plancher = le plus bas effort DE LA LISTE DU MODÈLE, jamais minimal ni none', () => {
    // xhigh −3 sur Claude : low, pas minimal (que le CLI retirerait sans bruit).
    expect(effortParDefautDeLEtape('learn', 'trivial', 'high', CLAUDE)).toBe('low')
    expect(effortParDefautDeLEtape('learn', 'trivial', 'low', CLAUDE)).toBe('low')
    // Un modèle qui déclare plus bas peut y descendre — c'est sa liste qui borne.
    expect(
      effortParDefautDeLEtape('learn', 'trivial', 'medium', ['minimal', 'low', 'medium', 'high'])
    ).toBe('minimal')
  })

  it('plafond = le réglage : une demande difficile ne monte jamais au-dessus', () => {
    expect(effortParDefautDeLEtape('scout', 'critical', 'xhigh', CLAUDE)).toBe('xhigh')
    expect(effortParDefautDeLEtape('build', 'critical', 'high', CLAUDE)).toBe('high')
    expect(effortParDefautDeLEtape('build', 'critical', 'xhigh', CLAUDE)).not.toBe('max')
  })

  it('build et git ne sont jamais baissés, même sur une demande triviale', () => {
    expect(effortParDefautDeLEtape('build', 'trivial', 'xhigh', CLAUDE)).toBe('xhigh')
    expect(effortParDefautDeLEtape('git', 'trivial', 'xhigh', CLAUDE)).toBe('xhigh')
  })

  it('étape inconnue, juge, kaizen, remake → effort inchangé', () => {
    for (const etape of [
      'judge',
      'kaizen',
      'remake',
      'ma-skill-libre',
      'constructor',
      '__proto__'
    ]) {
      expect(effortParDefautDeLEtape(etape, 'trivial', 'xhigh', CLAUDE)).toBe('xhigh')
    }
  })

  it("l'ordre de la liste fournie par le modèle ne change rien", () => {
    expect(effortParDefautDeLEtape('clean', 'standard', 'xhigh', [...CLAUDE].reverse())).toBe(
      'medium'
    )
  })

  it('mêmes entrées deux fois → même effort (une reprise de run retombe sur la même valeur)', () => {
    const a = effortParDefautDeLEtape('frame', 'standard', 'xhigh', CLAUDE)
    const b = effortParDefautDeLEtape('frame', 'standard', 'xhigh', CLAUDE)
    expect(a).toBe(b)
  })
})
