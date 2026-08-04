import { describe, expect, it } from 'vitest'
import { classifyMutationConfidence, isMutationTask } from './orchestrator'

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

  describe('#2 — faux-négatif : préfixe lecture-seule + seconde clause de mutation non reconnue', () => {
    // Le FAUX NÉGATIF visé : une tâche qui MUTE réellement des fichiers, mais dont le verbe de
    // mutation (« écrase ») n'est dans AUCUN dictionnaire de stems, précédée d'un verbe lecture-seule
    // reconnu (« documente ») qui, seul, faisait auparavant classer toute la phrase read-only.
    it("classe MUTATION une tâche 'documente PUIS <verbe inconnu> le fichier' (paraphrase)", () => {
      const task = 'Documente le module, puis écrase le fichier notes.md avec la nouvelle version.'
      expect(classifyMutationConfidence(task)).toBe('uncertain')
      expect(isMutationTask(task)).toBe(true)
    })

    it('même faux-négatif en tournure nominale/mixte anglais-français', () => {
      const task = 'Audit du module then overwrite the config file with the new defaults'
      expect(classifyMutationConfidence(task)).toBe('uncertain')
      expect(isMutationTask(task)).toBe(true)
    })

    it('garde read-only une tâche VRAIMENT à clause unique (pas de régression)', () => {
      expect(classifyMutationConfidence('analyse le projet sans rien changer')).toBe('read-only')
      expect(classifyMutationConfidence('documente le module')).toBe('read-only')
    })

    it('garde read-only quand toutes les clauses sont elles-mêmes lecture-seule', () => {
      expect(classifyMutationConfidence('audit le module puis résume les risques')).toBe(
        'read-only'
      )
    })
  })
})
