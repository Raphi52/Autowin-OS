import { describe, expect, it } from 'vitest'
import { isMutationTask } from './orchestrator'

describe('isMutationTask (J3 — négation)', () => {
  it('force toujours /kaizen en lecture seule, même si la cible cite une mutation', () => {
    expect(isMutationTask('/kaizen analyse pourquoi il a modifié le fichier')).toBe(false)
  })

  it('ne classe PAS une tâche de cadrage niée comme mutation', () => {
    expect(isMutationTask('produis le cadrage. Ne modifie pas de code applicatif.')).toBe(false)
    expect(isMutationTask("n'ajoute pas de fichier, documente seulement")).toBe(false)
    expect(isMutationTask('analyse le projet sans rien changer')).toBe(false)
  })

  it('classe toujours une vraie mutation comme mutation', () => {
    expect(isMutationTask('modifie le composant ChatView')).toBe(true)
    expect(isMutationTask('ajoute un sélecteur puis corrige le bug')).toBe(true)
    expect(isMutationTask('gère automatiquement les workspaces')).toBe(true)
    expect(isMutationTask('écris le manifeste, remplace la vue et configure la reprise')).toBe(true)
    expect(isMutationTask('write a file')).toBe(true)
    expect(isMutationTask('patch the renderer')).toBe(true)
    expect(isMutationTask('apply the proposed changes')).toBe(true)
    expect(isMutationTask('fais un bouton plus lisible')).toBe(true)
    expect(isMutationTask('analyse the code and write a file')).toBe(true)
  })

  it('reste mutation si négation ET ordre positif coexistent', () => {
    expect(isMutationTask('ne touche pas au CSS mais ajoute le bouton')).toBe(true)
    expect(isMutationTask('ne modifie pas le CSS mais write a new file')).toBe(true)
  })
})
