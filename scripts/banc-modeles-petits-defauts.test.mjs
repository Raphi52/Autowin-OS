import { describe, expect, it } from 'vitest'
import {
  DEFAUTS,
  MODELES,
  environnementPropre,
  prompt,
  testsVoisins
} from './banc-modeles-petits-defauts.mjs'

describe('banc-modeles-petits-defauts (conv-1097)', () => {
  it("retire de l'environnement d'un essai la session qui lance le banc, garde la connexion", () => {
    const env = environnementPropre({
      PATH: 'x',
      CLAUDE_EFFORT: 'low',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 's',
      CLAUDE_CONFIG_DIR: 'C:/cfg',
      AUTOWIN_APP_DATA_ROOT: 'D:/donnees'
    })
    // CLAUDE_EFFORT écraserait --effort ; AUTOWIN_* ferait écrire les tests dans les vraies données.
    expect(env).toEqual({ PATH: 'x', CLAUDE_CONFIG_DIR: 'C:/cfg' })
  })

  it('prend le test voisin de chaque fichier de code touché, jamais un test comme code', () => {
    const existe = (f) => ['src/main/a.test.ts', 'src/main/gates/hooks.test.ts'].includes(f)
    expect(
      testsVoisins(
        ['src/main/a.ts', 'src/main/b.ts', 'src/main/gates/hooks.test.ts', 'README.md'],
        existe
      )
    ).toEqual(['src/main/a.test.ts'])
  })

  it('donne au modèle le fichier et le symptôme, jamais le correctif ni le nom du test caché', () => {
    expect(prompt('poids')).toContain('src/main/chat-session-poids.ts')
    expect(prompt('poids')).not.toContain('chat-usage')
    expect(prompt('animation')).not.toContain('ANIMATION_DECLAREE')
    expect(MODELES.map((m) => m.bras)).toEqual(['a', 'b', 'c'])
    expect(Object.keys(DEFAUTS)).toEqual(['poids', 'animation'])
  })
})
