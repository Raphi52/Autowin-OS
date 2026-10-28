import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * RÉPONSE COUPÉE PAR LE FILTRE DE SÉCURITÉ DU FOURNISSEUR = AVIS VISIBLE (conv-1161, 2026-10-27).
 *
 * Séquence rejouée : celle du tour a1ddde24-e8a1-4487-9604-44daeff499cd, journal brut
 * `run-stdout/aeaf1921-….stdout.jsonl` l.636-641 — bloc de raisonnement, `message_delta` à
 * `stop_reason: "refusal"` (catégorie `cyber`), avis `informational` du CLI, message SYNTHÉTIQUE
 * renvoyé au modèle, puis le modèle reprend (« Je m'arrête ici… »). Autowin ne lisait aucun de ces
 * signaux : l'utilisateur voyait l'agent changer d'avis sans raison, et le modèle lui donnait une
 * autre explication (morale, impossibilité technique) que la vraie.
 */
const spawnCapture = vi.hoisted(() => ({
  stdoutEvents: [] as Array<Record<string, unknown>>
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    setTimeout(() => {
      for (const event of spawnCapture.stdoutEvents.splice(0))
        stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

beforeEach(() => {
  spawnCapture.stdoutEvents = []
})

async function drainer(): Promise<{
  deltas: string[]
  text: string
  coupures: Array<{ categorie?: string; explication?: string }>
}> {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
  const deltas: string[] = []
  const coupures: Array<{ categorie?: string; explication?: string }> = []
  let step = await gen.next()
  while (!step.done) {
    if (step.value.delta) deltas.push(step.value.delta)
    if (step.value.coupureFiltre) coupures.push(step.value.coupureFiltre)
    step = await gen.next()
  }
  return { deltas, text: step.value.text, coupures }
}

const COUPURE = {
  type: 'stream_event',
  event: {
    type: 'message_delta',
    delta: {
      stop_reason: 'refusal',
      stop_sequence: null,
      stop_details: {
        type: 'refusal',
        category: 'cyber',
        explanation: 'blocked under Usage Policy'
      }
    },
    usage: { output_tokens: 874 }
  }
}
const RESULTAT = {
  type: 'result',
  subtype: 'success',
  result: "Je m'arrête ici.",
  session_id: 's',
  is_error: false,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
}

function sequenceCoupee(coupures = 1): Array<Record<string, unknown>> {
  const une = [
    {
      type: 'assistant',
      message: { id: 'msg_1', model: 'm', content: [{ type: 'thinking', thinking: 'je regarde' }] }
    },
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
    COUPURE,
    { type: 'stream_event', event: { type: 'message_stop' } },
    {
      type: 'system',
      subtype: 'informational',
      content: "Opus 5.5's safeguards stopped the response above · continuing once with that noted",
      level: 'notice'
    },
    {
      type: 'user',
      isSynthetic: true,
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Your response above was stopped by a safety classifier.' }]
      }
    }
  ]
  return [
    {
      type: 'assistant',
      message: {
        id: 'msg_0',
        model: 'm',
        content: [{ type: 'text', text: 'Je regarde le journal.' }]
      }
    },
    ...Array.from({ length: coupures }, () => une).flat(),
    {
      type: 'assistant',
      message: { id: 'msg_2', model: 'm', content: [{ type: 'text', text: "Je m'arrête ici." }] }
    },
    RESULTAT
  ]
}

describe('ClaudeCliAdapter — réponse coupée par le filtre de sécurité du fournisseur', () => {
  it('affiche un avis, au moment de la coupure, qui nomme le filtre et sa catégorie', async () => {
    spawnCapture.stdoutEvents = sequenceCoupee()
    const { deltas, text } = await drainer()

    const avis = deltas.find((d) => d.includes('filtre de sécurité'))
    expect(avis, "l'avis doit partir EN DIRECT, pas seulement dans le texte final").toBeDefined()
    expect(avis).toContain('catégorie : cyber')
    expect(
      avis,
      "l'utilisateur doit savoir que ni Autowin ni une panne n'en sont la cause"
    ).toContain("ni un choix d'Autowin ni une panne")
    // Placé ENTRE le texte d'avant la coupure et la reprise du modèle, en paragraphe à part.
    const iAvant = text.indexOf('Je regarde le journal.')
    const iAvis = text.indexOf('⚠️ Le filtre de sécurité')
    const iReprise = text.indexOf("Je m'arrête ici.")
    expect(iAvant).toBeGreaterThanOrEqual(0)
    expect(iAvis).toBeGreaterThan(iAvant)
    expect(iReprise).toBeGreaterThan(iAvis)
    expect(text.slice(iAvant)).toMatch(/\.\n\n⚠️ Le filtre[^\n]*\.\n\nJe m'arrête/u)
  })

  it('ne répète pas l’avis quand le filtre coupe deux fois le même tour', async () => {
    spawnCapture.stdoutEvents = sequenceCoupee(2)
    const { text } = await drainer()
    expect(text.split('⚠️ Le filtre de sécurité').length - 1).toBe(1)
  })

  /*
   * LE SIGNAL EST AUSSI UNE DONNÉE, pas seulement un texte (conv-1161, 2e passe). L'avis affiché ne
   * suffisait pas à l'app : la rétrospective et le kaizen lisent le journal du tour, où la coupure
   * n'apparaissait nulle part — le diagnostic a dû fouiller `run-stdout/` pour la retrouver.
   * Chaque coupure part donc en fragment structuré, MÊME quand l'avis n'est pas répété.
   */
  it('joint à chaque coupure sa catégorie et son explication, pour le journal du tour', async () => {
    spawnCapture.stdoutEvents = sequenceCoupee(2)
    const { coupures } = await drainer()
    expect(coupures).toEqual([
      { categorie: 'cyber', explication: 'blocked under Usage Policy' },
      { categorie: 'cyber', explication: 'blocked under Usage Policy' }
    ])
  })

  it('reste muet sur une fin de réponse ordinaire', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: { id: 'msg_0', model: 'm', content: [{ type: 'text', text: 'B.' }] }
      },
      {
        type: 'stream_event',
        event: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } }
      },
      { ...RESULTAT, result: 'B.' }
    ]
    const { text, coupures } = await drainer()
    expect(text).toBe('B.')
    expect(coupures).toEqual([])
  })
})
