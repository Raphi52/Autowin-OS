/**
 * L'INVENTAIRE DES APPELS DE CHAT À REPRENDRE NE BLOQUE PLUS LE CHARGEMENT.
 *
 * Mesure du 2026-09-26T09:30 (gels.jsonl) : 8951 ms de blocage pendant « corps du module terminé »,
 * dont `openSync` 3438 ms remontant à `journalTermineParLaQueue` < `listUnfinishedTurns` <
 * `listRecoverableChatProviderCalls`, appelé en synchrone au chargement de `index.ts`.
 *
 * Deux besoins distincts, deux preuves :
 *  - la liste COMPLÈTE (boucle de reprise, après `whenReady`) ne fait AUCUNE E/S synchrone ;
 *  - la question posée au chargement (« CE tour est-il reprenable ? ») ne lit QUE ce journal-là,
 *    jamais l'arborescence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync as reelMkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    readFileSync: vi.fn(real.readFileSync),
    openSync: vi.fn(real.openSync),
    readdirSync: vi.fn(real.readdirSync),
    statSync: vi.fn(real.statSync),
    existsSync: vi.fn(real.existsSync)
  }
})

const fs = await import('node:fs')
const { listRecoverableChatProviderCallsAsync, recoverableChatProviderCallForTurn } =
  await import('./chat-provider-recovery')

const SYNCHRONES = [fs.readFileSync, fs.openSync, fs.readdirSync, fs.statSync, fs.existsSync]

let root = ''
function ecrire(conv: string, turn: string, evenements: object[]): string {
  reelMkdirSync(join(root, conv), { recursive: true })
  const path = join(root, conv, `${turn}.jsonl`)
  writeFileSync(path, evenements.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  return path
}
function lienProvider(nom: string): object {
  return {
    kind: 'provider-journal',
    provider: 'claude',
    token: `token-${nom}`,
    journalPath: join(root, `${nom}.stdout.jsonl`),
    iteration: 0,
    attempt: 0,
    streamId: '0:0',
    requestId: `request-${nom}`,
    at: 1
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-recovery-async-'))
  // Un tour en vol (reprenable), un tour clos, un tour sans appel provider, un tour dont le CLI a
  // laissé son reçu de sortie.
  ecrire('conv-1', 'en-vol', [lienProvider('en-vol'), { kind: 'delta', text: 'a', at: 2 }])
  ecrire('conv-2', 'clos', [lienProvider('clos'), { kind: 'done', at: 3 }])
  ecrire('conv-3', 'sans-provider', [{ kind: 'delta', text: 'b', at: 2 }])
  ecrire('conv-4', 'certifie', [lienProvider('certifie')])
  writeFileSync(join(root, 'certifie.stdout.jsonl'), '{"type":"assistant"}\n', 'utf8')
  writeFileSync(
    join(root, 'certifie.stdout.jsonl.exit.json'),
    JSON.stringify({ type: 'autowin.survivable-exit', exit_code: 0 }),
    'utf8'
  )
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('inventaire des appels de chat reprenables, non bloquant', () => {
  it('rend les tours reprenables sans aucune E/S synchrone', async () => {
    for (const f of SYNCHRONES) vi.mocked(f).mockClear()

    const calls = await listRecoverableChatProviderCallsAsync(root)

    for (const f of SYNCHRONES) expect(vi.mocked(f)).not.toHaveBeenCalled()
    expect(calls.map((c) => `${c.conversationId}/${c.turnId}`).sort()).toEqual([
      'conv-1/en-vol',
      'conv-4/certifie'
    ])
    expect(calls.find((c) => c.turnId === 'en-vol')).toMatchObject({
      provider: 'claude',
      token: 'token-en-vol',
      streamId: '0:0',
      requestId: 'request-en-vol'
    })
  })

  it('écarte un appel ancien sans reçu terminal, garde celui qui a certifié sa sortie', async () => {
    const plusTard = Date.now() + 3 * 60 * 60_000
    const calls = await listRecoverableChatProviderCallsAsync(root, {
      now: plusTard,
      maxUncertifiedAgeMs: 60 * 60_000
    })
    expect(calls.map((c) => c.turnId)).toEqual(['certifie'])
  })

  it('racine absente : liste vide', async () => {
    expect(await listRecoverableChatProviderCallsAsync(join(root, 'absent'))).toEqual([])
  })
})

describe('question posée au chargement : CE tour est-il reprenable ?', () => {
  it('ne lit que le journal du tour demandé, jamais l’arborescence', () => {
    for (const f of SYNCHRONES) vi.mocked(f).mockClear()

    const call = recoverableChatProviderCallForTurn(root, 'conv-1', 'en-vol')

    expect(call).toMatchObject({
      conversationId: 'conv-1',
      turnId: 'en-vol',
      token: 'token-en-vol'
    })
    expect(vi.mocked(fs.readdirSync)).not.toHaveBeenCalled()
    expect(vi.mocked(fs.openSync)).not.toHaveBeenCalled()
    const lus = vi.mocked(fs.readFileSync).mock.calls.map(([chemin]) => String(chemin))
    expect(lus.every((chemin) => chemin.includes('en-vol'))).toBe(true)
  })

  it('un tour clos, sans appel provider ou sans journal n’est pas reprenable', () => {
    expect(recoverableChatProviderCallForTurn(root, 'conv-2', 'clos')).toBeUndefined()
    expect(recoverableChatProviderCallForTurn(root, 'conv-3', 'sans-provider')).toBeUndefined()
    expect(recoverableChatProviderCallForTurn(root, 'conv-9', 'inconnu')).toBeUndefined()
  })

  it('un identifiant qui ne peut désigner aucun journal répond « non », sans exception', () => {
    // Appelée PENDANT l'hydratation : une exception ici ferait écarter tout le store des
    // conversations comme illisible, pour un seul identifiant de tour abîmé.
    expect(() => recoverableChatProviderCallForTurn(root, 'conv-1', '..')).not.toThrow()
    expect(recoverableChatProviderCallForTurn(root, 'conv-1', '..')).toBeUndefined()
    expect(recoverableChatProviderCallForTurn(root, '..', 'en-vol')).toBeUndefined()
    // Journal présent mais illisible (ici un dossier à son nom) : même réponse, même absence d'erreur.
    reelMkdirSync(join(root, 'conv-5', 'illisible.jsonl'), { recursive: true })
    expect(() => recoverableChatProviderCallForTurn(root, 'conv-5', 'illisible')).not.toThrow()
  })

  it('même verdict que l’inventaire complet pour chaque tour', async () => {
    const complet = await listRecoverableChatProviderCallsAsync(root)
    for (const call of complet) {
      expect(recoverableChatProviderCallForTurn(root, call.conversationId, call.turnId)).toEqual(
        call
      )
    }
  })
})
