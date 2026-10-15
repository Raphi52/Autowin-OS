import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * LA RÉÉCRITURE D'ARCHIVAGE ET LA FILE DU JOURNAL (revue du 2026-10-14, objection bloquante).
 *
 * Une réécriture sérialisée quand son tour ARRIVE comptait deux fois un lot déposé derrière elle :
 * dans le snapshot, puis rejoué depuis le journal. Pour ouvrir cette fenêtre de façon déterministe,
 * les ajouts au journal sont retenus derrière une barrière : la file est occupée, la réécriture
 * attend, et l'on dépose un lot pendant ce temps.
 */
let barriere: Promise<void> = Promise.resolve()
/** Nombre d'ajouts au journal à faire ÉCHOUER (EBUSY simulé) une fois la barrière levée. */
let echecsAppend = 0
vi.mock('node:fs/promises', async (original) => {
  const reel = await original<typeof import('node:fs/promises')>()
  return {
    ...reel,
    appendFile: async (...args: Parameters<typeof reel.appendFile>) => {
      await barriere
      if (echecsAppend > 0) {
        echecsAppend -= 1
        throw Object.assign(new Error('EBUSY simulé'), { code: 'EBUSY' })
      }
      return reel.appendFile(...args)
    }
  }
})

const { ConversationStore } = await import('./conversations')
const { attendreEcrituresConversations, conversationArchiveDir, persistConversations } =
  await import('./conversations-disk')

const racine = mkdtempSync(join(tmpdir(), 'aos-archive-file-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))
const JOUR = 24 * 60 * 60 * 1000
const MAINTENANT = Date.parse('2026-10-14T12:00:00.000Z')

async function monter(nom: string): Promise<{
  p: string
  store: InstanceType<typeof ConversationStore>
  persistance: ReturnType<typeof persistConversations>
  vieux: string
  actif: string
  ouvrir: () => void
}> {
  const p = join(racine, nom, 'conversations.json')
  let horloge = MAINTENANT - 30 * JOUR
  const store = new ConversationStore(() => horloge)
  const persistance = persistConversations(store, p)
  const vieux = store.create({ title: 'Vieux', provider: 'claude' }).id
  store.append(vieux, { role: 'user', content: 'ancien' })
  horloge = MAINTENANT
  const actif = store.create({ title: 'Actif', provider: 'claude' }).id
  await attendreEcrituresConversations()
  // La file du journal devient OCCUPÉE : un tour en flux dépose un lot asynchrone, retenu.
  let ouvrir: () => void = () => undefined
  barriere = new Promise<void>((resolve) => (ouvrir = resolve))
  store.beginTurn(actif, { content: 'Question 1' }, { turnId: 'turn-1' })
  store.applyTurnEvent(actif, 'turn-1', { kind: 'delta', streamId: '0:0', text: 'Réponse 1' })
  // Pas de `done` : un événement urgent viderait le lot tout de suite, hors de la file.
  await new Promise<void>((resolve) => setTimeout(resolve, 200)) // vidage différé (120 ms)
  return { p, store, persistance, vieux, actif, ouvrir }
}

/** La réécriture est en file dès que l'archive du vieux fil est sur le disque. */
async function reecritureEnFile(p: string, vieux: string): Promise<void> {
  const archive = join(conversationArchiveDir(p), `${vieux}.json`)
  while (!existsSync(archive)) await new Promise<void>((resolve) => setImmediate(resolve))
  // Le fichier est visible avant que la suite de la passe ne s'exécute : on lui laisse le temps.
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
}

describe('réécriture d’archivage et file du journal', () => {
  it('un lot déposé PENDANT que la réécriture attend n’est pas compté deux fois', async () => {
    const { p, store, persistance, vieux, actif, ouvrir } = await monter('lot-en-file')
    const passe = persistance.archiver(MAINTENANT)
    await reecritureEnFile(p, vieux)
    // Déposé DERRIÈRE la réécriture, avant qu'elle ne s'exécute.
    store.append(actif, { role: 'user', content: 'Message après la sérialisation' })
    ouvrir()
    expect(await passe).toBe(1)
    await attendreEcrituresConversations()

    const attendu = store.get(actif)!.messages.length
    const relu = new ConversationStore(() => MAINTENANT)
    persistConversations(relu, p)
    // Le tour resté en flux est relu « interrompu » (avis ajouté) : on compte, on ne compare pas le texte.
    expect(relu.get(actif)!.messages).toHaveLength(attendu)
    expect(
      relu.get(actif)!.messages.filter((m) => m.content === 'Message après la sérialisation')
    ).toHaveLength(1)
  })

  it('un snapshot de FERMETURE posé pendant l’attente gagne sur la réécriture plus ancienne', async () => {
    const { p, store, persistance, vieux, actif, ouvrir } = await monter('fermeture')
    const passe = persistance.archiver(MAINTENANT)
    await reecritureEnFile(p, vieux)
    store.rename(actif, 'Renommé juste avant de quitter')
    persistance() // vidage de fermeture : snapshot complet, synchrone
    ouvrir()
    await passe
    await attendreEcrituresConversations()

    const disque = JSON.parse(readFileSync(p, 'utf8')) as Array<{ id: string; title: string }>
    expect(disque.find((c) => c.id === actif)?.title).toBe('Renommé juste avant de quitter')
  })

  it('un lot qui ÉCHOUE avant une réécriture déposée derrière lui est absorbé, pas rejoué (revue N1)', async () => {
    const { p, persistance, vieux, actif, ouvrir } = await monter('lot-en-echec')
    const passe = persistance.archiver(MAINTENANT)
    await reecritureEnFile(p, vieux)
    // Le lot du tour (déjà dans le corps de la réécriture) échoue à s'écrire dans le journal.
    echecsAppend = 1
    ouvrir()
    expect(await passe).toBe(1)
    await new Promise<void>((resolve) => setTimeout(resolve, 300)) // un éventuel renvoi (120 ms)
    await attendreEcrituresConversations()

    const relu = new ConversationStore(() => MAINTENANT)
    persistConversations(relu, p)
    // Dans le texte à plat (reconstruit depuis les parties) : un delta rejoué deux fois y collerait
    // « Réponse 1Réponse 1 ».
    const texte = relu
      .get(actif)!
      .messages.map((m) => m.content)
      .join(' | ')
    expect(texte.split('Réponse 1').length - 1).toBe(1)
  })
})
