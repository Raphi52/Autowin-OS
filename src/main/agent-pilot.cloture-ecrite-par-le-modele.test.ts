import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * LA CLÔTURE D'UNE ORCHESTRATION EST ÉCRITE PAR LE MODÈLE, pas par un gabarit.
 *
 * Constat utilisateur du 2026-08-27 (conv-1449) : le pied annonçait « 👉 Recommandé : faire exécuter
 * le travail si le besoin n'est pas encore réalisé » alors que le RUN.md du même run portait
 * `### phase build` ET `### phase judge`, la DoD cochée « Mutation demandée produite avec une preuve
 * exécutable », `status: green` et un juge validé. Le gabarit DEVINE la portée à partir de
 * `phaseOutputs` ; quand ce champ arrive vide il avoue une ignorance qui n'existe pas — tout en
 * affirmant « ✅ Fait » deux lignes plus haut. Il avait déjà menti trois fois (20/08, 21/08, 23/08),
 * chaque fois rafistolé par une branche de plus : c'est la MÉTHODE qui est fausse, pas la branche.
 *
 * Le tour était clos MÉCANIQUEMENT sur l'issue structurée (`emit done` + `return`), donc le modèle
 * n'avait jamais la parole après une orchestration. Il l'a désormais : l'issue lui est rendue comme
 * résultat d'outil AUTORITATIF, et c'est lui qui rédige.
 *
 * Ce que ce test NE relâche PAS : `orchestrationIssued` interdit toujours une 2e orchestration dans
 * le même tour — rendre la parole ne rouvre donc pas la porte à un second run payant.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

/** Une issue LIVRÉE (les cinq conditions de `isDeliveredOrchestrationOutcome`). */
const ISSUE_LIVREE = {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  runPath: 'C:/runs/conv-1449/le-nuage-workspace/RUN.md',
  result: 'Rapport du worker : shader retouché.'
}

const CLOTURE_DU_MODELE = 'Le nuage est plus dynamique : shader retouché, 12 tests verts.'

function pilote(): {
  events: PilotEvent[]
  send: ReturnType<typeof vi.fn>
  run: () => Promise<void>
} {
  const responses = [
    '<cmd>{"name":"orchestrate","args":{"task":"rends le nuage dynamique"}}</cmd>',
    CLOTURE_DU_MODELE
  ]
  const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'codex' }))
  const registry = {
    send,
    describePrompt: () => ({
      provider: 'codex',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const bus = {
    catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
    snapshotForPrompt,
    exec: vi.fn().mockResolvedValue({ ok: true, data: ISSUE_LIVREE })
  }
  const events: PilotEvent[] = []
  return {
    events,
    send,
    run: () =>
      new AgentPilot(
        registry as never,
        { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
        bus as never
      ).chat([{ role: 'user', content: 'le nuage je veux qu’il soit plus dynamique' }], (event) =>
        events.push(event)
      )
  }
}

describe('clôture d’orchestration — le modèle reprend la parole', () => {
  it('rappelle le modèle après l’orchestration au lieu de clore le tour', async () => {
    const p = pilote()
    await p.run()
    // Deux générations : celle qui lance l'orchestration, puis celle qui rédige la clôture.
    expect(p.send.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('affiche le texte du MODÈLE comme clôture', async () => {
    const p = pilote()
    await p.run()
    const done = p.events.find((event) => event.kind === 'done')
    expect(done?.kind === 'done' ? done.text : '').toContain(CLOTURE_DU_MODELE)
  })

  it('n’affiche plus le pied deviné par le gabarit', async () => {
    const p = pilote()
    await p.run()
    const done = p.events.find((event) => event.kind === 'done')
    const texte = done?.kind === 'done' ? (done.text ?? '') : ''
    expect(texte).not.toContain('faire exécuter le travail')
    expect(texte).not.toContain('Le résultat demandé a été produit et validé')
  })

  it('garde l’issue structurée sur l’événement de clôture — la comptabilité en dépend', async () => {
    const p = pilote()
    await p.run()
    const done = p.events.find((event) => event.kind === 'done')
    expect(done?.kind === 'done' ? done.outcome : undefined).toMatchObject({ status: 'succeeded' })
  })
})

/**
 * LE REPLI — la contrepartie indispensable de la parole rendue.
 *
 * Rendre la parole au modèle crée un risque que la clôture mécanique ne courait pas : un modèle qui
 * n'écrit rien (ou qui s'obstine à redemander une orchestration, refusée par `orchestrationIssued`)
 * brûlait les itérations jusqu'à « Cap d'itérations atteint sans réponse finale ». L'utilisateur
 * perdait alors le compte-rendu qu'il avait AVANT ce changement — une régression payée au prix d'un
 * run complet. L'issue autoritative reste donc le repli : le modèle a la parole, il n'a pas le
 * pouvoir de faire disparaître le résultat.
 */
describe('clôture d’orchestration — repli quand le modèle se taît', () => {
  it('rend le compte-rendu autoritatif au lieu de mourir sur le cap d’itérations', async () => {
    // Le modèle s'obstine : il redemande une orchestration à chaque tour et ne conclut jamais.
    const send = vi.fn(async () => ({
      text: '<cmd>{"name":"orchestrate","args":{"task":"encore"}}</cmd>',
      provider: 'codex'
    }))
    const registry = {
      send,
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: ISSUE_LIVREE })
    }
    const events: PilotEvent[] = []
    await new AgentPilot(
      registry as never,
      { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
      bus as never
    ).chat([{ role: 'user', content: 'le nuage' }], (event) => events.push(event))

    const done = events.find((event) => event.kind === 'done')
    expect(done).toBeDefined()
    const texte = done?.kind === 'done' ? (done.text ?? '') : ''
    // Les FAITS du run sont rendus : le sujet du run en est la trace la plus sûre.
    expect(texte).toContain('le-nuage')
    expect(done?.kind === 'done' ? done.outcome : undefined).toMatchObject({ status: 'succeeded' })
  })
})
