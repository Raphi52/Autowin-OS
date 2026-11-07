/**
 * Les clés du coffre arrivent dans l'environnement de CHAQUE agent lancé, par leur nom — sauf celles
 * qui changeraient la connexion du CLI lancé.
 *
 * Le coffre utilisé est le VRAI (`creerCoffre`), sur un fichier temporaire et un chiffrement factice :
 * seule la place du coffre du processus est prise, pour que les lancements le lisent sans Electron.
 * Entrée qui rend ces tests rouges : retirer `envDuCoffre(...)` d'un des quatre moteurs, ou retirer
 * un nom de `EXCLUSIONS_COFFRE`.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Coffre } from '../app/coffre-cles'

const coffreDeTest = vi.hoisted(() => ({ courant: undefined as Coffre | undefined }))

vi.mock('../app/coffre-cles', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../app/coffre-cles')>()
  return {
    ...reel,
    valeursPourAgent: (exclusions: readonly string[]) =>
      coffreDeTest.courant!.valeursPourAgent(exclusions),
    listerCles: () => coffreDeTest.courant!.listerCles()
  }
})

import { creerCoffre } from '../app/coffre-cles'
import { COFFRE_NOMS_ENV, envDuCoffre } from './cles-du-coffre'
import { environnementAgent } from './claude'
import { environnementCodex } from './codex'
import { AgyAdapter } from './agy'
import { GrokAdapter } from './grok'
import { QuestionsACote } from '../chat/question-a-cote'

const MISTRAL = 'valeur-mistral-0123456789'

let dossier: string

let rang = 0

/**
 * Un fichier neuf par coffre : un « coffre vide » ne doit pas relire celui de la préparation. Les clés
 * sont ÉCRITES dans le fichier, pas ajoutées par `ajouterCle` : un coffre rempli avant les règles
 * d'entrée peut contenir AGY_ADC_AUTH ou le jeton de session de Claude Code, et l'injection doit
 * tenir quel que soit son contenu.
 */
function coffreAvec(cles: Record<string, string>): Coffre {
  const fichier = join(dossier, `coffre-${rang++}.bin`)
  const entrees = Object.entries(cles).map(([nom, valeur]) => ({
    nom,
    valeur,
    origine: 'utilisateur',
    ajouteLe: '2026-11-01T00:00:00.000Z'
  }))
  writeFileSync(fichier, JSON.stringify({ version: 1, entrees, ecartees: [] }), 'utf8')
  return creerCoffre({
    chemin: () => fichier,
    chiffrement: () => ({
      isEncryptionAvailable: () => true,
      encryptString: (texte) => Buffer.from(texte, 'utf8'),
      decryptString: (donnees) => donnees.toString('utf8')
    }),
    lireRegistre: () => new Map(),
    env: {}
  })
}

/** Toutes les clés d'authentification connues, le jeton de session de Claude Code, une clé ordinaire. */
const TOUTES = {
  CLAUDE_CODE_MESSAGING_TOKEN: 'valeur-session-claude-0123456789',
  MISTRAL_API_KEY: MISTRAL,
  ANTHROPIC_API_KEY: 'valeur-anthropic-0123456789',
  ANTHROPIC_AUTH_TOKEN: 'valeur-auth-token-0123456789',
  CLAUDE_CODE_OAUTH_TOKEN: 'valeur-oauth-0123456789',
  CODEX_API_KEY: 'valeur-codex-0123456789',
  OPENAI_API_KEY: 'valeur-openai-0123456789',
  GEMINI_API_KEY: 'valeur-gemini-0123456789',
  AGY_ADC_AUTH: 'true',
  XAI_API_KEY: 'valeur-xai-0123456789'
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'autowin-coffre-env-'))
  coffreDeTest.courant = coffreAvec(TOUTES)
})

afterEach(() => {
  coffreDeTest.courant = undefined
  vi.unstubAllEnvs()
  rmSync(dossier, { recursive: true, force: true })
})

