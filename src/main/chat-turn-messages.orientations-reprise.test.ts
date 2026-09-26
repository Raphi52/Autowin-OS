import { describe, expect, it } from 'vitest'
import { buildTurnMessages } from './chat-turn-messages'

// conv-844 : saisie ts 1790273878476 perdue apres redemarrage, tour « reprend » ts 1790274416782.
const history = [
  { role: 'user', content: '/draft une view plus cool pour cet onglet' },
  { role: 'assistant', content: 'Voici 6 directions...' },
  { role: 'user', content: '/kaizen tu me met 2x les ask en ce moment c con' },
  { role: 'user', content: '/draft le 5 mais en vertical apres', orientation: true },
  { role: 'assistant', content: '[a exécuté orchestrate]' },
  { role: 'user', content: 'reprend' }
]
const base = { snapshot: {}, brainContext: '', memoryEcho: '', history }

describe('orientation du tour precedent remise a une session reprise', () => {
  it('la consigne /draft le 5 part avec « reprend »', () => {
    const texte = buildTurnMessages({ ...base, resumeSessionId: 's', lastUserMessage: 'reprend' }).join('\n')
    expect(texte).toContain('> /draft le 5 mais en vertical apres')
  })
  it('rien quand aucune orientation depuis la derniere demande', () => {
    const h = [...history.slice(0, 2), { role: 'user', content: 'ok' }]
    const texte = buildTurnMessages({ ...base, history: h, resumeSessionId: 's', lastUserMessage: 'ok' }).join('\n')
    expect(texte).not.toContain('CONSIGNES QUE')
  })
  it('les anciennes orientations ne ressortent pas', () => {
    const h = [...history, { role: 'assistant', content: 'x' }, { role: 'user', content: 'suite' }]
    const texte = buildTurnMessages({ ...base, history: h, resumeSessionId: 's', lastUserMessage: 'suite' }).join('\n')
    expect(texte).not.toContain('/draft le 5')
  })
})
