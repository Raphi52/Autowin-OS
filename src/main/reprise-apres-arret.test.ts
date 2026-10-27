import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTurnMessageBlocks, buildTurnMessages } from './chat-turn-messages'
import {
  NOTE_REPRISE_APRES_ARRET,
  contenusDesToursArretes,
  noteRepriseApresArret
} from './reprise-apres-arret'

/**
 * conv-1142 (2026-10-25) : après un tour coupé juste après un résultat d'outil, le CLI insère à la
 * reprise « Continue from where you left off. » puis une réponse synthétique « No response
 * requested. » (83 cas relevés dans les sessions du poste). L'explication vivait dans la
 * constitution, relue à chaque tour ; elle part désormais avec le seul message qui suit un tour arrêté.
 */
describe('contenusDesToursArretes — lu dans le statut du store', () => {
  it('retient Stop, fermeture et erreur, jamais un tour terminé ni un message utilisateur', () => {
    const contenus = contenusDesToursArretes([
      { role: 'assistant', content: 'stoppé', status: 'cancelled' },
      { role: 'assistant', content: 'fermé', status: 'interrupted' },
      { role: 'assistant', content: 'erreur', status: 'failed' },
      { role: 'assistant', content: 'fini', status: 'completed' },
      { role: 'assistant', content: 'en cours', status: 'streaming' },
      { role: 'assistant', content: 'ancien format' },
      { role: 'user', content: 'demande', status: 'cancelled' }
    ])
    expect([...contenus].sort()).toEqual(['erreur', 'fermé', 'stoppé'])
  })
})

describe('noteRepriseApresArret — seulement quand le DERNIER tour de l agent s est arrêté', () => {
  it('rend la note après un tour arrêté', () => {
    const note = noteRepriseApresArret([
      { role: 'user' },
      { role: 'assistant', arrete: true },
      { role: 'user' }
    ])
    expect(note).toBe(NOTE_REPRISE_APRES_ARRET)
    expect(note).toContain('« No response requested. »')
    expect(note).toContain('« Continue from where you left off. »')
    expect(note).toMatch(/ni de l'utilisateur ni de toi/u)
  })

  it('saute une consigne envoyée pendant le tour arrêté', () => {
    expect(
      noteRepriseApresArret([
        { role: 'assistant', arrete: true },
        { role: 'user', orientation: true },
        { role: 'user' }
      ])
    ).toBe(NOTE_REPRISE_APRES_ARRET)
  })

  it('rien quand le dernier tour est terminé, même si un tour plus ancien s est arrêté', () => {
    expect(
      noteRepriseApresArret([
        { role: 'assistant', arrete: true },
        { role: 'user' },
        { role: 'assistant' },
        { role: 'user' }
      ])
    ).toBe('')
  })

  it('rien quand le dernier message n est pas une demande, ou sans historique', () => {
    expect(noteRepriseApresArret([{ role: 'user' }, { role: 'assistant', arrete: true }])).toBe('')
    expect(noteRepriseApresArret([])).toBe('')
    expect(noteRepriseApresArret([{ role: 'user' }])).toBe('')
  })
})

describe('le message envoyé au modèle porte la note, juste avant la demande', () => {
  const history = [
    { role: 'user', content: 'lance le build' },
    { role: 'assistant', content: 'Je lance…', arrete: true },
    { role: 'user', content: 'reprends' }
  ]
  const base = {
    snapshot: {},
    brainContext: '',
    memoryEcho: '',
    history,
    lastUserMessage: 'reprends'
  }

  it('session reprise après un arrêt : la note précède la demande', () => {
    const blocs = buildTurnMessageBlocks({ ...base, resumeSessionId: 's' })
    const noms = blocs.map((b) => b.name)
    expect(noms).toContain('repriseApresArret')
    expect(noms.indexOf('repriseApresArret')).toBe(noms.indexOf('messageUtilisateur') - 1)
  })

  it('session reprise sans arrêt : aucune note', () => {
    const h = history.map(({ arrete: _arrete, ...m }) => m)
    const texte = buildTurnMessages({ ...base, history: h, resumeSessionId: 's' }).join('\n')
    expect(texte).not.toContain('No response requested')
  })

  it('session neuve (fil aplati par l app, sans ligne du CLI) : aucune note', () => {
    const texte = buildTurnMessages(base).join('\n')
    expect(texte).not.toContain('No response requested')
  })
})

/**
 * Contrat de SOURCE (même idiome que run-pilot-chat.orientation.test.ts, conv-844) : le renderer
 * n'envoie pas le statut d'un message, `run-pilot-chat.ts` le relit dans le store. Ne prouve pas
 * le chemin de bout en bout.
 */
describe('le drapeau arrete atteint le pilote', () => {
  const source = readFileSync(join(__dirname, 'chat', 'run-pilot-chat.ts'), 'utf8')
  it('relit le statut dans le store et pose le drapeau sur le message de l agent', () => {
    expect(source).toMatch(/contenusDesToursArretes\(/u)
    expect(source).toMatch(/toursArretes\.has\(m\.content\) \? \{ arrete: true \}/u)
  })
})
