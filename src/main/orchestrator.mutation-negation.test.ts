import { describe, expect, it } from 'vitest'
import { isMutationTask } from './orchestrator'

describe('isMutationTask (J3 — négation)', () => {
  it('ne classe PAS une tâche de cadrage niée comme mutation', () => {
    expect(isMutationTask('produis le cadrage. Ne modifie pas de code applicatif.')).toBe(false)
    expect(isMutationTask("n'ajoute pas de fichier, documente seulement")).toBe(false)
  })

  it('classe toujours une vraie mutation comme mutation', () => {
    expect(isMutationTask('modifie le composant ChatView')).toBe(true)
    expect(isMutationTask('ajoute un sélecteur puis corrige le bug')).toBe(true)
  })

  it('reste mutation si négation ET ordre positif coexistent', () => {
    expect(isMutationTask('ne touche pas au CSS mais ajoute le bouton')).toBe(true)
  })
})
