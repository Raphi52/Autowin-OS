// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup, SubAgentStep } from './ChatView.parts'
import { completerChoixDePipeline } from './chat-view-model'
import type { ChatPart, OrchStep, PipelineChoice } from './chat-view-model'

let container: HTMLDivElement
let root: Root
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

function rendre(step: OrchStep): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(createElement(SubAgentStep, { step })))
  return container
}

/**
 * UN SOUS-AGENT COUPÉ PAR LE BOUTON STOP EST « ANNULÉ » DANS LE CHAT (conv-966). Sa pastille rouge
 * « échec » se lisait comme une panne. Erreurs reprises des fils de run enregistrés sur le poste
 * (`runs/conv-955/…/trace.json`, `runs/conv-636/…/trace.json`).
 */
describe('SubAgentStep — un sous-agent arrêté par le bouton Stop', () => {
  const arretParStop =
    "Phase clean — appel du rôle subagent INTERROMPU avant sa fin : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat)\nlast-event=none\nstderr=none. Ce n'est pas une panne : ni claude ni le binding du rôle ne sont en cause."

  it('montre « annulé » et non « échec », et garde le texte de l’arrêt', () => {
    const vue = rendre({ step: 'exec', role: 'subagent', status: 'failed', error: arretParStop })

    const pastille = vue.querySelector('.subagent-failed-pill')
    expect(pastille?.textContent).toBe('annulé')
    expect(pastille?.classList.contains('is-cancelled')).toBe(true)
    expect(vue.textContent).not.toContain('échec')
    expect(vue.querySelector('.subagent-step')?.classList.contains('failed')).toBe(false)
    expect(vue.querySelector('.subagent-step')?.classList.contains('cancelled')).toBe(true)
    const texte = vue.querySelector('.subagent-error')
    expect(texte?.textContent).toBe(arretParStop)
    expect(texte?.classList.contains('is-cancelled')).toBe(true)
  })

  it('un lancement en parallèle où tous les modèles ont été coupés par Stop est annulé', () => {
    const vue = rendre({
      step: 'exec',
      role: 'subagent',
      status: 'failed',
      error:
        "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie\n• claude (claude-opus-5) : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat)\nlast-event=none\nstderr=none\n→ Rien à réparer côté provider : l'appel a été coupé."
    })
    expect(vue.querySelector('.subagent-failed-pill')?.textContent).toBe('annulé')
  })

  it('une vraie panne reste « échec » en rouge — discriminant', () => {
    const vue = rendre({
      step: 'exec',
      role: 'subagent',
      status: 'failed',
      error: 'Phase clean — le rôle subagent est bindé sur claude : You’ve hit your session limit'
    })
    const pastille = vue.querySelector('.subagent-failed-pill')
    expect(pastille?.textContent).toBe('échec')
    expect(pastille?.classList.contains('is-cancelled')).toBe(false)
    expect(vue.querySelector('.subagent-step')?.classList.contains('failed')).toBe(true)
    expect(vue.querySelector('.subagent-error')?.classList.contains('is-cancelled')).toBe(false)
  })

  it('en parallèle, un modèle en panne à côté d’un modèle coupé par Stop reste « échec »', () => {
    const vue = rendre({
      step: 'exec',
      role: 'subagent',
      status: 'failed',
      error:
        "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie\n• claude (claude-opus-5) : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat)\nlast-event=none\nstderr=none\n• codex (gpt-5.6) : usage limit reached"
    })
    expect(vue.querySelector('.subagent-failed-pill')?.textContent).toBe('échec')
  })

  it('une étape réussie n’a aucune pastille', () => {
    const vue = rendre({ step: 'exec', role: 'subagent', status: 'completed', text: 'fait' })
    expect(vue.querySelector('.subagent-failed-pill')).toBeNull()
  })
})

/**
 * LA LIGNE D'ÉTAPE DU BLOC D'ORCHESTRATION (conv-966). `completerChoixDePipeline` posait
 * `ok: false` sur la phase coupée par le Stop : segment rouge dans la légende, rendu en rouge.
 */
describe('bloc d’orchestration — une phase coupée par le bouton Stop', () => {
  const stop =
    "Phase clean — appel du rôle subagent INTERROMPU avant sa fin : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat)\nlast-event=none\nstderr=none."
  const enCours = (): ChatPart =>
    ({
      kind: 'action',
      name: 'orchestrate',
      args: { task: 'ma tache' },
      pipeline: [
        { phase: 'build', model: 'm', ok: true, outcome: 'livrable' },
        { phase: 'clean', model: 'm' }
      ]
    }) as unknown as ChatPart
  const ligneClean = (parts: ChatPart[]): PipelineChoice | undefined =>
    parts[0]?.kind === 'action' ? parts[0].pipeline?.[1] : undefined
  const etape = (error: string): OrchStep => ({
    step: 'exec',
    role: 'subagent',
    model: 'm',
    status: 'failed',
    error,
    execution: { phase: 'clean' }
  })

  it('la ligne est annulée, sans « ok: false », et garde le texte de l’arrêt comme rendu', () => {
    const ligne = ligneClean(completerChoixDePipeline([enCours()], etape(stop)))
    expect(ligne?.annule).toBe(true)
    expect(ligne?.ok).toBeUndefined()
    expect(ligne?.outcome).toBe(stop)
  })

  it('une vraie panne reste « ok: false » — discriminant', () => {
    const ligne = ligneClean(
      completerChoixDePipeline(
        [enCours()],
        etape('le rôle subagent : You’ve hit your session limit')
      )
    )
    expect(ligne?.ok).toBe(false)
    expect(ligne?.annule).toBeUndefined()
  })

  const legende = (vue: HTMLElement): Array<[string, string | null]> =>
    [...vue.querySelectorAll('[data-testid="legende-outil"]')].map((l) => [
      l.textContent ?? '',
      l.getAttribute('data-etat')
    ])
  const capsule = (pipeline: PipelineChoice[]): HTMLDivElement => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() =>
      root.render(
        createElement(AssistantActivityGroup, {
          actions: [
            {
              kind: 'action',
              name: 'orchestrate',
              args: { task: 'ma tache' },
              ok: false,
              pipeline
            } as never
          ]
        })
      )
    )
    act(() => (container.querySelector('summary') as HTMLElement).click())
    return container
  }

  it('dans la capsule, la phase annulée est grise (attente), pas rouge, et son rendu n’est pas en rouge', () => {
    const vue = capsule([
      { phase: 'build', model: 'm', ok: true, outcome: 'livrable' },
      { phase: 'clean', model: 'm', annule: true, outcome: stop }
    ])
    expect(legende(vue)).toEqual([
      ['build', 'ok'],
      ['clean', 'attente']
    ])
    const rendus = vue.querySelectorAll('[data-testid="activity-pipeline-outcome"]')
    expect(rendus[1]?.textContent).toBe(stop)
    expect(rendus[1]?.className).not.toContain('failed')
  })

  it('dans la capsule, une phase en vraie panne reste rouge — discriminant', () => {
    const vue = capsule([
      { phase: 'build', model: 'm', ok: true, outcome: 'livrable' },
      { phase: 'clean', model: 'm', ok: false, outcome: 'quota' }
    ])
    expect(legende(vue)).toEqual([
      ['build', 'ok'],
      ['clean', 'ko']
    ])
  })
})
