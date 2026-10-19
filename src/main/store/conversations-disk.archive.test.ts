import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ConversationStore } from './conversations'
import {
  attendreEcrituresConversations,
  conversationArchiveDir,
  conversationJournalPath,
  loadConversations,
  persistConversations
} from './conversations-disk'

/**
 * ARCHIVE DES CONVERSATIONS INACTIVES (mesure du 2026-10-14 : 779 fils sur 828 inactifs depuis plus
 * de 14 jours, 65,4 Mo des 76,8 Mo relus et réécrits par chaque démarrage).
 *
 * L'invariant testé partout : la copie ACTIVE gagne toujours, et aucun fil ne se perd ni ne
 * ressuscite, quel que soit le moment où l'app s'arrête.
 */
const racine = mkdtempSync(join(tmpdir(), 'aos-archive-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))
let compteur = 0
const nouveauChemin = (): string => {
  const dossier = join(racine, `cas-${++compteur}`)
  return join(dossier, 'conversations.json')
}

const JOUR = 24 * 60 * 60 * 1000
const MAINTENANT = Date.parse('2026-10-14T12:00:00.000Z')

/** Un store persisté avec un fil ANCIEN (30 jours) et un fil RÉCENT, chacun avec un tour complet. */
function monterCorpus(p: string): {
  store: ConversationStore
  persistance: ReturnType<typeof persistConversations>
  vieux: string
  recent: string
} {
  let horloge = MAINTENANT - 30 * JOUR
  const store = new ConversationStore(() => horloge)
  // UNE persistance par store : la rebrancher réhydraterait le store depuis le disque.
  const persistance = persistConversations(store, p)
  const vieux = store.create({ title: 'Vieux fil', provider: 'claude' }).id
  store.beginTurn(vieux, { content: 'Question ancienne' }, { turnId: 'turn-vieux' })
  store.applyTurnEvent(vieux, 'turn-vieux', {
    kind: 'delta',
    streamId: '0:0',
    text: 'Réponse ancienne.'
  })
  store.applyTurnEvent(vieux, 'turn-vieux', { kind: 'done' })
  horloge = MAINTENANT - JOUR
  const recent = store.create({ title: 'Fil récent', provider: 'claude' }).id
  store.append(recent, { role: 'user', content: 'Question récente' })
  return { store, persistance, vieux, recent }
}

const idsDuSnapshot = (p: string): string[] =>
  (JSON.parse(readFileSync(p, 'utf8')) as Array<{ id: string }>).map((c) => c.id)

/** Redémarrage : un store neuf branché sur le même disque. */
function redemarrer(p: string): {
  store: ConversationStore
  persistance: ReturnType<typeof persistConversations>
} {
  const store = new ConversationStore(() => MAINTENANT)
  const persistance = persistConversations(store, p)
  return { store, persistance }
}

describe('archive des conversations inactives', () => {
  it('bascule le fil inactif hors du snapshot, puis le rend intact après le démarrage', async () => {
    const p = nouveauChemin()
    const { store, persistance, vieux, recent } = monterCorpus(p)
    const avant = structuredClone(store.get(vieux))

    expect(await persistance.archiver(MAINTENANT)).toBe(1)
    await attendreEcrituresConversations()

    expect(idsDuSnapshot(p)).toEqual([recent])
    expect(existsSync(join(conversationArchiveDir(p), `${vieux}.json`))).toBe(true)
    // Le fil archivé reste dans le store vivant : rien ne change pour l'utilisateur.
    expect(store.get(vieux)).toBeDefined()

    const apres = redemarrer(p)
    // Le démarrage ne lit QUE le snapshot (`list` ne déclenche aucune lecture d'archive)…
    expect(apres.store.list().map((c) => c.id)).toEqual([recent])
    // …puis les archives arrivent en arrière-plan, identiques.
    expect(await apres.persistance.archivesChargees).toBe(1)
    expect(
      apres.store
        .list()
        .map((c) => c.id)
        .sort()
    ).toEqual([vieux, recent].sort())
    expect(apres.store.get(vieux)).toEqual(avant)
  })

  it('PENDANT la relecture, un fil archivé demandé par son id est lu à la demande (revue N4)', async () => {
    const p = nouveauChemin()
    const { store, persistance, vieux } = monterCorpus(p)
    const avant = structuredClone(store.get(vieux))
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()

    const apres = redemarrer(p)
    // Une tâche planifiée liée à ce vieux fil arrive avant la fin de la relecture : il existe.
    expect(apres.store.get(vieux)).toEqual(avant)
    expect(apres.store.list().map((c) => c.id)).toContain(vieux)
    // La relecture d'arrière-plan ne l'ajoute pas une seconde fois.
    expect(await apres.persistance.archivesChargees).toBe(0)
    expect(apres.store.list().filter((c) => c.id === vieux)).toHaveLength(1)
    // Une fois tout relu, un id inconnu reste inconnu (aucune lecture de fichier).
    expect(apres.store.get('conv-inexistante')).toBeUndefined()
  })

  it('une archive dont le retrait a échoué est ignorée grâce à sa pierre tombale', async () => {
    const p = nouveauChemin()
    const { persistance, vieux } = monterCorpus(p)
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()
    // État laissé par un retrait refusé (fichier tenu) : l'archive ET sa pierre tombale.
    writeFileSync(join(conversationArchiveDir(p), `${vieux}.supprime`), '', 'utf8')

    const apres = redemarrer(p)
    expect(await apres.persistance.archivesChargees).toBe(0)
    expect(apres.store.get(vieux)).toBeUndefined()
    // Le retrait est retenté en arrière-plan : archive puis tombe.
    await vi.waitFor(() =>
      expect(existsSync(join(conversationArchiveDir(p), `${vieux}.json`))).toBe(false)
    )
    await vi.waitFor(() =>
      expect(existsSync(join(conversationArchiveDir(p), `${vieux}.supprime`))).toBe(false)
    )
  })

  it('un fil archivé que l’on touche redevient actif et survit au redémarrage, même avant la relecture des archives', async () => {
    const p = nouveauChemin()
    const { persistance, vieux } = monterCorpus(p)
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()

    const session = redemarrer(p)
    await session.persistance.archivesChargees
    session.store.append(vieux, { role: 'user', content: 'Je reprends ce vieux fil' })
    await attendreEcrituresConversations()

    // Le journal porte le fil ENTIER (un delta seul n'aurait rien sur quoi se rejouer).
    const upsert = readFileSync(conversationJournalPath(p), 'utf8')
      .trim()
      .split('\n')
      .map((ligne) => JSON.parse(ligne) as { op: string; conversation?: { id: string } })
      .find((r) => r.op === 'upsert' && r.conversation?.id === vieux)
    expect(upsert).toBeDefined()

    const suivant = redemarrer(p)
    expect(suivant.store.get(vieux)?.messages.at(-1)?.content).toBe('Je reprends ce vieux fil')
    // La compaction de démarrage est posée hors du fil principal (conv-359).
    await attendreEcrituresConversations()
    expect(idsDuSnapshot(p)).toContain(vieux)
    await suivant.persistance.archivesChargees
    // L'archive périmée part en arrière-plan : la copie active fait foi.
    await vi.waitFor(() =>
      expect(existsSync(join(conversationArchiveDir(p), `${vieux}.json`))).toBe(false)
    )
  })

  it('un RENOMMAGE (qui ne change pas la date) d’un fil archivé n’est pas perdu', async () => {
    const p = nouveauChemin()
    const { persistance, vieux } = monterCorpus(p)
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()

    const session = redemarrer(p)
    await session.persistance.archivesChargees
    session.store.rename(vieux, 'Vieux fil renommé')
    await attendreEcrituresConversations()

    const suivant = redemarrer(p)
    await suivant.persistance.archivesChargees
    expect(suivant.store.get(vieux)?.title).toBe('Vieux fil renommé')
  })

  it('un fil archivé supprimé ne ressuscite pas', async () => {
    const p = nouveauChemin()
    const { persistance, vieux } = monterCorpus(p)
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()

    const session = redemarrer(p)
    await session.persistance.archivesChargees
    expect(session.store.remove(vieux)).toBe(true)
    await attendreEcrituresConversations()
    expect(existsSync(join(conversationArchiveDir(p), `${vieux}.json`))).toBe(false)

    const suivant = redemarrer(p)
    await suivant.persistance.archivesChargees
    expect(suivant.store.get(vieux)).toBeUndefined()
  })

  it('un fil touché PENDANT la passe reste actif, et son archive périmée est retirée', async () => {
    const p = nouveauChemin()
    const { store, persistance, vieux } = monterCorpus(p)
    // Assez de fils anciens pour que la passe écrive sur plusieurs tours de boucle.
    const autres: string[] = []
    for (let i = 0; i < 40; i += 1)
      autres.push(store.create({ title: `Ancien ${i}`, provider: 'claude' }).id)
    await attendreEcrituresConversations()
    const archiveDuVieux = join(conversationArchiveDir(p), `${vieux}.json`)
    const passe = persistance.archiver(MAINTENANT + 365 * JOUR)
    // Dès que l'archive du vieux fil est écrite, et pendant que les autres s'écrivent : on le touche.
    while (!existsSync(archiveDuVieux)) await new Promise<void>((resolve) => setImmediate(resolve))
    store.rename(vieux, 'Touché pendant la passe')
    const archivees = await passe
    await attendreEcrituresConversations()

    expect(archivees).toBeGreaterThan(0)
    expect(idsDuSnapshot(p)).toContain(vieux)
    expect(idsDuSnapshot(p)).not.toContain(autres[0])
    expect(existsSync(archiveDuVieux)).toBe(false)
    expect(loadConversations(p).find((c) => c.id === vieux)?.title).toBe('Touché pendant la passe')
  })

  it('n’archive ni un fil récent ni un tour encore en cours', async () => {
    const p = nouveauChemin()
    const { store, persistance, vieux } = monterCorpus(p)
    // Un tour resté en flux sur le vieux fil : il n'est pas clos, il ne part pas.
    store.beginTurn(vieux, { content: 'Encore une' }, { turnId: 'turn-en-cours' })
    expect(await persistance.archiver(MAINTENANT + 365 * JOUR)).toBe(1) // le récent seulement
    await attendreEcrituresConversations()
    expect(idsDuSnapshot(p)).toEqual([vieux])
  })

  it('un identifiant archivé n’est jamais réattribué, même sans le plancher persisté', async () => {
    const p = nouveauChemin()
    const { persistance, vieux } = monterCorpus(p)
    await persistance.archiver(MAINTENANT + 365 * JOUR)
    await attendreEcrituresConversations()
    rmSync(`${p}.next-id`, { force: true })

    const session = redemarrer(p)
    const nouveau = session.store.create({ title: 'Neuf', provider: 'claude' }).id
    expect([vieux, 'conv-2']).not.toContain(nouveau)
  })

  it('une archive illisible est gardée sur le disque et les autres arrivent quand même', async () => {
    const p = nouveauChemin()
    const { persistance, vieux, recent } = monterCorpus(p)
    await persistance.archiver(MAINTENANT + 365 * JOUR)
    await attendreEcrituresConversations()
    const abimee = join(conversationArchiveDir(p), `${recent}.json`)
    writeFileSync(abimee, '{ pas du json', 'utf8')

    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const session = redemarrer(p)
    expect(await session.persistance.archivesChargees).toBe(1)
    expect(session.store.get(vieux)).toBeDefined()
    expect(existsSync(abimee)).toBe(true)
    expect(avertir).toHaveBeenCalled()
    avertir.mockRestore()
  })

  it('un delta du journal qui vise un fil archivé se rejoue sur son archive', async () => {
    const p = nouveauChemin()
    const { persistance, vieux } = monterCorpus(p)
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()
    // Arrêt brutal simulé : l'upsert du réveil manque, seul le delta est sur le disque.
    const message = {
      role: 'user',
      content: 'delta orphelin',
      ts: MAINTENANT,
      messageId: 'message-x'
    }
    writeFileSync(
      conversationJournalPath(p),
      `${JSON.stringify({
        schema: 'autowin.conversation-change/v1',
        op: 'append-messages',
        id: vieux,
        messages: [message],
        updatedAt: MAINTENANT
      })}\n`,
      'utf8'
    )
    const relus = loadConversations(p)
    expect(relus.find((c) => c.id === vieux)?.messages.at(-1)?.content).toBe('delta orphelin')
    expect(readdirSync(conversationArchiveDir(p))).toContain(`${vieux}.json`)
  })
  /*
   * CONTRAT CHANGÉ le 2026-10-19 (conv-359). La compaction de démarrage était synchrone : son échec
   * levait, et `index.ts` mettait le store de côté — l'app s'ouvrait sur un historique VIDE pour un
   * simple `.tmp` resté en dossier (conv-914). Elle passe désormais par la file du journal : en
   * échec, le journal n'est pas effacé et reste la référence. Le démarrage ne lève plus, et le fil
   * revenu actif reste relisible même quand son archive périmée a été retirée.
   */
  it('si la compaction de démarrage échoue, le démarrage tient et le journal garde tout', async () => {
    const p = nouveauChemin()
    const { persistance, vieux } = monterCorpus(p)
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()
    const archive = join(conversationArchiveDir(p), `${vieux}.json`)
    // Le fil archivé est aussi revenu dans le journal (il est donc ACTIF au prochain démarrage) :
    // son archive y est périmée et serait retirée… si le démarrage allait au bout.
    const sauvegarde = `${archive}.copie`
    copyFileSync(archive, sauvegarde)
    writeFileSync(
      conversationJournalPath(p),
      `${JSON.stringify({
        schema: 'autowin.conversation-change/v1',
        op: 'upsert',
        conversation: JSON.parse(readFileSync(sauvegarde, 'utf8'))
      })}
`,
      'utf8'
    )
    rmSync(sauvegarde)
    // La compaction échoue : son fichier temporaire est un dossier (même forme que conv-914).
    const obstacle = `${p}.archivage.tmp`
    mkdirSync(obstacle, { recursive: true })
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(() => persistConversations(new ConversationStore(() => MAINTENANT), p)).not.toThrow()
      // L'attente des tests relaie l'échec provoqué ; l'app, elle, le rattrape et l'écrit au journal.
      await expect(attendreEcrituresConversations()).rejects.toThrow(/EISDIR/)
      await attendreEcrituresConversations()
      expect(avertissement.mock.calls.map((appel) => String(appel[0]))).toContainEqual(
        expect.stringContaining('compaction de démarrage en échec')
      )
    } finally {
      avertissement.mockRestore()
    }
    // Rien n'est perdu : le journal est resté, et il porte le fil revenu actif.
    expect(existsSync(conversationJournalPath(p))).toBe(true)
    expect(loadConversations(p).map((c) => c.id)).toContain(vieux)

    // L'obstacle levé, le démarrage suivant compacte normalement, toujours sans perte.
    rmSync(obstacle, { recursive: true, force: true })
    persistConversations(new ConversationStore(() => MAINTENANT), p)
    await attendreEcrituresConversations()
    expect(existsSync(conversationJournalPath(p))).toBe(false)
    expect(idsDuSnapshot(p)).toContain(vieux)
  })

  it('supprimer un fil ACTIF retire aussi une archive périmée restée sur le disque', async () => {
    const p = nouveauChemin()
    const { store, recent } = monterCorpus(p)
    // Archive périmée dont le retrait aurait échoué plus tôt (fichier tenu, par exemple).
    mkdirSync(conversationArchiveDir(p), { recursive: true })
    const archive = join(conversationArchiveDir(p), `${recent}.json`)
    writeFileSync(archive, JSON.stringify(store.get(recent)), 'utf8')

    expect(store.remove(recent)).toBe(true)
    await attendreEcrituresConversations()

    expect(existsSync(archive)).toBe(false)
    const suivant = redemarrer(p)
    await suivant.persistance.archivesChargees
    expect(suivant.store.get(recent)).toBeUndefined()
  })
})
