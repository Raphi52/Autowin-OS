import { describe, expect, it } from 'vitest'
import { causeDeLaCassure, classerCassures, sessionDeLaTrace } from './memoires-cassees.mjs'

const init = (extra = {}) => ({ tools: ['Read', 'Bash'], mcp_servers: [], model: 'opus', ...extra })
const prompt = (ref, blocs) => ({ systemRef: ref, systemBlocks: blocs })

describe('cause d’une mémoire de relecture cassée — le premier élément qui diffère', () => {
  it('un outil ajouté ou retiré passe avant tout le reste', () => {
    const r = causeDeLaCassure(
      { init: init({ tools: ['Read', 'Bash', 'Workflow'] }), prompt: prompt('a', []) },
      { init: init(), prompt: prompt('b', []) }
    )
    expect(r).toEqual({ cause: 'liste d’outils', detail: '-Workflow' })
  })

  it('nomme le bloc de consignes qui a changé', () => {
    const blocs = [{ name: 'constitution', chars: 10 }]
    const r = causeDeLaCassure(
      { init: init(), prompt: prompt('a', blocs) },
      { init: init(), prompt: prompt('b', [...blocs, { name: 'visuel', chars: 2856 }]) }
    )
    expect(r.cause).toBe('consignes : bloc visuel')
    expect(r.detail).toBe('visuel 0→2856 car.')
  })

  it('un dossier ajouté ne compte qu’à consignes identiques', () => {
    const r = causeDeLaCassure(
      { init: init({ additional_directories: ['C:/t/a'] }), prompt: prompt('a', []) },
      { init: init({ additional_directories: ['C:/t/b'] }), prompt: prompt('a', []) }
    )
    expect(r.cause).toBe('dossiers ajoutés (--add-dir)')
  })

  it('sans trace des consignes, la cause reste inconnue au lieu d’être devinée', () => {
    expect(causeDeLaCassure({ init: init() }, { init: init() }).cause).toBe(
      'inconnue (consignes non tracées)'
    )
  })
})

/**
 * Les étapes d'un run (learn, git…) n'écrivent pas `sessionId` dans leur trace : seul leur argument
 * `--resume` la nomme. Le 2026-11-08, la reprise git après learn (session 95452112) sortait donc en
 * « inconnue (consignes non tracées) » alors que ses deux traces existaient.
 */
describe('traces des étapes de run, reliées par leur --resume', () => {
  const t0 = Date.parse('2026-11-08T05:30:00Z')
  const min = 60_000
  const passage = (debut, fin, extra = {}) => ({
    sessionId: 'sess-run',
    debutMs: t0 + debut * min,
    finMs: t0 + fin * min,
    init: init({ tools: ['Read', 'mcp__autowin__remember'] }),
    ...extra
  })
  const trace = (fin, ref, consigne) => ({
    ts: new Date(t0 + fin * min + 2_000).toISOString(),
    actor: 'subagent',
    systemRef: ref,
    systemBlocks: [
      { name: 'constitution', chars: 100 },
      { name: consigne, chars: 50 }
    ],
    options: { argv: ['-p', '--resume', 'sess-run', '--model', 'opus'] }
  })

  it('nomme la session d’une trace par son --resume quand elle n’a pas d’identifiant', () => {
    expect(sessionDeLaTrace({ sessionId: 'chat-1', options: { argv: [] } })).toBe('chat-1')
    expect(sessionDeLaTrace(trace(0, 'a', 'x'))).toBe('sess-run')
    expect(sessionDeLaTrace({ options: { argv: ['-p'] } })).toBeUndefined()
  })

  it('donne la cause d’une cassure entre learn et git au lieu de « inconnue »', () => {
    const learn = passage(0, 3, { reprise: true, socleCout: { froid: true, ecritureUsd: 0.2 } })
    const git = passage(4, 9, { reprise: true, socleCout: { froid: true, ecritureUsd: 0.44 } })
    const [cassure] = classerCassures({
      sessions: [learn, git],
      traces: [trace(3, 'ref-learn', 'consigne:learn'), trace(9, 'ref-git', 'consigne:git')]
    })
    expect(cassure).toMatchObject({ session: 'sess-run', usd: 0.44 })
    expect(cassure.cause).toBe('consignes : bloc consigne:learn, consigne:git')
  })
})
