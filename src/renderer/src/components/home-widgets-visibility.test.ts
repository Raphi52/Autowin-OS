import { describe, expect, it } from 'vitest'
import { estVisible, type HomeWidgetsVisibility } from './home-widgets-visibility'

describe('visibilite des widgets d accueil', () => {
  it('suit l etat de chaque widget, et laisse visible un widget que l etat ne connait pas', () => {
    const etat = { jarvis: false, mails: true } as unknown as HomeWidgetsVisibility
    expect(estVisible(etat, 'jarvis')).toBe(false)
    expect(estVisible(etat, 'mails')).toBe(true)
    expect(estVisible(etat, 'agenda')).toBe(true)
  })
})
