import { describe, expect, it } from 'vitest'
import { chatArtifactToTraceEvent } from './chat-artifact-trace'

/**
 * MANQUE CONSTATE LE 2026-08-07 : un artefact produit par le modele etait persiste dans le tour de
 * chat (`main/index.ts`, branche `kind === 'artifact'` d'`applyDurableEvent`) et dans le journal du
 * tour — mais AUCUN evenement causal n'etait ecrit. `src/main/activity/` ne contenait pas une seule
 * mention d'artefact (verifie insensible a la casse). Consequence : le chat montrait l'artefact,
 * Observatory l'ignorait totalement, et sa chronologie affirmait implicitement « voila tout ce que ce
 * tour a produit » en omettant un livrable.
 *
 * L'artefact obtient un type d'evenement PROPRE plutot que d'etre deguise en `tool-result` : ce n'est
 * pas le retour d'un outil, c'est une SORTIE du modele, et les confondre rendrait le comptage des
 * appels d'outils faux.
 */

const base = {
  id: 'conv1:turn1:artifact:0',
  conversationId: 'conv1',
  turnId: 'turn1',
  timestamp: '2026-08-07T10:00:00.000Z',
  sequence: 4
}

describe('chatArtifactToTraceEvent', () => {
  it('produit un evenement causal VALIDE de type artifact', () => {
    const event = chatArtifactToTraceEvent({
      ...base,
      artifact: { kind: 'file', name: 'rapport.md', path: 'C:/tmp/rapport.md', bytes: 1234 }
    })
    expect(event.type).toBe('artifact')
    expect(event.schema).toBe('autowin.trace/v1')
    expect(event.conversationId).toBe('conv1')
    expect(event.turnId).toBe('turn1')
    expect(event.status).toBe('completed')
  })

  it('attribue l’artefact au MODELE, pas a un outil — c’est une sortie, pas un retour d’appel', () => {
    const event = chatArtifactToTraceEvent({
      ...base,
      artifact: { kind: 'file', name: 'rapport.md' }
    })
    expect(event.actor.kind).toBe('agent')
    expect(event.channel).toBe('assistant')
  })

  it('porte le NOM de l’artefact dans la charge, en payload `attachment`', () => {
    // `attachment` existe deja dans `TracePayloadKind` : le contrat anticipait les pieces jointes,
    // il n'y avait qu'a s'en servir.
    const event = chatArtifactToTraceEvent({
      ...base,
      artifact: { kind: 'file', name: 'rapport.md', path: 'C:/tmp/rapport.md' }
    })
    expect(event.payloads[0].kind).toBe('attachment')
    expect(event.payloads[0].name).toBe('rapport.md')
    expect(event.payloads[0].content).toContain('rapport.md')
  })

  it('chaine l’artefact a son parent causal quand il y en a un', () => {
    const event = chatArtifactToTraceEvent({
      ...base,
      parentId: 'conv1:turn1:action:0',
      artifact: { kind: 'file', name: 'x.md' }
    })
    expect(event.parentId).toBe('conv1:turn1:action:0')
  })

  it('survit a un artefact SANS nom ni chemin — la trace ne doit jamais casser un tour', () => {
    // Un artefact mal forme ne doit pas faire echouer la validation et donc perdre le tour entier :
    // mieux vaut un evenement pauvre qu'une trace absente.
    const event = chatArtifactToTraceEvent({ ...base, artifact: { kind: 'file' } })
    expect(event.type).toBe('artifact')
    expect(event.payloads[0].content.length).toBeGreaterThan(0)
  })

  it('declare la frontiere d’observation et une fidelite exacte', () => {
    const event = chatArtifactToTraceEvent({ ...base, artifact: { kind: 'file', name: 'a.md' } })
    expect(event.observation.fidelity).toBe('exact')
    expect(event.observation.boundary).toBeTruthy()
  })
})