/** Un enfant qui rend `sortie` puis se ferme : assez pour qu'un moteur termine son tour. */
function fauxSpawn(sortie: string, envs: NodeJS.ProcessEnv[]) {
  return ((_bin: string, _args: string[], o: { env?: NodeJS.ProcessEnv }) => {
    envs.push(o.env ?? {})
    const enfant = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      kill: () => void
    }
    enfant.stdin = new PassThrough()
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

async function jusquAuBout(tour: AsyncGenerator<unknown, unknown, void>): Promise<void> {
  for (;;) if ((await tour.next()).done) return
}

const nomsInjectes = (env: NodeJS.ProcessEnv): string[] =>
  (env[COFFRE_NOMS_ENV] ?? '').split(',').filter(Boolean)

describe('les quatre moteurs — envDuCoffre', () => {
  it('le jeton de session de Claude Code n’est posé chez aucun agent, même présent au coffre', () => {
    for (const moteur of ['claude', 'codex', 'agy', 'grok'] as const) {
      const env = envDuCoffre(moteur)
      expect(env.MISTRAL_API_KEY, moteur).toBe(MISTRAL)
      expect(env.CLAUDE_CODE_MESSAGING_TOKEN, moteur).toBeUndefined()
      expect(nomsInjectes(env), moteur).not.toContain('CLAUDE_CODE_MESSAGING_TOKEN')
    }
  })
})

describe('Claude (tour, run, nœud) — environnementAgent', () => {
  it('une clé du coffre arrive dans l’env, nommée dans AUTOWIN_COFFRE_NOMS', () => {
    const env = environnementAgent({ PATH: 'x' }, { AUTOWIN_CONVERSATION_ID: 'conv-1' })
    expect(env.MISTRAL_API_KEY).toBe(MISTRAL)
    expect(nomsInjectes(env)).toContain('MISTRAL_API_KEY')
    expect(env.PATH).toBe('x')
    expect(env.AUTOWIN_CONVERSATION_ID).toBe('conv-1')
  })

  it('ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN et CLAUDE_CODE_OAUTH_TOKEN n’arrivent jamais du coffre', () => {
    const env = environnementAgent({ PATH: 'x' })
    // Noms écrits en clair : relire `EXCLUSIONS_COFFRE.claude` rendrait le test aveugle à un retrait.
    for (const nom of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) {
      expect(env[nom]).toBeUndefined()
      expect(nomsInjectes(env)).not.toContain(nom)
    }
    // Celles des autres moteurs ne changent rien à Claude : elles lui restent servies.
    expect(env.XAI_API_KEY).toBe(TOUTES.XAI_API_KEY)
  })

  it('ordre : le coffre l’emporte sur le poste, le run sur le coffre, les garde-fous sur tout', () => {
    const env = environnementAgent(
      { MISTRAL_API_KEY: 'valeur-du-poste', OPENAI_API_KEY: 'valeur-du-poste' },
      { OPENAI_API_KEY: 'valeur-du-run', PAGER: 'less' }
    )
    expect(env.MISTRAL_API_KEY).toBe(MISTRAL)
    expect(env.OPENAI_API_KEY).toBe('valeur-du-run')
    expect(env.PAGER).toBe('cat')
  })

  it('relu à chaque lancement : une clé ajoutée vaut pour l’agent suivant', () => {
    expect(environnementAgent({}).NOUVELLE_API_KEY).toBeUndefined()
    coffreDeTest.courant!.ajouterCle('NOUVELLE_API_KEY', 'valeur-nouvelle-0123456789')
    expect(environnementAgent({}).NOUVELLE_API_KEY).toBe('valeur-nouvelle-0123456789')
  })

  it('coffre vide : environnement strictement inchangé, aucune variable inventée', () => {
    coffreDeTest.courant = coffreAvec({})
    expect(envDuCoffre('claude')).toEqual({})
    expect(environnementCodex({ PATH: 'x' })).toEqual({ PATH: 'x' })
  })
})

describe('question à côté — même environnementAgent, au site d’appel', () => {
  it('le CLI de la question reçoit la clé, sans ANTHROPIC_API_KEY', async () => {
    const appels: SpawnOptions[] = []
    const service = new QuestionsACote({
      catalogue: () => [],
      comptes: () => [{ id: 'default', addedAt: '' }],
      sessions: () => ({ 'conv-1': { key: 'claude:opus:default:D:\\X:c0:w0', sessionId: 's' } }),
      tourEnCours: () => undefined,
      binaire: async () => 'claude.exe',
      ouvrirOutils: (async () => ({})) as never,
      lancer: (_bin, _args, options) => {
        appels.push(options)
        const e = new EventEmitter() as unknown as ChildProcess & EventEmitter
        const stdout = new PassThrough()
        Object.assign(e, { stdin: new PassThrough(), stdout, stderr: new PassThrough() })
        Object.assign(e, { kill: () => true })
        setImmediate(() => {
          stdout.end(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }))
          setImmediate(() => e.emit('close', 0))
        })
        return e
      }
    })
    await service.poser('conv-1', 'q')
    const env = appels[0]!.env as NodeJS.ProcessEnv
    expect(env.MISTRAL_API_KEY).toBe(MISTRAL)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe('Codex — environnementCodex', () => {
  it('la clé arrive, CODEX_API_KEY et OPENAI_API_KEY non (elles feraient payer à la clé)', () => {
    const env = environnementCodex({ PATH: 'x' }, { AUTOWIN_CONVERSATION_ID: 'conv-1' })
    expect(env.MISTRAL_API_KEY).toBe(MISTRAL)
    expect(env.AUTOWIN_CONVERSATION_ID).toBe('conv-1')
    expect(env.CODEX_API_KEY).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(nomsInjectes(env)).not.toContain('OPENAI_API_KEY')
  })
})

describe('Agy — env du processus lancé', () => {
  it('la clé arrive, GEMINI_API_KEY et AGY_ADC_AUTH non', async () => {
    const envs: NodeJS.ProcessEnv[] = []
    const sortie = '{"event":"result","result":{"status":"SUCCESS","response":"ok"}}'
    const agy = new AgyAdapter({ bin: () => 'agy.exe', spawnFn: fauxSpawn(sortie, envs) })
    await jusquAuBout(agy.send([{ role: 'user', content: 'q' }]))
    expect(envs[0]!.MISTRAL_API_KEY).toBe(MISTRAL)
    expect(envs[0]!.GEMINI_API_KEY).toBeUndefined()
    expect(envs[0]!.AGY_ADC_AUTH).toBeUndefined()
    expect(envs[0]!.PATH ?? envs[0]!.Path).toBeDefined()
  })
})

describe('Grok — env du processus lancé', () => {
  it('la clé arrive ; XAI_API_KEY n’arrive ni du coffre ni du poste (envSansCleXai en dernier)', async () => {
    vi.stubEnv('XAI_API_KEY', 'valeur-xai-du-poste')
    const envs: NodeJS.ProcessEnv[] = []
    const sortie = '{"type":"text","data":"ok"}\n{"type":"end","stopReason":"end_turn"}'
    const grok = new GrokAdapter({ bin: () => 'grok.exe', spawnFn: fauxSpawn(sortie, envs) })
    await jusquAuBout(grok.send([{ role: 'user', content: 'q' }]))
    expect(envs[0]!.MISTRAL_API_KEY).toBe(MISTRAL)
    expect(envs[0]!.XAI_API_KEY).toBeUndefined()
    expect(nomsInjectes(envs[0]!)).not.toContain('XAI_API_KEY')
  })
})
