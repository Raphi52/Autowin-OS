/**
 * UN DISQUE QUI CALE NE DOIT PAS GELER L'INTERFACE — journal des conversations.
 *
 * Incident du 2026-09-09 (`gels.jsonl`, 15:38:48) : un `writeFileSync` + un `appendFileSync` sur
 * `conversations.json.journal.jsonl` ont bloqué 10 004 ms sur quelques Ko, dans le même gel de ~26 s
 * que le journal de tour. Le volume n'y était pour rien, le SSD non plus (420 ms au pire) :
 * l'appel attendait au-dessus du disque, et l'écriture vivait sur le fil qui dessine l'interface.
 *
 * Ce que ces tests exigent, et l'entrée qui les ferait échouer si la correction était défaite :
 *  (a) un delta de streaming (`urgency: 'checkpoint'`) ne passe JAMAIS par un appel bloquant — un
 *      retour à `appendFileSync` sur ce chemin rallume le gel et échoue ici ;
 *  (b) un disque LENT (10 s, la durée réellement mesurée) ne retarde pas l'émission des deltas ;
 *  (c) la CLÔTURE d'un tour, une création et une suppression (`urgency: 'immediate'`) ne bloquent
 *      pas non plus ; seule la FERMETURE de l'app écrit sur place ;
 *  (d) l'ORDRE du journal est préservé même quand une écriture `immediate` tombe pendant une écriture
 *      en vol — le journal se REJOUE au démarrage, deux enregistrements inversés reconstruiraient un
 *      autre état.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    appendFileSync: vi.fn(real.appendFileSync),
    existsSync: vi.fn(real.existsSync),
    statSync: vi.fn(real.statSync),
    mkdirSync: vi.fn(real.mkdirSync),
    writeFileSync: vi.fn(real.writeFileSync),
    /*
     * Remplacer un fichier tout neuf peut tenir 20 s sur ce poste, hors de l'app aussi (`cmd move /y`)
     * Assez pour faire tomber le test de fermeture sur un mur étranger à ce qu'il
     * vérifie. Ce double retire d'abord la cible : l'écriture reste synchrone, et c'est elle qu'on juge.
     */
    renameSync: vi.fn((de: string, vers: string) => {
      real.rmSync(vers, { force: true })
      real.renameSync(de, vers)
    })
  }
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

  /*
   * 2026-10-31 : `conversations-disk.ts:883` a figé la fenêtre 36,6 s en 7 jours, sur
   * quelques octets : la clôture d'un tour, une création et une suppression écrivaient encore sur le
   * fil principal. Le SSD n'y était pour rien, donc seule la sortie du fil protège la fenêtre.
   */
  it('écrit la CLÔTURE du tour hors du fil principal, sans un seul appel disque bloquant', async () => {
    const { p, store, id } = storeEnTour('terminal.json')
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'partiel' })
    await attendreEcrituresConversations()
    const bloquants = [
      fs.appendFileSync,
      fs.existsSync,
      fs.statSync,
      fs.mkdirSync,
      fs.writeFileSync
    ] as unknown as Array<ReturnType<typeof vi.fn>>
    for (const appel of bloquants) appel.mockClear()

    store.applyTurnEvent(id, 't', { kind: 'done' })
    await attendreEcrituresConversations()

    for (const appel of bloquants) expect(appel).not.toHaveBeenCalled()
    expect(loadConversations(p)[0].messages.at(-1)?.status).toBe('completed')
    expect(loadConversations(p)[0].messages.at(-1)?.content).toBe('partiel')
  })

  it('ne bloque pas non plus sur une création ou une suppression, même disque figé 10 s', async () => {
    vi.useFakeTimers()
    try {
      retardMs = 10_000
      const { p, store, id } = storeEnTour('creation.json')
      vi.mocked(fs.appendFileSync).mockClear()

      const debut = performance.now()
      const seconde = store.create({ title: 'Seconde', provider: 'codex' })
      store.remove(id)
      const bloquageMs = performance.now() - debut

      expect(bloquageMs).toBeLessThan(1_000)
      expect(vi.mocked(fs.appendFileSync)).not.toHaveBeenCalled()

      retardMs = 0
      await vi.advanceTimersByTimeAsync(40_000)
      await attendreEcrituresConversations()
      // Rejoué dans l'ordre : la suppression et la création atteignent bien le fichier.
      expect(loadConversations(p).map((c) => c.id)).toEqual([seconde.id])
    } finally {
      retardMs = 0
      vi.useRealTimers()
    }
  })

  it('garde la FERMETURE de l’app synchrone : rien ne meurt avec le processus', () => {
    const { p, store, id, flush } = storeEnTour('fermeture.json')
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'dernier mot' })
    store.applyTurnEvent(id, 't', { kind: 'done' })

    flush()

    // Sans attendre : à la sortie de `before-quit`, le disque porte déjà tout.
    expect(loadConversations(p)[0].messages.at(-1)?.status).toBe('completed')
    expect(loadConversations(p)[0].messages.at(-1)?.content).toBe('dernier mot')
  })

  it("préserve l'ORDRE du journal quand un vidage forcé tombe pendant une écriture en vol", async () => {
    retardMs = 60
    const { p, store, id } = storeEnTour('ordre.json')

    // Un lot de deltas part en vol…
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'un-' })
    await new Promise((resolve) => setTimeout(resolve, 130))
    // …et des vidages FORCÉS de session (mutations `immediate`, ici la clôture d'un tour) tombent
    // pendant que le disque n'a pas encore rendu. Depuis le 2026-09-12, le vidage de FERMETURE est
    // un chemin distinct (il pose un snapshot complet) : celui qu'on teste ici est bien celui de
    // la session, le seul qui doit respecter l'ordre du journal.
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'deux-' })
    store.applyTurnEvent(id, 't', { kind: 'delta', streamId: '0:0', text: 'trois' })
    store.applyTurnEvent(id, 't', { kind: 'done' })

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
