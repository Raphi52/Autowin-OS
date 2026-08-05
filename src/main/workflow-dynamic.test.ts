import { describe, expect, it } from 'vitest'
import type { WorkflowProfile } from './workflow-profiles'
import {
  acceptProposedGraph,
  catalogueBrief,
  dynamicPrompt,
  meriteUneDecision,
  PLAFOND_GRAPHE_INVENTE,
  readWorkflowDecision
} from './workflow-dynamic'

/**
 * Ce que ces tests protègent : que le mode dynamique reste un OUTIL. Un choix automatique qui
 * choisit TOUJOURS quelque chose est une contrainte déguisée ; un graphe inventé qu'on joue sans le
 * valider est une porte ouverte sur un run invalide ou ruineux.
 */

const catalogue: WorkflowProfile[] = [
  { id: 'eclair', name: 'Éclair', description: 'Une question, une réponse.' },
  {
    id: 'correctif',
    name: 'Correctif',
    description: 'Un défaut à corriger.',
    graph: {
      entry: 'build-1',
      nodes: [
        { id: 'build-1', phase: 'build' },
        { id: 'judge-1', phase: 'judge' }
      ],
      edges: [{ from: 'build-1', to: 'judge-1', when: 'always' }]
    }
  }
]

describe('la question posée au modèle', () => {
  it('montre ce que chaque workflow FAIT, pas sa structure interne', () => {
    const texte = catalogueBrief(catalogue)
    expect(texte).toContain('Un défaut à corriger')
    expect(texte).toContain('build → judge')
  })

  it('insiste sur le droit de ne rien choisir — sinon un modèle serviable choisit toujours', () => {
    const p = dynamicPrompt('corrige ce bug', catalogue)
    expect(p).toMatch(/aucun/i)
    expect(p).toMatch(/réponse NORMALE/i)
  })

  it('un catalogue vide ne produit pas un prompt cassé', () => {
    expect(catalogueBrief([])).toContain('aucun workflow')
  })
})

describe('faut-il seulement poser la question', () => {
  it('une demande de trois mots ne mérite pas un appel de modèle', () => {
    expect(meriteUneDecision('corrige ça')).toBe(false)
  })

  it('une question pure appelle une réponse, pas un pipeline', () => {
    expect(meriteUneDecision('Comment fonctionne le système de worktrees dans ce dépôt ?')).toBe(
      false
    )
  })

  it('une vraie tâche mérite qu’on choisisse', () => {
    expect(
      meriteUneDecision(
        'Ajoute la gestion des retours conditionnels dans le moteur et fais valider le résultat'
      )
    ).toBe(true)
  })
})

describe('lire la décision', () => {
  it('reprend un workflow existant', () => {
    const d = readWorkflowDecision('WORKFLOW: correctif', catalogue)
    expect(d.kind).toBe('existing')
    expect(d.kind === 'existing' && d.profile.id).toBe('correctif')
  })

  it('« aucun » est une décision de plein droit, pas un échec', () => {
    expect(readWorkflowDecision('WORKFLOW: aucun', catalogue).kind).toBe('none')
  })

  it('un id INCONNU ne fait pas choisir au hasard — on ne pilote rien', () => {
    const d = readWorkflowDecision('WORKFLOW: inventé-42', catalogue)
    expect(d.kind).toBe('none')
    expect(d.kind === 'none' && d.reason).toContain('inconnu')
  })

  it('une réponse illisible retombe sur « aucun » : le repli sûr est l’état d’avant', () => {
    expect(readWorkflowDecision('je pense que peut-être...', catalogue).kind).toBe('none')
  })

  it('accepte un graphe neuf valide, même noyé dans de la prose', () => {
    const reponse = `Voici mon choix.
WORKFLOW: nouveau
{"name":"Ad hoc","graph":{"entry":"frame-1","nodes":[{"id":"frame-1","phase":"frame"},{"id":"build-1","phase":"build"}],"edges":[{"from":"frame-1","to":"build-1","when":"always"}]}}
Voilà.`
    const d = readWorkflowDecision(reponse, catalogue)
    expect(d.kind).toBe('new')
    expect(d.kind === 'new' && d.name).toBe('Ad hoc')
  })
})

describe('les garde-fous du graphe inventé', () => {
  it('REFUSE un graphe invalide — un retour sans borne ne peut pas tourner', () => {
    const verdict = acceptProposedGraph({
      entry: 'b',
      nodes: [
        { id: 'b', phase: 'build' },
        { id: 'j', phase: 'judge' }
      ],
      edges: [
        { from: 'b', to: 'j', when: 'always' },
        { from: 'j', to: 'b', when: 'red' } // pas de maxTraversals
      ]
    })
    expect(verdict.ok).toBe(false)
  })

  it('REFUSE un graphe trop coûteux — celui-là tournerait très bien, c’est le danger', () => {
    // Deux boucles imbriquées à 9 : le pire cas se multiplie, il n'aditionne pas.
    const verdict = acceptProposedGraph({
      entry: 'a',
      nodes: [
        { id: 'a', phase: 'frame' },
        { id: 'b', phase: 'build' },
        { id: 'c', phase: 'judge' }
      ],
      edges: [
        { from: 'a', to: 'b', when: 'always' },
        { from: 'b', to: 'c', when: 'always' },
        { from: 'c', to: 'a', when: 'red', maxTraversals: 9 }
      ]
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toContain('plafond')
  })

  it('un graphe refusé fait retomber sur « aucun », jamais sur un graphe dégradé', () => {
    const reponse = `WORKFLOW: nouveau
{"name":"Trop","graph":{"entry":"a","nodes":[{"id":"a","phase":"frame"},{"id":"b","phase":"build"}],"edges":[{"from":"a","to":"b","when":"always"},{"from":"b","to":"a","when":"red","maxTraversals":9}]}}`
    const d = readWorkflowDecision(reponse, catalogue)
    expect(d.kind).toBe('none')
  })

  it('le plafond inventé est plus BAS que ce qu’un humain peut composer à la main', () => {
    // L'humain voit son pire cas affiché avant d'enregistrer ; le modèle, non.
    expect(PLAFOND_GRAPHE_INVENTE).toBeLessThan(24)
  })
})
