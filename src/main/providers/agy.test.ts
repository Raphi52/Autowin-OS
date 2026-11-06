import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AGY_CONNEXION_REQUISE, AgyAdapter, lireLigneAgy, modelesAgy, resolveAgyBin } from './agy'
import { planProviderLogin } from './provider-login'

// Sortie RÉELLE d'agy 1.5.0 sans connexion (mesurée le 2026-11-04, conv-1499).
const ERREUR_CONNEXION =
  '{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"authentication failed or timed out","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0},"finished_reason":"error"}}'

function fauxSpawn(sortie: string, args: string[][] = []) {
  return ((_bin: string, a: string[]) => {
    args.push(a)
    const enfant = new EventEmitter() as EventEmitter & {
      stdout: PassThrough
      stderr: PassThrough
      kill: () => void
    }
    enfant.stdout = new PassThrough()
    enfant.stderr = new PassThrough()
    enfant.kill = () => undefined
    setImmediate(() => {
      enfant.stdout.end(sortie)
      setImmediate(() => enfant.emit('close', 0))
    })
    return enfant
  }) as never
}

async function jouer(sortie: string) {
  const a = new AgyAdapter({ bin: () => 'agy.exe', spawnFn: fauxSpawn(sortie) })
  const g = a.send([{ role: 'user', content: 'salut' }])
  const deltas: string[] = []
  for (;;) {
    const r = await g.next()
    if (r.done) return { deltas, resultat: r.value }
    deltas.push(r.value.delta)
  }
}

describe('agy', () => {
  it('cas nominal : texte en flux puis résultat → un seul message', async () => {
    const { deltas, resultat } = await jouer(
      '{"event":"message","text":"Bon"}\n{"event":"message","text":"jour"}\n' +
        '{"event":"result","result":{"conversation_id":"c1","status":"SUCCESS","response":"Bonjour","usage":{"input_tokens":3,"output_tokens":2}}}\n'
    )
    expect(deltas.join('')).toBe('Bonjour')
    expect(resultat.text).toBe('Bonjour')
    expect(resultat.sessionId).toBe('c1')
    expect(resultat.usage).toEqual({ inputTokens: 3, outputTokens: 2 })
  })

  it('résultat sans flux préalable : le texte final est rendu', async () => {
    const { deltas, resultat } = await jouer(
      '{"event":"result","result":{"status":"SUCCESS","response":"OK"}}'
    )
    expect(deltas.join('')).toBe('OK')
    expect(resultat.text).toBe('OK')
  })

  it('non connecté (sortie réelle) : échec immédiat avec le message de connexion', async () => {
    await expect(jouer(ERREUR_CONNEXION + '\n')).rejects.toThrow(AGY_CONNEXION_REQUISE)
  })

  it('« Authentication required » : échec sans attendre la fin du délai de 60 s', async () => {
    await expect(
      jouer('Authentication required. Please visit the URL to log in:\n')
    ).rejects.toThrow(AGY_CONNEXION_REQUISE)
  })

  it('autre erreur : son détail remonte', async () => {
    await expect(
      jouer('{"event":"result","result":{"status":"ERROR","error":"quota"}}\n')
    ).rejects.toThrow('agy : quota')
  })

  it('sortie vide ou coupée sans résultat : erreur claire, pas de gel', async () => {
    await expect(jouer('')).rejects.toThrow('sans rendre de résultat')
    await expect(jouer('{"event":"res')).rejects.toThrow('sans rendre de résultat')
  })

  it('lignes vides, non JSON ou coupées sont ignorées', () => {
    expect(lireLigneAgy('')).toEqual({ kind: 'ignore' })
    expect(lireLigneAgy('Waiting for authentication')).toEqual({ kind: 'ignore' })
    expect(lireLigneAgy('{"event":')).toEqual({ kind: 'ignore' })
  })

  it('modèle "default" : pas de --model ; modèle nommé : --model', async () => {
    const args: string[][] = []
    const ok = '{"event":"result","result":{"status":"SUCCESS","response":"x"}}'
    for (const model of ['default', 'gemini-3-pro']) {
      const g = new AgyAdapter({ bin: () => 'agy.exe', spawnFn: fauxSpawn(ok, args) }).send(
        [{ role: 'user', content: 'q' }],
        { model }
      )
      while (!(await g.next()).done) {
        /* vide */
      }
    }
    expect(args[0]).not.toContain('--model')
    expect(args[1]).toEqual(expect.arrayContaining(['--model', 'gemini-3-pro']))
  })

  it('long fil : le prompt part par stdin, jamais en argument (spawn ENAMETOOLONG, conv-1499)', async () => {
    const args: string[][] = []
    const recu: string[] = []
    const base = fauxSpawn('{"event":"result","result":{"status":"SUCCESS","response":"x"}}', args)
    const spawnFn = ((b: string, a: string[]) => {
      const e = (base as unknown as (b: string, a: string[]) => Record<string, unknown>)(b, a)
      const stdin = new PassThrough()
      stdin.on('data', (d: Buffer) => recu.push(String(d)))
      e.stdin = stdin
      return e
    }) as never
    const long = 'x'.repeat(40_000)
    const g = new AgyAdapter({ bin: () => 'agy.exe', spawnFn }).send([{ role: 'user', content: long }])
    while (!(await g.next()).done) {
      /* vide */
    }
    expect(args[0].join(' ').length).toBeLessThan(200)
    expect(args[0]).toEqual(expect.arrayContaining(['--input-format', 'stream-json']))
    const ligne = JSON.parse(recu.join('').trim())
    expect(ligne.event).toBe('user') // forme exigée par agy 1.5.0 (mesuré, conv-1499)
    expect(ligne.message.content).toContain(long)
  })

  it('sortie RÉELLE connectée : le texte se lit en flux (step_update.text_delta)', async () => {
    const reelle = [
      '{"event":"step_update","step_update":{"step_index":0,"state":"DONE","step_type":"user_input"}}',
      '{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"OK"}}',
      '{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"\\n"}}',
      '{"event":"result","result":{"status":"SUCCESS","response":"OK\\n","num_turns":1}}'
    ].join('\n')
    expect(lireLigneAgy(reelle.split('\n')[1])).toEqual({ kind: 'texte', texte: 'OK' })
    expect(lireLigneAgy(reelle.split('\n')[0])).toEqual({ kind: 'ignore' })
    const { deltas } = await jouer(reelle)
    expect(deltas.join('')).toBe('OK\n')
  })

  it('programme absent : moteur non prêt, aucun modèle, pas de plantage', async () => {
    expect(await new AgyAdapter({ bin: () => undefined }).auth()).toBe(false)
    expect(modelesAgy(() => undefined)).toEqual([])
    expect(resolveAgyBin({ LOCALAPPDATA: 'X:\\rien', PATH: '' }, () => false)).toBeUndefined()
  })

  it('programme présent à l’emplacement de l’installeur : trouvé hors PATH', () => {
    expect(
      resolveAgyBin({ LOCALAPPDATA: 'C:\\L', PATH: '' }, (p) => p === 'C:\\L\\agy\\bin\\agy.exe')
    ).toBe('C:\\L\\agy\\bin\\agy.exe')
    expect(modelesAgy(() => 'agy.exe')[0].provider).toBe('agy')
  })

  it('connexion : agy.exe lancé sans argument', () => {
    expect(planProviderLogin('agy', 'C:\\L\\agy.exe').command).toBe('& "C:\\L\\agy.exe"')
  })
})
