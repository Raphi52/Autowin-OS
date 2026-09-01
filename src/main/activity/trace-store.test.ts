import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { installTraceEventSink, rebaseTraceSequence, TraceStore } from './trace-store'
import type { TraceEventV1 } from './trace-event'

function event(id: string, sequence: number, content = id): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    parentId: sequence ? `evt-${sequence - 1}` : undefined,
    timestamp: new Date(1_000 + sequence).toISOString(),
    sequence,
    type: 'message',
    status: 'completed',
    actor: { id: 'human', kind: 'human', label: 'Vous' },
    recipient: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    channel: 'user',
    payloads: [{ kind: 'user-message', content }],
    observation: { boundary: 'renderer', fidelity: 'exact' }
  }
}

describe('TraceStore append-only', () => {
  it('persiste et relit dans l’ordre après une nouvelle instance', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-'))
    new TraceStore(root).append(event('evt-0', 0)).append(event('evt-1', 1, 'x'.repeat(12_000)))

    const reloaded = new TraceStore(root).readConversation('conv-1')
    expect(reloaded.map((item) => item.id)).toEqual(['evt-0', 'evt-1'])
    expect(reloaded[1].payloads[0].content).toHaveLength(12_000)
    expect(
      readFileSync(join(root, 'conv-1.jsonl'), 'utf8').split('\n').filter(Boolean)
    ).toHaveLength(2)
  })

  it('notifie un sink optionnel après la persistance sans lui permettre de casser le journal', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-sink-'))
    const seen: string[] = []
    const removeSink = installTraceEventSink((item) => {
      seen.push(item.id)
      throw new Error('collecteur hors ligne')
    })

    try {
      expect(() => new TraceStore(root).append(event('evt-0', 0))).not.toThrow()
      expect(seen).toEqual(['evt-0'])
      expect(new TraceStore(root).readConversation('conv-1')).toHaveLength(1)
    } finally {
      removeSink()
    }
  })

  it('refuse un identifiant dupliqué sans modifier le journal', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-'))
    const store = new TraceStore(root).append(event('evt-0', 0))
    expect(() => store.append(event('evt-0', 0))).toThrow(/dupliqué/)
    expect(store.readConversation('conv-1')).toHaveLength(1)
  })

  it('refuse une sequence non monotone et un parent orphelin', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-integrity-'))
    const store = new TraceStore(root).append(event('evt-0', 0))
    expect(() => store.append({ ...event('evt-other', 0), parentId: undefined })).toThrow(
      /sequence non monotone/
    )
    expect(() => store.append({ ...event('evt-1', 1), parentId: 'absent' })).toThrow(
      /parent causal introuvable/
    )
    expect(store.readConversation('conv-1')).toHaveLength(1)
  })

  it('exporte, importe et supprime explicitement une conversation', () => {
    const source = mkdtempSync(join(tmpdir(), 'autowin-trace-source-'))
    const target = mkdtempSync(join(tmpdir(), 'autowin-trace-target-'))
    const exported = new TraceStore(source).append(event('evt-0', 0)).exportConversation('conv-1')
    const imported = new TraceStore(target)
    imported.importConversation(exported)
    expect(imported.readConversation('conv-1')).toEqual([event('evt-0', 0)])
    expect(imported.deleteConversation('conv-1')).toBe(true)
    expect(imported.readConversation('conv-1')).toEqual([])
  })

  it('ignore une dernière ligne incomplète après crash mais pas un événement invalide', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-'))
    const store = new TraceStore(root).append(event('evt-0', 0))
    appendFileSync(join(root, 'conv-1.jsonl'), '{"schema":"autowin.trace/v1"', 'utf8')
    expect(store.readConversation('conv-1')).toEqual([event('evt-0', 0)])
  })
  it('signale une corruption au milieu du journal au lieu de supprimer une etape', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-corrupt-'))
    const path = join(root, 'conv-1.jsonl')
    appendFileSync(
      path,
      `${JSON.stringify(event('evt-0', 0))}\n{invalide}\n${JSON.stringify(event('evt-1', 1))}\n`,
      'utf8'
    )
    expect(() => new TraceStore(root).readConversation('conv-1')).toThrow(/trace corrompue ligne 2/)
  })
  it('offre aux vues derivees une lecture partielle sans affaiblir la lecture canonique', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-derived-'))
    const path = join(root, 'conv-1.jsonl')
    appendFileSync(
      path,
      `${JSON.stringify(event('evt-0', 0))}\n${JSON.stringify({ schema: 'autowin.trace/v1' })}\n${JSON.stringify(event('evt-1', 1))}\n`,
      'utf8'
    )
    const store = new TraceStore(root)

    expect(() => store.readConversation('conv-1')).toThrow(/trace corrompue ligne 2/)
    expect(store.readConversationBestEffort('conv-1').map((item) => item.id)).toEqual([
      'evt-0',
      'evt-1'
    ])
  })
  it('absorbe 1 000 evenements sans bloquer une interaction', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-volume-'))
    const store = new TraceStore(root)
    const durations: number[] = []

    for (let index = 0; index < 1_000; index += 1) {
      const startedAt = performance.now()
      store.append(event(`evt-${index}`, index, `payload-${index}`))
      durations.push(performance.now() - startedAt)
    }

    durations.sort((a, b) => a - b)
    const p95 = durations[Math.floor(durations.length * 0.95)]
    const readStartedAt = performance.now()
    const reloaded = new TraceStore(root).readConversation('conv-1')
    const readDuration = performance.now() - readStartedAt

    expect(reloaded).toHaveLength(1_000)
    expect(reloaded[999].payloads[0].content).toBe('payload-999')
    expect(p95).toBeLessThan(50)
    expect(readDuration).toBeLessThan(100)
  })

  it('conserve un payload exact de 10 Mo', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-large-'))
    const payload = 'x'.repeat(10 * 1024 * 1024)
    const store = new TraceStore(root).append(event('evt-0', 0, payload))

    expect(store.readConversation('conv-1')[0].payloads[0].content).toBe(payload)
  })
  it('reprend la prochaine sequence apres reouverture', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-next-'))
    new TraceStore(root).append({ ...event('evt-0', 7), parentId: undefined })
    expect(new TraceStore(root).nextSequence('conv-1')).toBe(8)
  })

  it('rebase un producteur reste en attente pendant qu un run imbrique avance la trace', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-rebase-'))
    const chatWriter = new TraceStore(root)
    const runWriter = new TraceStore(root)

    chatWriter.append(event('evt-0', 0))
    let chatSequence = 1
    runWriter.append(event('evt-1', 1)).append(event('evt-2', 2))

    chatSequence = rebaseTraceSequence(chatWriter, 'conv-1', chatSequence)

    expect(chatSequence).toBe(3)
    expect(() =>
      chatWriter.append({ ...event('evt-3', chatSequence), parentId: 'evt-0' })
    ).not.toThrow()
  })

  it('reserve atomiquement des sequences distinctes entre deux stores deja chauds', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-reservation-'))
    const first = new TraceStore(root)
    const second = new TraceStore(root)
    first.append(event('evt-0', 0))

    const firstSequence = first.nextSequence('conv-1')
    const secondSequence = second.nextSequence('conv-1')
    expect([firstSequence, secondSequence]).toEqual([1, 2])

    first.append({ ...event('evt-1', firstSequence), parentId: 'evt-0' })
    second.append({ ...event('evt-2', secondSequence), parentId: 'evt-1' })
    expect(second.readConversation('conv-1').map(({ sequence }) => sequence)).toEqual([0, 1, 2])
  })

  it('reserve des sequences distinctes entre deux processus separes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-process-reservation-'))
    const barrier = join(root, 'start')
    new TraceStore(root).append(event('evt-0', 0))
    const script = [
      "import { TraceStore } from './src/main/activity/trace-store.ts'",
      "import { existsSync } from 'node:fs'",
      "import { setTimeout as delay } from 'node:timers/promises'",
      'while (!existsSync(process.argv[2])) await delay(2)',
      "process.stdout.write(String(new TraceStore(process.argv[1]).nextSequence('conv-1')))"
    ].join(';')
    const reserve = (): Promise<number> =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '--eval', script, root, barrier],
          { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
        )
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => (stdout += String(chunk)))
        child.stderr.on('data', (chunk) => (stderr += String(chunk)))
        child.on('error', reject)
        child.on('close', (code) =>
          code === 0 ? resolve(Number(stdout)) : reject(new Error(stderr || `child exit ${code}`))
        )
      })

    const first = reserve()
    const second = reserve()
    writeFileSync(barrier, 'go', 'utf8')
    expect((await Promise.all([first, second])).sort((a, b) => a - b)).toEqual([1, 2])
  })

  /*
   * GARDE DE COUT DE RELECTURE (gels du 2026-09-01).
   *
   * `readConversation` relisait et reparsait le fichier ENTIER a chaque appel, sur le thread main.
   * Sur `conv-54.jsonl` (5,6 Mo), un appel coute 25 a 128 ms (mesure). Ce test borne ce COUT ; il ne
   * pretend pas que la repetition explique a elle seule les gels de 1,4 s -> 4,4 s de gels.jsonl —
   * la frequence d'appel par tour n'est pas instrumentee, et les pics de 25 a 44 s ont une autre
   * cause deja documentee ici (verrou de sequence orphelin, plus haut dans ce fichier).
   *
   * Entree qui ferait echouer ce test si la correction etait fausse : l'append EXTERNE de
   * `evt-200` ci-dessous. Un cache qui se contenterait de memoriser le premier resultat passerait
   * la borne d'octets mais RATERAIT cet evenement — l'assertion sur les identifiants apres append
   * externe est la sonde de ce faux vert.
   */
  it('ne reparse pas tout le journal a chaque relecture et voit quand meme un append externe', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-read-cache-'))
    const writer = new TraceStore(root)
    for (let index = 0; index < 200; index += 1) writer.append(event(`evt-${index}`, index))

    const reader = new TraceStore(root)
    expect(reader.readConversation('conv-1')).toHaveLength(200)
    const warmupBytes = reader.readScanBytes
    expect(warmupBytes).toBeGreaterThan(10_000)

    for (let tour = 0; tour < 10; tour += 1)
      expect(reader.readConversation('conv-1')).toHaveLength(200)
    expect(reader.readScanBytes).toBe(warmupBytes)

    appendFileSync(
      join(root, 'conv-1.jsonl'),
      `${JSON.stringify(event('evt-200', 200))}
`
    )
    const apres = reader.readConversation('conv-1')
    expect(apres.at(-1)?.id).toBe('evt-200')
    expect(apres).toHaveLength(201)
    expect(reader.readScanBytes - warmupBytes).toBeLessThan(2_000)
  })

  it('garde la lecture des vues derivees incrementale sans avaler un append externe', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-read-cache-vue-'))
    const writer = new TraceStore(root)
    for (let index = 0; index < 200; index += 1) writer.append(event(`evt-${index}`, index))

    const reader = new TraceStore(root)
    expect(reader.readConversationBestEffort('conv-1')).toHaveLength(200)
    const warmupBytes = reader.readScanBytes
    expect(reader.readConversationBestEffort('conv-1')).toHaveLength(200)
    expect(reader.readScanBytes).toBe(warmupBytes)

    appendFileSync(
      join(root, 'conv-1.jsonl'),
      `${JSON.stringify(event('evt-200', 200))}
`
    )
    expect(reader.readConversationBestEffort('conv-1').at(-1)?.id).toBe('evt-200')
    expect(reader.readScanBytes - warmupBytes).toBeLessThan(2_000)
  })

  it('signale encore la corruption a sa ligne absolue apres une relecture en cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-read-cache-corrupt-'))
    const path = join(root, 'conv-1.jsonl')
    const store = new TraceStore(root)
    store.append(event('evt-0', 0))
    expect(store.readConversation('conv-1')).toHaveLength(1)

    appendFileSync(
      path,
      `{invalide}
${JSON.stringify(event('evt-1', 1))}
`,
      'utf8'
    )
    expect(() => store.readConversation('conv-1')).toThrow(/trace corrompue ligne 2/)
    expect(store.readConversationBestEffort('conv-1').map((item) => item.id)).toEqual([
      'evt-0',
      'evt-1'
    ])
  })

  it('ne sert pas un cache perime quand le journal est reecrit plus court', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-read-cache-tronque-'))
    const path = join(root, 'conv-1.jsonl')
    const store = new TraceStore(root)
    store.append(event('evt-0', 0)).append(event('evt-1', 1))
    expect(store.readConversation('conv-1')).toHaveLength(2)

    writeFileSync(
      path,
      `${JSON.stringify(event('evt-9', 9))}
`,
      'utf8'
    )
    expect(store.readConversation('conv-1').map((item) => item.id)).toEqual(['evt-9'])
  })

  it('ne relit pas tout le journal apres warmup et ne scanne que l append externe', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-sequence-cache-'))
    const writer = new TraceStore(root)
    for (let index = 0; index < 200; index += 1) writer.append(event(`evt-${index}`, index))

    const reader = new TraceStore(root)
    expect(reader.nextSequence('conv-1')).toBe(200)
    const warmupBytes = reader.sequenceScanBytes
    expect(warmupBytes).toBeGreaterThan(10_000)

    expect(reader.nextSequence('conv-1')).toBe(201)
    expect(reader.sequenceScanBytes).toBe(warmupBytes)

    appendFileSync(join(root, 'conv-1.jsonl'), `${JSON.stringify(event('evt-200', 200))}\n`)
    expect(reader.nextSequence('conv-1')).toBe(202)
    expect(reader.sequenceScanBytes - warmupBytes).toBeLessThan(2_000)
  })
})

