import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  GROK_CONNEXION_REQUISE,
  GrokAdapter,
  envSansCleXai,
  lireLigneGrok,
  modelesGrok,
  resolveGrokBin
} from './grok'
import { planProviderLogin } from '../provider-login'

// Sortie RÉELLE de grok 1.0.70 sans connexion (mesurée le 2026-11-04, conv-1499).
const PAS_CONNECTE =
  '{"type":"error","message":"Not signed in. To authenticate without a browser, run:\\n  grok login --device-code\\n\\nAlternatively, set the XAI_API_KEY environment variable or run `grok login` on a machine with a browser."}'

// Forme documentée (~/.grok/docs/user-guide/14-headless-mode.md, grok 1.0.70).
const NOMINAL = [
  '{"type":"thought","data":"je réfléchis"}',
  '{"type":"text","data":"Bon"}',
  '{"type":"text","data":"jour"}',
  '{"type":"usage","messageId":"r1","stopReason":"end_turn","usage":{"input_tokens":5,"output_tokens":2}}',
  '{"type":"end","stopReason":"end_turn","sessionId":"s1","usage":{"input_tokens":5,"output_tokens":2},"num_turns":1}'
].join('\n')

interface Appel {
  args: string[]
  env?: NodeJS.ProcessEnv
  prompt?: string
}

function fauxSpawn(sortie: string, appels: Appel[] = []) {
  return ((_bin: string, args: string[], o: { env?: NodeJS.ProcessEnv }) => {
    const i = args.indexOf('--prompt-file')
    const chemin = i >= 0 ? args[i + 1] : undefined
    appels.push({
      args,
      env: o.env,
      prompt: chemin && existsSync(chemin) ? readFileSync(chemin, 'utf8') : undefined
    })
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

async function jouer(sortie: string, contenu = 'salut', appels: Appel[] = []) {
  const g = new GrokAdapter({ bin: () => 'grok.exe', spawnFn: fauxSpawn(sortie, appels) }).send([
    { role: 'user', content: contenu }
  ])
  const deltas: string[] = []
  for (;;) {
    const r = await g.next()
    if (r.done) return { deltas, resultat: r.value }
    deltas.push(r.value.delta)
  }
}

describe('grok', () => {
  it('cas nominal : texte en flux, réflexion ignorée, fin → un seul message', async () => {
    const { deltas, resultat } = await jouer(NOMINAL)
    expect(deltas.join('')).toBe('Bonjour')
    expect(resultat.text).toBe('Bonjour')
    expect(resultat.sessionId).toBe('s1')
    expect(resultat.usage).toEqual({ inputTokens: 5, outputTokens: 2 })
  })

  it('pas connecté (sortie réelle) : échec immédiat avec le message de connexion', async () => {
    await expect(jouer(PAS_CONNECTE)).rejects.toThrow(GROK_CONNEXION_REQUISE)
  })

  it('sortie vide : échec clair, pas de blocage', async () => {
    await expect(jouer('')).rejects.toThrow(/sans rendre de résultat/)
  })

  it('ligne coupée ou non JSON : ignorée', () => {
    expect(lireLigneGrok('{"type":')).toEqual({ kind: 'ignore' })
    expect(lireLigneGrok('Error: x')).toEqual({ kind: 'ignore' })
  })

  it('long fil : le prompt part dans un fichier, jamais en argument (ENAMETOOLONG)', async () => {
    const appels: Appel[] = []
    const long = 'x'.repeat(40_000)
    await jouer(NOMINAL, long, appels)
    expect(appels[0].args.join(' ').length).toBeLessThan(400)
    expect(appels[0].prompt).toContain(long)
  })

  it("abonnement seulement : XAI_API_KEY n'est jamais transmise à grok", async () => {
    expect(envSansCleXai({ XAI_API_KEY: 'k', PATH: 'p' })).toEqual({ PATH: 'p' })
    const appels: Appel[] = []
    await jouer(NOMINAL, 'q', appels)
    expect(appels[0].env).toBeDefined()
    expect(appels[0].env?.XAI_API_KEY).toBeUndefined()
  })

  it('connexion : `grok login` avec le chemin résolu', () => {
    expect(planProviderLogin('grok', 'C:\\g\\grok.exe').command).toBe('& "C:\\g\\grok.exe" login')
  })

  it('programme absent : moteur non prêt, aucun modèle', async () => {
    expect(await new GrokAdapter({ bin: () => undefined }).auth()).toBe(false)
    expect(modelesGrok(() => undefined)).toEqual([])
    expect(resolveGrokBin({ USERPROFILE: 'X:\\rien', PATH: '' }, () => false)).toBeUndefined()
  })
})
