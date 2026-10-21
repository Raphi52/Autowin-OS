import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  configureSessionMemoryEcho,
  forgetEcho,
  noteRemembered,
  oublierFaitRetenu,
  rememberedFacts
} from './session-memory-echo'

/**
 * CORRIGER CE QUE L'AGENT A RETENU (conv-1038, 2026-10-21 — « carnet vivant du fil »).
 *
 * La mémoire du fil n'existait que pour l'agent : l'utilisateur ne la voyait pas et ne pouvait pas
 * la corriger. Le carnet la montre ; barrer une ligne doit RETIRER le fait de l'écho, sinon l'agent
 * le relit au tour suivant et la correction ne vaut rien.
 *
 * L'entrée qui ferait échouer une correction fausse : un titre VOISIN (« Décision A bis ») — un
 * retrait par préfixe ou par inclusion l'effacerait avec le fait barré.
 */
beforeEach(() => {
  configureSessionMemoryEcho()
  forgetEcho()
})

describe('oublierFaitRetenu — barrer une ligne de la mémoire du fil', () => {
  it('retire le fait barré, et lui seul : un titre voisin reste', () => {
    noteRemembered('conv-1', { title: 'Décision A', body: 'on part sur A' })
    noteRemembered('conv-1', { title: 'Décision A bis', body: 'variante gardée' })
    expect(oublierFaitRetenu('conv-1', 'Décision A')).toBe(true)
    expect(rememberedFacts('conv-1').map((fait) => fait.title)).toEqual(['Décision A bis'])
  })

  it('n’atteint pas un autre fil qui porte le même titre', () => {
    noteRemembered('conv-1', { title: 'Décision A', body: 'ici' })
    noteRemembered('conv-2', { title: 'Décision A', body: 'là-bas' })
    oublierFaitRetenu('conv-1', 'Décision A')
    expect(rememberedFacts('conv-2').map((fait) => fait.body)).toEqual(['là-bas'])
  })

  it('dit quand il n’y avait rien à retirer', () => {
    noteRemembered('conv-1', { title: 'Décision A', body: 'on part sur A' })
    expect(oublierFaitRetenu('conv-1', 'Inconnu')).toBe(false)
    expect(oublierFaitRetenu('conv-absent', 'Décision A')).toBe(false)
    expect(rememberedFacts('conv-1')).toHaveLength(1)
  })

  it('le retrait survit au redémarrage : le fait barré ne revient pas', () => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-echo-oubli-'))
    const store = join(racine, 'session-memory.json')
    try {
      configureSessionMemoryEcho(store)
      noteRemembered('conv-1', { title: 'Décision A', body: 'périmée' })
      noteRemembered('conv-1', { title: 'Décision B', body: 'valable' })
      oublierFaitRetenu('conv-1', 'Décision A')
      configureSessionMemoryEcho(store)
      expect(rememberedFacts('conv-1').map((fait) => fait.title)).toEqual(['Décision B'])
    } finally {
      configureSessionMemoryEcho()
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
