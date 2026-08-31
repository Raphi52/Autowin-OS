import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * DEFAUT VECU (conv-1582, 2026-08-31) : apres cinq hypotheses fausses sur des triangles visibles
 * dans le decor 3D, le chat a ecrit « il faut isoler les meshes dans l'app qui tourne, ce que je ne
 * peux pas faire depuis le chat » puis a lance une orchestration. Faux blocage de capacite :
 * `edit_file` ecrit dans la source rechargee a chaud et `desktop_observe` regarde le rendu — la
 * boucle isoler -> observer -> restaurer etait entierement a portee du chat.
 */
describe('bissection visuelle depuis le chat', () => {
  it('interdit le faux blocage de capacite et impose la boucle isoler/observer/restaurer', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('BISSECTION VISUELLE')
    expect(prompt).toContain('je ne peux pas isoler depuis le chat')
    expect(prompt).toContain("n'orchestre pas")
    expect(prompt).toContain('Restaure TOUT avant ton message final')
    expect(prompt).toContain('relis la liste')
  })
})
