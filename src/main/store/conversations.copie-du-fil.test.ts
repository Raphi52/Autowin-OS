/**
 * LA COPIE DU FIL, CÔTÉ MAGASIN. Un fil d'AutoWinOS passe dans sa copie : son dossier rangé DEVIENT
 * la copie (le dossier rangé et le dossier de travail ne diffèrent jamais), et le fil retient d'où il
 * vient pour y revenir quand le réglage est éteint. Les entrées qui font échouer une version fausse :
 *  - une catégorie posée à la main : la passer en copie ne doit pas l'effacer (`rangerDansDossier` le fait) ;
 *  - un fil sans dossier : il revient SANS dossier, pas dans le dépôt écrit en dur ;
 *  - une branche d'un fil en copie : elle ne doit pas travailler dans la copie d'un autre fil ;
 *  - un redémarrage : la copie du fil est relue du disque.
 * fix-ok: cause mesurée — la 1re écriture appelait `persistConversations(liste)` ; sa signature prend le
 * magasin lui-même (conversations-disk.ts, `persistConversations(store, path)`), d'où la reprise du test.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { attendreEcrituresConversations, persistConversations } from './conversations-disk'

const dir = mkdtempSync(join(tmpdir(), 'aos-convs-copie-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const DEPOT = 'D:\\AutoWinOS'
const COPIE = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\retours-de-tour\\essai__conv-1-5-1'

describe('ConversationStore — la copie du fil', () => {
  it('un fil rangé dans le dépôt passe dans sa copie, sa catégorie et son heure intactes', () => {
    let t = 1000
    const store = new ConversationStore(() => t)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    store.rangerDansDossier(id, 'Perso')
    t = 9000

    const fil = store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })

    expect(fil?.projectPath).toBe(COPIE)
    expect(fil?.copieDuFil).toEqual({ chemin: COPIE, depot: DEPOT, dossierAvant: DEPOT })
    expect(fil?.categorie).toBe('Perso')
    expect(fil?.updatedAt).toBe(1000)
  })

  it('réglage éteint : le fil revient à son dossier d’avant, sa copie reste notée', () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })

    const fil = store.revenirDeLaCopie(id)

    expect(fil?.projectPath).toBe(DEPOT)
    expect(fil?.copieDuFil?.chemin).toBe(COPIE)
  })

  it('un fil né sans dossier revient sans dossier, jamais dans un dépôt écrit en dur', () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude' }).id
    store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })
    expect(store.get(id)?.copieDuFil).not.toHaveProperty('dossierAvant')

    store.revenirDeLaCopie(id)

    expect(store.get(id)).not.toHaveProperty('projectPath')
  })

  it('reprendre sa copie garde le dossier d’avant noté la première fois', () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })
    store.revenirDeLaCopie(id)

    store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })

    expect(store.get(id)?.copieDuFil?.dossierAvant).toBe(DEPOT)
    expect(store.get(id)?.projectPath).toBe(COPIE)
  })

  it('une branche d’un fil en copie repart de son dépôt, pas dans la copie de sa source', () => {
    const store = new ConversationStore(() => 1000)
    const source = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT })
    store.append(source.id, { role: 'user', content: 'bonjour' })
    store.passerDansLaCopie(source.id, { chemin: COPIE, depot: DEPOT })
    const ancre = store.get(source.id)?.messages[0]?.messageId as string

    const branche = store.fork(source.id, ancre)

    expect(branche.projectPath).toBe(DEPOT)
    expect(branche).not.toHaveProperty('copieDuFil')
    // Jumeau : un dossier imposé à la branche (« revenir à ce tour ») reste celui imposé.
    expect(store.fork(source.id, ancre, { dossier: 'D:\\Autre' }).projectPath).toBe('D:\\Autre')
  })

  it('la copie du fil survit au redémarrage', async () => {
    const fichier = join(dir, 'conversations.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, fichier)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })
    await attendreEcrituresConversations()

    const relu = new ConversationStore(() => 2000)
    persistConversations(relu, fichier)

    expect(relu.get(id)?.copieDuFil).toEqual({ chemin: COPIE, depot: DEPOT, dossierAvant: DEPOT })
    expect(relu.get(id)?.projectPath).toBe(COPIE)
    // La compaction de démarrage passe par la même file : attendue avant l'effacement du dossier.
    await attendreEcrituresConversations()
  })
})
