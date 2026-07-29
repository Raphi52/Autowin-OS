import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendTurnEvent, listUnfinishedTurns } from './turn-journal'

/**
 * TOUR ZOMBIE — un tour qui échoue doit se CONCLURE, jamais disparaître.
 *
 * Constaté en réel le 2026-07-29 : une erreur d'API répétée (filtre de contenu) fait jeter le pilote
 * après 2 tentatives. Le `catch` de `os:pilotChat` écrivait alors l'état terminal dans le STORE mais
 * PAS dans le journal fichier — le tour restait « inachevé » indéfiniment et la reprise automatique le
 * rejouait à chaque démarrage. Journal observé : ['delta','stream-reset','delta'], aucun terminal.
 *
 * Deuxième piège, attrapé en vérifiant : le store dit `failed`, le journal listait `error` parmi ses
 * kinds terminaux. Écrire `failed` sans l'ajouter à cette liste aurait donné un correctif INOPÉRANT.
 */
let root = mkdtempSync(join(tmpdir(), 'turn-terminal-'))
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  root = mkdtempSync(join(tmpdir(), 'turn-terminal-'))
})

const started = (conv: string, turn: string): void => {
  appendTurnEvent(root, conv, turn, { kind: 'delta', text: 'début…', at: 1 })
}

describe('un tour ÉCHOUÉ n’est plus zombie', () => {
  it('sans événement terminal, le tour est bien signalé inachevé (le symptôme)', () => {
    started('conv-1', 'turn-a')
    appendTurnEvent(root, 'conv-1', 'turn-a', { kind: 'stream-reset', at: 2 })
    expect(listUnfinishedTurns(root).map((t) => t.turnId)).toEqual(['turn-a'])
  })

  it('`failed` CLÔTURE le tour (vocabulaire du store)', () => {
    started('conv-1', 'turn-b')
    appendTurnEvent(root, 'conv-1', 'turn-b', { kind: 'failed', error: 'API Error', at: 3 })
    expect(listUnfinishedTurns(root)).toEqual([])
  })

  it('`error` CLÔTURE aussi (vocabulaire du flux d’événements)', () => {
    started('conv-1', 'turn-c')
    appendTurnEvent(root, 'conv-1', 'turn-c', { kind: 'error', at: 3 })
    expect(listUnfinishedTurns(root)).toEqual([])
  })

  it('`cancelled` et `done` restent terminaux (non-régression)', () => {
    started('conv-1', 'turn-d')
    appendTurnEvent(root, 'conv-1', 'turn-d', { kind: 'cancelled', at: 3 })
    started('conv-1', 'turn-e')
    appendTurnEvent(root, 'conv-1', 'turn-e', { kind: 'done', at: 3 })
    expect(listUnfinishedTurns(root)).toEqual([])
  })

  it('un tour échoué et un tour vivant coexistent sans confusion', () => {
    started('conv-1', 'turn-mort')
    appendTurnEvent(root, 'conv-1', 'turn-mort', { kind: 'failed', error: 'boom', at: 3 })
    started('conv-1', 'turn-vivant')
    expect(listUnfinishedTurns(root).map((t) => t.turnId)).toEqual(['turn-vivant'])
  })
})

/**
 * Contrat de CÂBLAGE : le `catch` du handler doit écrire dans les DEUX destinations. Sans l'écriture
 * fichier, la détection ci-dessus ne verrait jamais l'état terminal.
 */
describe('câblage — le catch de pilotChat écrit l’état terminal au journal', () => {
  const main = (): string =>
    readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')

  it('écrit dans le store ET dans le journal fichier', () => {
    const source = main()
    const catchBlock = source.slice(source.indexOf('const terminal = controller.signal.aborted'))
    expect(catchBlock).toContain('os.conversations.applyTurnEvent(conversationId, turnId, terminal)')
    expect(catchBlock).toContain('appendTurnEvent(turnJournalRoot, conversationId, turnId, {')
  })

  it('l’écriture de trace ne masque JAMAIS l’erreur d’origine', () => {
    const source = main()
    const catchBlock = source.slice(source.indexOf('const terminal = controller.signal.aborted'))
    const journalWrite = catchBlock.slice(catchBlock.indexOf('appendTurnEvent'))
    expect(journalWrite).toContain('catch')
    // L'erreur d'origine doit toujours etre remontee a l'appelant.
    expect(catchBlock).toContain('return { ok: false')
  })

  it('distingue une ANNULATION d’un ÉCHEC', () => {
    const source = main()
    const catchBlock = source.slice(source.indexOf('const terminal = controller.signal.aborted'))
    expect(catchBlock).toContain("kind: 'cancelled'")
    expect(catchBlock).toContain("kind: 'failed'")
  })
})