/*
 * NON-REGRESSION DU GEL DU 2026-08-31.
 *
 * `reserveSequence` attend le verrou par `Atomics.wait` SUR LE THREAD APPELANT — le main. Un `.lock`
 * orphelin (processus tue pendant un run) n'etait reclame qu'apres STALE_SEQUENCE_LOCK_MS = 30 000 ms :
 * chaque ecriture de trace attendait alors les 2 000 ms de son budget puis JETAIT
 * « allocation de sequence verrouillee trop longtemps », fenetre gelee pendant tout ce temps —
 * signature des sept gels de 25 a 44 s du journal. Le cadavre est desormais reclame au bout d'un
 * budget d'acquisition : l'ecriture aboutit au lieu d'echouer, et l'attente est bornee.
 */
describe('verrou de sequence orphelin', () => {
  it('reclame un .lock abandonne et ecrit, au lieu de geler puis jeter', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-verrou-orphelin-'))
    writeFileSync(join(root, '.conv-1.sequence.lock'), '', 'utf8')
    const store = new TraceStore(root)
    store.append(event('evt-0', 0))
    const depart = performance.now()
    const suivante = store.nextSequence('conv-1')
    const dureeMs = performance.now() - depart
    expect(suivante).toBe(1)
    expect(dureeMs).toBeLessThan(1_500)
  })
})

