import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workflowDuTour } from './claude-workflow'
import {
  DUREE_DE_GARDE_MS,
  oublierMiroirSessionsAvecWorkflow,
  retenirSessionAvecWorkflow,
  sessionAvecWorkflow
} from './sessions-avec-workflow'

/**
 * Mesure du 2026-11-08 : la session 5595d443 a reçu `Workflow` sur une demande de chantier (1,25 $
 * de relecture hors cache), puis l'a perdu au tour suivant (1,39 $ de plus). Une liste d'outils qui
 * change fait relire toute la conversation : la session qui l'a reçu doit le garder.
 */
const dossiers: string[] = []
const base = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'autowin-tests-workflow-'))
  dossiers.push(d)
  return d
}
afterEach(() => {
  oublierMiroirSessionsAvecWorkflow()
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('Workflow gardé par la session qui l’a reçu', () => {
  it('le tour suivant de la session, sans demande de chantier, garde l’outil', () => {
    const b = base()
    const demande = 'lance un gros chantier de 40 sous-agents sur les tests'
    expect(workflowDuTour(demande, sessionAvecWorkflow(undefined, b))).toBe(true)
    retenirSessionAvecWorkflow('sess-chantier', b)

    const suite = 'merci, et maintenant résume ce qui a été fait'
    expect(workflowDuTour(suite, sessionAvecWorkflow('sess-chantier', b))).toBe(true)
    // Une autre session, qui ne l'a jamais reçu, ne le charge toujours pas.
    expect(workflowDuTour(suite, sessionAvecWorkflow('sess-ordinaire', b))).toBe(false)
  })

  it('survit à un redémarrage de l’app : la session est relue sur le disque', async () => {
    const b = base()
    retenirSessionAvecWorkflow('sess-persistee', b, 1_000)
    // L'écriture part hors du fil principal : on attend qu'elle soit posée.
    for (let i = 0; i < 50; i++) {
      try {
        if (readFileSync(join(b, 'sessions-avec-workflow.json'), 'utf8').includes('sess-persistee'))
          break
      } catch {
        /* pas encore écrit */
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    oublierMiroirSessionsAvecWorkflow()
    expect(sessionAvecWorkflow('sess-persistee', b)).toBe(true)
  })

  it('oublie les sessions plus vieilles que la durée de garde', () => {
    const b = base()
    retenirSessionAvecWorkflow('sess-ancienne', b, 0)
    retenirSessionAvecWorkflow('sess-recente', b, DUREE_DE_GARDE_MS + 1)
    expect(sessionAvecWorkflow('sess-ancienne', b)).toBe(false)
    expect(sessionAvecWorkflow('sess-recente', b)).toBe(true)
  })
})
