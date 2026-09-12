import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import {
  configureSessionMemoryEcho,
  forgetEcho,
  noteRemembered,
  rememberedFacts
} from './session-memory-echo'

/**
 * CE QUE LE PILOTE DIT DE SA MEMOIRE DOIT ETRE CE QUE LE CODE FAIT.
 *
 * Le prompt annonçait « l'écho est local et disparaît si l'application redémarre ». C'est faux :
 * `configureSessionMemoryEcho` RELIT `session-memory.json` au démarrage (src/main/index.ts:505), et
 * ce fichier pesait 134 ko le 2026-09-12. Avec 68 redémarrages relevés dans les traces, le pilote
 * poussait donc l'utilisateur à redire des faits déjà gardés.
 *
 * Ce test tient les deux bouts ensemble : il PROUVE la relecture sur disque, puis exige que le
 * prompt ne contredise plus cette preuve.
 */
describe('mémoire du fil : le prompt dit ce que le code fait', () => {
  it('relit réellement les faits après un redémarrage simulé', () => {
    const store = join(mkdtempSync(join(tmpdir(), 'echo-redemarrage-')), 'session-memory.json')
    configureSessionMemoryEcho(store)
    noteRemembered('conv-1', {
      title: 'Le client impose une fenêtre de 30 s',
      body: 'Contrainte posée par le client X, vérifiée le 2026-09-12.',
      scope: 'autowin-os',
      state: 'depose'
    })
    // Le redémarrage : on jette l'état en mémoire et on relit uniquement le disque.
    configureSessionMemoryEcho()
    expect(rememberedFacts('conv-1')).toHaveLength(0)
    configureSessionMemoryEcho(store)
    expect(rememberedFacts('conv-1').map((fact) => fact.title)).toContain(
      'Le client impose une fenêtre de 30 s'
    )
    forgetEcho()
  })

  it('un fichier illisible fait bien retomber l’écho à zéro — la limite annoncée est réelle', () => {
    const store = join(mkdtempSync(join(tmpdir(), 'echo-illisible-')), 'session-memory.json')
    writeFileSync(store, '{ pas du json', 'utf8')
    configureSessionMemoryEcho(store)
    expect(rememberedFacts('conv-1')).toHaveLength(0)
  })

  it('le prompt n’annonce plus une disparition au redémarrage', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).not.toContain("disparaît si l'application redémarre")
    expect(prompt).toContain('il SURVIT au redémarrage')
  })
})