/*
 * NON-REGRESSION DE LA FUITE DE DESCRIPTEURS.
 *
 * `append` gardait un descripteur ouvert PAR conversation, sans borne et sans jamais le refermer
 * hors `deleteConversation`. Sur l'installation de l'utilisateur, le dossier d'activite compte
 * 1 472 conversations : une session longue accumulait autant de handles, jusqu'au EMFILE. Le cache
 * est desormais borne ; ecrire dans beaucoup de conversations puis revenir sur la premiere doit
 * rester correct — le descripteur referme se rouvre tout seul.
 */
describe('descripteurs de trace bornes', () => {
  it('ecrit dans 200 conversations puis revient sur la premiere sans rien perdre', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-descripteurs-'))
    const store = new TraceStore(root)
    for (let i = 0; i < 200; i += 1)
      store.append({ ...event(`evt-a-${i}`, 0), conversationId: `conv-${i}`, parentId: undefined })
    store.append({ ...event('evt-b-0', 1), conversationId: 'conv-0', parentId: 'evt-a-0' })
    expect(store.readConversation('conv-0').map((e) => e.id)).toEqual(['evt-a-0', 'evt-b-0'])
    expect(store.readConversation('conv-199').map((e) => e.id)).toEqual(['evt-a-199'])
    // La BORNE elle-meme : sans elle, 200 descripteurs restaient ouverts.
    expect(
      (store as unknown as { descriptors: Map<string, number> }).descriptors.size
    ).toBeLessThanOrEqual(32)
  })
})

