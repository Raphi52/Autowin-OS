import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendPromptCall,
  attendreEcrituresPromptCalls,
  dossierDesSystemes,
  loadPromptCalls,
  type PromptCallRecord
} from './prompt-observability'

/**
 * 64 % des 572 Mo de journaux de ce poste etaient le MEME prompt systeme recopie : 2 487 appels
 * pour 44 versions distinctes (mesure du 2026-09-12). Ces tests fixent le remede et, surtout, la
 * promesse qui va avec : un lecteur continue de recevoir `system` en clair.
 */
const SYSTEME = `# Constitution\n${'reflexe cardinal '.repeat(600)}`

const appel = (conversationId: string, system?: string): Omit<PromptCallRecord, 'id' | 'ts'> => ({
  conversationId,
  turnId: 't1',
  iteration: 0,
  actor: 'supervisor',
  provider: 'claude',
  transport: 'test',
  boundary: 'test',
  limitation: 'test',
  system,
  messages: [],
  options: {},
  response: 'ok'
})

let racine: string

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'autowin-prompt-obs-'))
})
afterEach(() => {
  rmSync(racine, { recursive: true, force: true })
})

describe('prompt systeme range a part', () => {
  it('n ecrit le prompt systeme QU UNE fois pour 20 appels identiques', async () => {
    for (let i = 0; i < 20; i += 1) appendPromptCall(appel('conv-1', SYSTEME), racine)
    await attendreEcrituresPromptCalls()
    expect(readdirSync(dossierDesSystemes(racine))).toHaveLength(1)
    // Le journal ne porte plus le prompt : il pese une fraction de ce qu'il pesait.
    const journal = readFileSync(join(racine, 'conv-1.jsonl'), 'utf8')
    expect(journal).not.toContain('reflexe cardinal')
    expect(statSync(join(racine, 'conv-1.jsonl')).size).toBeLessThan(SYSTEME.length)
  })

  it('rend le prompt systeme EN CLAIR a la relecture — aucun lecteur ne change', async () => {
    appendPromptCall(appel('conv-2', SYSTEME), racine)
    await attendreEcrituresPromptCalls()
    const relus = loadPromptCalls('conv-2', racine)
    expect(relus).toHaveLength(1)
    expect(relus[0].system).toBe(SYSTEME)
  })

  it("rend l'appel avec son `system` en clair a l'appelant, sans attendre le disque", () => {
    const rendu = appendPromptCall(appel('conv-3', SYSTEME), racine)
    expect(rendu.system).toBe(SYSTEME)
  })

  it('laisse un petit prompt en clair : deduplicater couterait plus cher que recopier', async () => {
    appendPromptCall(appel('conv-4', 'systeme court'), racine)
    await attendreEcrituresPromptCalls()
    expect(readFileSync(join(racine, 'conv-4.jsonl'), 'utf8')).toContain('systeme court')
    expect(loadPromptCalls('conv-4', racine)[0].system).toBe('systeme court')
  })

  it('un appel SANS prompt systeme reste lisible et ne cree aucun fichier d empreinte', async () => {
    appendPromptCall(appel('conv-5'), racine)
    await attendreEcrituresPromptCalls()
    expect(loadPromptCalls('conv-5', racine)[0].system).toBeUndefined()
    expect(readdirSync(racine).filter((n) => n === 'systems')).toHaveLength(0)
  })
})
