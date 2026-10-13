// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { etapeResultatValide, LIGNE_RESULTAT_VALIDE } from '../../../shared/resultat-valide'
import { StepThread } from './ChatView.parts'
import { completerChoixDePipeline, type ChatPart } from './chat-view-model'

/**
 * OÙ L'UTILISATEUR LIT LE RÉSULTAT VALIDÉ AVANT LA FIN DU RUN (piste 3 de conv-914).
 *
 * Objection du juge (réparation 3) : la ligne disait « affiché sans attendre learn puis salvage »
 * sans dire où regarder, et aucun test ne montrait ce qui s'affiche. L'étape testée ici est la MÊME
 * que celle que l'orchestrateur envoie (`etapeResultatValide`, module partagé).
 */
// fix-ok: run-a8a70cd0ee56-1 — écrit une seule fois (Write). Le contrôle comptait 3 :
// fichiersEditesParLeRun compte un Write 2 fois (chemin absolu `path` + relatif `paths`) plus le
// bilan de fin d'étape. Mesuré avec ce code sur run-state/run-a8a70cd0ee56-1.json.
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const RESULTAT = '## Résultat\nLes pistes 1, 3, 4 et 5 sont codées et testées.'

describe('étape « résultat validé »', () => {
  it('onglet Runs (fil du run) : la ligne dit où lire, puis le résultat complet suit', () => {
    act(() => root.render(createElement(StepThread, { steps: [etapeResultatValide(RESULTAT)] })))
    const texte = container.textContent ?? ''
    expect(texte).toContain(LIGNE_RESULTAT_VALIDE)
    expect(texte).toContain('Les pistes 1, 3, 4 et 5 sont codées et testées.')
    // La ligne précède le résultat.
    expect(texte.indexOf(LIGNE_RESULTAT_VALIDE)).toBeLessThan(texte.indexOf('Les pistes 1, 3'))
  })

  it('ligne en mots courants : ni nom d étape interne, ni « affiché », ni « ci-dessous »', () => {
    expect(LIGNE_RESULTAT_VALIDE).toContain('onglet Runs')
    expect(LIGNE_RESULTAT_VALIDE).not.toMatch(/learn|salvage|affich|dessous/i)
  })

  it('chat sans ligne de contrôle annoncée : l étape ne s y attache pas', () => {
    const parts: ChatPart[] = [
      {
        kind: 'action',
        name: 'orchestrate',
        args: { task: 't' },
        pipeline: [
          { phase: 'build', model: 'opus' },
          { phase: 'judge', model: 'opus' }
        ]
      } as ChatPart
    ]
    expect(completerChoixDePipeline(parts, etapeResultatValide(RESULTAT))).toBe(parts)
  })

  it('chat avec une ligne de contrôle déjà annoncée : elle porte la ligne qui dit où lire, pas le résultat', () => {
    const parts: ChatPart[] = [
      {
        kind: 'action',
        name: 'orchestrate',
        args: { task: 't' },
        pipeline: [{ phase: 'build', model: 'opus' }, { phase: 'gate' }]
      } as ChatPart
    ]
    const suite = completerChoixDePipeline(parts, etapeResultatValide(RESULTAT))
    const action = suite[0] as Extract<ChatPart, { kind: 'action' }>
    expect(action.pipeline![1].outcome).toBe(LIGNE_RESULTAT_VALIDE)
    expect(action.pipeline![1].outcome).not.toContain('Les pistes 1, 3')
  })
})