/*
 * BORNE DU CACHE DE RELECTURE + ISOLATION DES EVENEMENTS (suite des gels du 2026-09-01).
 *
 * La relecture incrementale garde les evenements deja parses par conversation. Deux defauts
 * connus de ce genre de cache, tous deux deja payes dans ce fichier :
 *  1) non borne -> il grandit avec le nombre de conversations (1 472 sur l'installation de
 *     l'utilisateur, meme cause que l'EMFILE des descripteurs plus haut) ;
 *  2) partage -> `[...events]` copie la LISTE, pas les evenements : un appelant qui touche un
 *     evenement pollue toutes les lectures suivantes, y compris celles des autres appelants.
 *
 * Entrees qui feraient echouer ces tests si la correction etait fausse :
 *  - borne : la 200e conversation lue (`conv-199`) apres 200 lectures distinctes — un cache sans
 *    eviction garde 200 entrees et depasse la borne ; une eviction qui casserait la correction se
 *    verrait sur la relecture de `conv-0`, qui doit rendre ses 2 evenements sans les perdre ;
 *  - isolation : l'ecriture `events[0].payloads[0].content = 'pollue'` faite par l'appelant. Un
 *    cache qui rend ses propres objets laisse cette valeur revenir a la lecture suivante.
 */
describe('cache de relecture borne et non partage', () => {
  it('borne le cache de relecture a 32 conversations sans perdre la plus ancienne', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-read-borne-'))
    const store = new TraceStore(root)
    for (let i = 0; i < 200; i += 1)
      store.append({ ...event(`evt-a-${i}`, 0), conversationId: `conv-${i}`, parentId: undefined })
    store.append({ ...event('evt-b-0', 1), conversationId: 'conv-0', parentId: 'evt-a-0' })

    for (let i = 0; i < 200; i += 1) store.readConversation(`conv-${i}`)
    for (let i = 0; i < 200; i += 1) store.readConversationBestEffort(`conv-${i}`)

    const interne = store as unknown as {
      readCursorsStrict: Map<string, unknown>
      readCursorsVue: Map<string, unknown>
    }
    expect(interne.readCursorsStrict.size).toBeLessThanOrEqual(32)
    expect(interne.readCursorsVue.size).toBeLessThanOrEqual(32)
    // La correction doit rester correcte apres eviction : conv-0 est sortie du cache.
    expect(store.readConversation('conv-0').map((e) => e.id)).toEqual(['evt-a-0', 'evt-b-0'])
    expect(store.readConversationBestEffort('conv-199').map((e) => e.id)).toEqual(['evt-a-199'])
  })

  it('ne laisse pas un appelant polluer les evenements gardes en cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-read-isolation-'))
    const store = new TraceStore(root)
    store.append(event('evt-0', 0)).append(event('evt-1', 1))
    expect(store.readConversation('conv-1')).toHaveLength(2)

    const premiers = store.readConversation('conv-1')
    expect(() => {
      premiers[0].payloads[0].content = 'pollue'
      ;(premiers[0] as { type: string }).type = 'tool-call'
    }).toThrow(TypeError)

    const seconds = store.readConversation('conv-1')
    expect(seconds[0].payloads[0].content).toBe('evt-0')
    expect(seconds[0].type).toBe('message')
    expect(store.readConversationBestEffort('conv-1')[0].payloads[0].content).toBe('evt-0')
  })
})
