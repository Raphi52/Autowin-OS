/**
 * LA ROTATION NE DOIT PLUS GELER L'INTERFACE — réécriture du snapshot des conversations.
 *
 * Incident du 2026-09-12 (`gels.jsonl`) : créer ou supprimer une conversation figeait l'app
 * **2,1 s**. Le correctif du 2026-09-09 avait sorti les deltas de streaming du fil principal, mais
 * il restait UNE écriture synchrone sur ce chemin, et c'est la plus lourde de l'app : quand le
 * journal dépasse 16 Mo, on réécrit le fichier ENTIER (35 Mo mesurés) — en `writeFileSync`, y
 * compris depuis la fonction censée être asynchrone (`appendConversationChangesAsync`).
 *
 * Ce que ces tests exigent :
 *  (a) une mutation `immediate` qui tombe sur une rotation ne réécrit PAS le snapshot en bloquant ;
 *  (b) la rotation a bien lieu ensuite, hors du fil : snapshot à jour et journal reparti à zéro ;
 *  (c) le vidage de fermeture (`before-quit`), lui, écrit SUR PLACE — là, plus personne n'attend
 *      l'interface et perdre le lot serait pire.
 */
import { mkdtempSync, rmSync, writeFileSync as writeFileSyncReel } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return { ...real, default: real, writeFileSync: vi.fn(real.writeFileSync) }
})

const fs = await import('node:fs')
const { ConversationStore } = await import('./conversations')
const { attendreEcrituresConversations, loadConversations, persistConversations } = await import(
  './conversations-disk'
)

/** Le seuil réel du module : au-delà, la prochaine écriture déclenche la rotation. */
const JOURNAL_MAX_BYTES = 16 * 1024 * 1024

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aos-convs-rotation-'))
})
afterEach(async () => {
  await attendreEcrituresConversations()
  rmSync(dir, { recursive: true, force: true })
})

/** Store branché sur un fichier neuf, dont le journal est déjà AU-DELÀ du seuil de rotation. */
function storeAvecJournalSature(nom: string): {
  p: string
  store: InstanceType<typeof ConversationStore>
  flush: () => void
} {
  const p = join(dir, nom)
  const store = new ConversationStore(() => 1000)
  const flush = persistConversations(store, p)
  // Le journal est gonflé APRÈS le branchement : au démarrage, sa présence provoque légitimement
  // un snapshot synchrone (replay), ce n'est pas le chemin testé ici.
  const ligne = `${JSON.stringify({ schema: 'autowin.conversation-change/v1', op: 'delete', id: 'x'.repeat(200) })}\n`
  writeFileSyncReel(`${p}.journal.jsonl`, ligne.repeat(Math.ceil(JOURNAL_MAX_BYTES / ligne.length)))
  vi.mocked(fs.writeFileSync).mockClear()
  return { p, store, flush }
}

describe('rotation du store conversations — hors du fil principal', () => {
  it('ne réécrit PAS les 35 Mo en bloquant quand une création tombe sur une rotation', async () => {
    const { p, store } = storeAvecJournalSature('rotation.json')

    // `create` est une mutation `immediate` : c'est exactement le geste qui figeait 2,1 s.
    const debut = performance.now()
    const creee = store.create({ title: 'Neuve', provider: 'codex' })
    const bloquageMs = performance.now() - debut

    // L'assertion qui garde le correctif : aucune réécriture synchrone du snapshot.
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled()
    expect(bloquageMs).toBeLessThan(500)

    // (b) la rotation a bien lieu, hors du fil, et le journal repart à zéro.
    await attendreEcrituresConversations()
    expect(loadConversations(p).map((c) => c.id)).toContain(creee.id)
    expect(fs.existsSync(`${p}.journal.jsonl`)).toBe(false)
  })

  it('ne perd pas une suppression tombée sur une rotation', async () => {
    const p = join(dir, 'suppression.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    const garde = store.create({ title: 'Garde', provider: 'codex' })
    const jetee = store.create({ title: 'Jetee', provider: 'codex' })
    await attendreEcrituresConversations()

    const ligne = `${JSON.stringify({ schema: 'autowin.conversation-change/v1', op: 'delete', id: 'x'.repeat(200) })}\n`
    writeFileSyncReel(
      `${p}.journal.jsonl`,
      ligne.repeat(Math.ceil(JOURNAL_MAX_BYTES / ligne.length))
    )
    vi.mocked(fs.writeFileSync).mockClear()

    store.remove(jetee.id)

    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled()
    await attendreEcrituresConversations()
    const ids = loadConversations(p).map((c) => c.id)
    expect(ids).toContain(garde.id)
    expect(ids).not.toContain(jetee.id)
  })

  it('écrit SUR PLACE au vidage de fermeture, même si une rotation est nécessaire', () => {
    const { p, store, flush } = storeAvecJournalSature('fermeture.json')

    // Un changement différable reste en attente…
    store.create({ title: 'Dernière', provider: 'codex' })
    // …et `before-quit` doit le poser tout de suite : aucune file ne sera drainée après.
    flush()

    expect(loadConversations(p).some((c) => c.title === 'Dernière')).toBe(true)
  })
})
