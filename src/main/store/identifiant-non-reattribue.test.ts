import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import {
  persistConversations,
  readConversationIdFloor,
  writeConversationIdFloor
} from './conversations-disk'

/**
 * LE DÉFAUT, vécu par l'utilisateur le 2026-08-24, et sa plainte était exacte : « conv-1393 regarde
 * je l'ai fait c'est marqué échec dans le graph ».
 *
 * Ce n'était pas SON échec. `conv-1393` avait été créée le matin pour des tests, puis supprimée ;
 * l'identifiant est redevenu libre parce que `nextId` était recalculé comme `max + 1` sur les
 * conversations VIVANTES. La conversation créée l'après-midi a donc récupéré le même identifiant, et
 * un run vieux de SIX HEURES, portant un verdict `red`, s'est affiché dans son graphe. Son vrai
 * travail, lui, tournait encore.
 *
 * La cause n'est pas la suppression : c'est qu'un identifiant reste RÉFÉRENCÉ par des runs longtemps
 * après la mort de sa conversation. On ne le réattribue donc jamais.
 */

const dir = mkdtempSync(join(tmpdir(), 'aos-idfloor-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let n = 0
const chemin = (): string => join(dir, `c${(n += 1)}`, 'conversations.json')

describe('un identifiant de conversation n’est jamais réattribué', () => {
  it('ne redonne PAS l’identifiant de la conversation supprimée, même après redémarrage', () => {
    const p = chemin()
    const matin = new ConversationStore(() => 1000)
    persistConversations(matin, p)
    const jetable = matin.create({ title: 'test du matin', provider: 'codex' })
    matin.remove(jetable.id)

    // « Redémarrage » : un store neuf branché sur le même fichier.
    const apresMidi = new ConversationStore(() => 2000)
    persistConversations(apresMidi, p)
    const neuve = apresMidi.create({ title: 'travail de l’après-midi', provider: 'codex' })

    expect(neuve.id).not.toBe(jetable.id)
  })

  it('ne réattribue pas non plus quand PLUSIEURS conversations hautes sont supprimées', () => {
    // Le cas réel : trois conversations de test créées puis retirées d'un coup.
    const p = chemin()
    const matin = new ConversationStore(() => 1000)
    persistConversations(matin, p)
    const jetables = ['a', 'b', 'c'].map((t) => matin.create({ title: t, provider: 'codex' }))
    for (const j of jetables) matin.remove(j.id)

    const apresMidi = new ConversationStore(() => 2000)
    persistConversations(apresMidi, p)
    const neuves = [1, 2, 3].map((i) =>
      apresMidi.create({ title: `neuve ${i}`, provider: 'codex' })
    )

    const anciens = new Set(jetables.map((j) => j.id))
    expect(neuves.filter((c) => anciens.has(c.id))).toEqual([])
  })

  it('continue d’allouer des identifiants LISIBLES, pas des UUID', () => {
    // Une garde trop brutale (basculer sur `randomUUID` dès la moindre suppression) rendrait les
    // identifiants illisibles dans tous les journaux. Le plancher monte, la forme ne change pas.
    const p = chemin()
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    const premiere = store.create({ title: 'x', provider: 'codex' })
    store.remove(premiere.id)

    expect(store.create({ title: 'y', provider: 'codex' }).id).toMatch(/^conv-\d+$/)
  })

  it('une seconde hydratation avec MOINS de conversations ne fait pas descendre le plancher', () => {
    /*
     * Ligne defensive rendue PORTEUSE par ce test. Le sabotage l'avait montree inutile : retirer le
     * `Math.max` de `hydrate` ne cassait rien, parce que la couche disque releve le plancher juste
     * apres. Mais `hydrate` est publique et rappelable -- une seconde hydratation appauvrie ferait
     * alors reculer le compteur. Une garde non testee n'est pas une garde.
     */
    const store = new ConversationStore(() => 1000)
    store.hydrate([
      {
        schemaVersion: 3,
        id: 'conv-77',
        title: 'haute',
        provider: 'codex',
        messages: [],
        createdAt: 1,
        updatedAt: 1
      }
    ] as never)
    const plancherHaut = store.idFloor()

    store.hydrate([] as never)

    expect(store.idFloor()).toBe(plancherHaut)
  })

  it('le plancher persisté ne DESCEND jamais', () => {
    const p = chemin()
    writeConversationIdFloor(50, p)
    writeConversationIdFloor(10, p)

    expect(readConversationIdFloor(p)).toBe(50)
  })

  it('un plancher absent ou illisible ne bloque pas le démarrage', () => {
    // L'entrée qui doit faire échouer une lecture trop stricte : premier démarrage, aucun fichier.
    const p = chemin()

    expect(readConversationIdFloor(p)).toBe(0)
    expect(() => persistConversations(new ConversationStore(() => 1000), p)).not.toThrow()
  })
})
