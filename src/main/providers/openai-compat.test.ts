import { describe, expect, it, vi } from 'vitest'

const noterQuota = vi.hoisted(() => vi.fn())
vi.mock('../model-quotas', () => ({ noterQuotaServiceHttp: noterQuota }))
import { OpenAICompatAdapter, type OutilAgent } from './openai-compat'
import type { SendResult, StreamChunk } from './types'

/** Corps JSON envoyé au service, tel que le test le relit. */
interface CorpsEnvoye {
  messages: Array<Record<string, unknown>>
  tools?: Array<{ function: { name: string } }>
}

function sse(evts: unknown[]): Response {
  const corps = evts.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(corps, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

async function vider(gen: AsyncGenerator<StreamChunk, SendResult, void>) {
  const chunks: StreamChunk[] = []
  for (;;) {
    const r = await gen.next()
    if (r.done) return { chunks, result: r.value }
    chunks.push(r.value)
  }
}

describe('OpenAICompatAdapter — moteur HTTP sans CLI', () => {
  it('streame le texte, envoie la clé et le système', async () => {
    const corps: CorpsEnvoye[] = []
    const entetes: Array<Record<string, string>> = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      corps.push(JSON.parse(String(init.body)) as CorpsEnvoye)
      entetes.push(Object.fromEntries(new Headers(init.headers)))
      return sse([
        { model: 'llama-3.3', choices: [{ delta: { content: 'Bon' } }] },
        { choices: [{ delta: { content: 'jour' } }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }
      ])
    })
    const a = new OpenAICompatAdapter({ id: 'groq', baseUrl: 'https://x/v1/', apiKeyEnv: 'K', defaultModel: 'm', fetchImpl, env: { K: 'secret' } })
    const { chunks, result } = await vider(a.send([{ role: 'user', content: 'salut' }], { system: 'SOUL' }))
    expect(chunks.map((c) => c.delta).join('')).toBe('Bonjour')
    expect(result).toMatchObject({ text: 'Bonjour', provider: 'groq', systemInjected: true, model: 'llama-3.3', usage: { inputTokens: 12, outputTokens: 3 } })
    expect(corps[0].messages[0]).toEqual({ role: 'system', content: 'SOUL' })
    expect(corps[0].tools).toBeUndefined()
    expect(entetes[0].authorization).toBe('Bearer secret')
    // Depuis conv-1502, le moteur porte ses outils du dossier du run : il exécute ; `false` le rend chat pur.
    expect(a.supportsExecution).toBe(true)
    expect(new OpenAICompatAdapter({ id: 'g', baseUrl: 'https://x/v1', defaultModel: 'm', outilsDuDossier: false }).supportsExecution).toBe(false)
  })

  it('mène la boucle d’agent : appel d’outil fragmenté, exécution, réponse finale', async () => {
    const corps: CorpsEnvoye[] = []
    const reponses = [
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'lire', arguments: '{"chem' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'in":"a.txt"}' } }] } }] }
      ]),
      sse([{ choices: [{ delta: { content: 'Le fichier dit hello' } }] }])
    ]
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      corps.push(JSON.parse(String(init.body)) as CorpsEnvoye)
      return reponses.shift()!
    })
    const vus: unknown[] = []
    const lire: OutilAgent = {
      nom: 'lire',
      description: 'lit un fichier',
      parametres: { type: 'object', properties: { chemin: { type: 'string' } } },
      executer: async (args) => {
        vus.push(args)
        return 'hello'
      }
    }
    const a = new OpenAICompatAdapter({ id: 'ollama', baseUrl: 'http://localhost:11434/v1', defaultModel: 'qwen3', outils: [lire], fetchImpl })
    const { result } = await vider(a.send([{ role: 'user', content: 'lis a.txt' }]))
    expect(vus).toEqual([{ chemin: 'a.txt' }])
    expect(result.text).toBe('Le fichier dit hello')
    expect(corps[0].tools?.[0]?.function.name).toBe('lire')
    expect(corps[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'hello' })
    expect(a.supportsExecution).toBe(true)
  })

  it('refuse sans clé quand le service en exige une', async () => {
    const a = new OpenAICompatAdapter({ id: 'gemini', baseUrl: 'https://g', apiKeyEnv: 'GEMINI_API_KEY', defaultModel: 'm', env: {} })
    expect(await a.auth()).toBe(false)
    await expect(vider(a.send([{ role: 'user', content: 'x' }]))).rejects.toThrow(/GEMINI_API_KEY/)
  })

  it('jumeau accepté : un service local sans clé est prêt', async () => {
    const a = new OpenAICompatAdapter({ id: 'ollama', baseUrl: 'http://l', defaultModel: 'm', env: {} })
    expect(await a.auth()).toBe(true)
  })

  it('rend l’erreur HTTP lisible et arrête une boucle infinie', async () => {
    const ko = new OpenAICompatAdapter({ id: 'g', baseUrl: 'http://l', defaultModel: 'm', fetchImpl: (async () => new Response('quota', { status: 429 })) })
    await expect(vider(ko.send([{ role: 'user', content: 'x' }]))).rejects.toThrow(/HTTP 429 quota/)
    const boucle = new OpenAICompatAdapter({
      id: 'g', baseUrl: 'http://l', defaultModel: 'm', maxEtapes: 2,
      outils: [{ nom: 't', description: '', parametres: {}, executer: async () => 'ok' }],
      fetchImpl: (async () => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 't', arguments: '{}' } }] } }] }]))
    })
    await expect(vider(boucle.send([{ role: 'user', content: 'x' }]))).rejects.toThrow(/2 étapes/)
  })

  it('note le quota du service après chaque réponse HTTP, refus 429 compris', async () => {
    noterQuota.mockClear()
    const ok = new OpenAICompatAdapter({ id: 'api-groq', baseUrl: 'http://l', defaultModel: 'm', fetchImpl: (async () => sse([{ choices: [{ delta: { content: 'x' } }] }])) })
    await vider(ok.send([{ role: 'user', content: 'q' }]))
    expect(noterQuota).toHaveBeenCalledTimes(1)
    expect(noterQuota.mock.calls[0][0]).toBe('api-groq')
    const ko = new OpenAICompatAdapter({ id: 'api-gemini', baseUrl: 'http://l', defaultModel: 'm', fetchImpl: (async () => new Response('quota', { status: 429, headers: { 'x-ratelimit-remaining-requests': '0' } })) })
    await expect(vider(ko.send([{ role: 'user', content: 'q' }]))).rejects.toThrow(/429/)
    expect(noterQuota).toHaveBeenCalledTimes(2)
    expect(noterQuota.mock.calls[1][0]).toBe('api-gemini')
    expect(noterQuota.mock.calls[1][1].get('x-ratelimit-remaining-requests')).toBe('0')
  })
})
