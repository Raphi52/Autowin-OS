/**
 * UN DISQUE QUI CALE NE DOIT PAS GELER L'INTERFACE — journal des conversations.
 *
 * Incident du 2026-09-09 (`gels.jsonl`, 15:38:48) : un `writeFileSync` + un `appendFileSync` sur
 * `conversations.json.journal.jsonl` ont bloqué 10 004 ms sur quelques Ko, dans le même gel de ~26 s
 * que le journal de tour. Le volume n'y était pour rien : le disque a calé, et l'écriture vivait sur
 * le fil qui dessine l'interface.
 *
 * Ce que ces tests exigent, et l'entrée qui les ferait échouer si la correction était défaite :
 *  (a) un delta de streaming (`urgency: 'checkpoint'`) ne passe JAMAIS par un appel bloquant — un
 *      retour à `appendFileSync` sur ce chemin rallume le gel et échoue ici ;
 *  (b) un disque LENT (10 s, la durée réellement mesurée) ne retarde pas l'émission des deltas ;
 *  (c) la CLÔTURE d'un tour (`urgency: 'immediate'`) reste écrite SUR PLACE, en bloquant ;
 *  (d) l'ORDRE du journal est préservé même quand un vidage forcé tombe pendant une écriture en
 *      vol — le journal se REJOUE au démarrage, deux enregistrements inversés reconstruiraient un
 *      autre état. C'est la raison pour laquelle un flush synchrone s'enfile au lieu de devancer.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return { ...real, default: real, appendFileSync: vi.fn(real.appendFileSync) }
})

/** Le disque est pilotable : `retardMs` simule le stall réellement observé. */
let retardMs = 0
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    default: real,
    appendFile: vi.fn(async (...args: Parameters<typeof real.appendFile>) => {
      if (retardMs > 0) await new Promise((resolve) => setTimeout(resolve, retardMs))
      return real.appendFile(...args)
    })
  }
})

const fs = await import('node:fs')
const fsp = await import('node:fs/promises')
const { ConversationStore } = await import('./conversations')
const { attendreEcrituresConversations, loadConversations, persistConversations } =
  await import('./conversations-disk')

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aos-convs-horsfil-'))
  retardMs = 0
  vi.mocked(fs.appendFileSync).mockClear()
  vi.mocked(fsp.appendFile).mockClear()
})
afterEach(async () => {
  retardMs = 0
  await attendreEcrituresConversations()
  rmSync(dir, { recursive: true, force: true })
})

/** Un store branché sur un fichier neuf, prêt à streamer un tour. */
function storeEnTour(nom: string): {
  p: string
  store: InstanceType<typeof ConversationStore>
  id: string
  flush: () => void
} {
  const p = join(dir, nom)
  const store = new ConversationStore(() => 1000)
  const flush = persistConversations(store, p)
  const c = store.create({ title: 'T', provider: 'codex' })
  store.beginTurn(c.id, { content: 'Go' }, { turnId: 't' })
  return { p, store, id: c.id, flush }
}

describe('journal des conversations — écriture hors du fil principal', () => {
  it("n'appelle AUCUNE écriture bloquante pour les deltas de streaming", async () => {
    const { p, store, id } = storeEnTour('deltas.json')
    // La création et l'ouverture du tour sont `immediate` : elles ont le droit de bloquer.
    vi.mocked(fs.appendFileSync).mockClear()

    for (let i = 0; i < 5; i += 1) {
      store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: `f${i}` })
    }
    await new Promise((resolve) => setTimeout(resolve, 150))

    // C'est l'assertion qui garde le correctif : aucun delta n'a touché le disque en bloquant.
    expect(vi.mocked(fs.appendFileSync)).not.toHaveBeenCalled()
    expect(vi.mocked(fsp.appendFile)).toHaveBeenCalled()

    await attendreEcrituresConversations()
    expect(loadConversations(p)[0].messages.at(-1)?.content).toBe('f0f1f2f3f4')
  })

  it('rend la main tout de suite même si le disque cale 10 s (la durée du gel réel)', async () => {
    // Le stall de 10 s est SIMULÉ (timers mockés) : on mesure le temps que le fil principal passe
    // BLOQUÉ, pas la durée du stall lui-même — attendre 10 s pour de vrai ne prouverait rien de plus.
    vi.useFakeTimers()
    try {
      retardMs = 10_000
      const { store, id } = storeEnTour('lent.json')
      vi.mocked(fs.appendFileSync).mockClear()

      const debut = performance.now()
      for (let i = 0; i < 300; i += 1) {
        store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: `f${i}` })
      }
      vi.advanceTimersByTime(150) // le vidage débouncé part, sur un disque qui va caler 10 s
      const bloquageMs = performance.now() - debut

      // L'incident bloquait ~10 s par écriture. Ici le fil principal n'attend pas le disque.
      expect(bloquageMs).toBeLessThan(1_000)
      expect(vi.mocked(fs.appendFileSync)).not.toHaveBeenCalled()
      // Rien n'est perdu : l'état vivant porte tout, même pendant que le disque cale.
      expect(store.get(id)?.messages.at(-1)?.content).toContain('f299')

      // Et une fois le disque revenu, les deltas atteignent bien le fichier.
      retardMs = 0
      await vi.advanceTimersByTimeAsync(10_000)
      await attendreEcrituresConversations()
    } finally {
      retardMs = 0
      vi.useRealTimers()
    }
  })

  it('écrit la CLÔTURE du tour SUR PLACE, en bloquant', () => {
    const { p, store, id } = storeEnTour('terminal.json')
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'partiel' })
    vi.mocked(fs.appendFileSync).mockClear()

    store.applyTurnEvent(id, 't', { kind: 'done' })

    // Sans attendre quoi que ce soit, la clôture est déjà lisible sur le disque.
    expect(vi.mocked(fs.appendFileSync)).toHaveBeenCalled()
    expect(loadConversations(p)[0].messages.at(-1)?.status).toBe('completed')
    expect(loadConversations(p)[0].messages.at(-1)?.content).toBe('partiel')
  })

  it("préserve l'ORDRE du journal quand un vidage forcé tombe pendant une écriture en vol", async () => {
    retardMs = 60
    const { p, store, id, flush } = storeEnTour('ordre.json')

    // Un lot de deltas part en vol…
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'un-' })
    await new Promise((resolve) => setTimeout(resolve, 130))
    // …et un vidage forcé (chemin before-quit) tombe pendant que le disque n'a pas encore rendu.
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'deux-' })
    flush()
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'trois' })
    flush()

    retardMs = 0
    await attendreEcrituresConversations()

    // Un enregistrement inversé reconstruirait un autre texte : l'ordre est la preuve.
    expect(loadConversations(p)[0].messages.at(-1)?.content).toBe('un-deux-trois')
    const lignes = readFileSync(`${p}.journal.jsonl`, 'utf8').trim().split('\n')
    const textes = lignes
      .map((ligne) => JSON.parse(ligne) as { event?: { text?: string } })
      .map((record) => record.event?.text)
      .filter((texte): texte is string => typeof texte === 'string')
    expect(textes).toEqual(['un-', 'deux-', 'trois'])
  })
})
