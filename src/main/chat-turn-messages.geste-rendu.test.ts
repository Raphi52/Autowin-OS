import { describe, expect, it } from 'vitest'
import { exigeFaireLeGeste, RELANCE_FAIRE_LE_GESTE } from './chat-turn-messages'

// Cas réel : tour c4e319ca-783f-4b49-9b87-971cd6392c8e (conv-843, saisie ts 1790275899514
// « fais le »), iteration 4 : après desktop_act/desktop_observe, le chat a rendu la saisie du code.
const REPONSE_C4E319CA =
  "⚠️ **Je n'ai pas pu saisir le code à ta place.**\n\n**À faire (30 secondes) :**\n" +
  '1. Va dans Brave : la page **https://login.microsoft.com/device** devrait déjà y être ouverte.\n' +
  '2. Saisis le code **`CAP56FNHZ`**.'

describe('exigeFaireLeGeste', () => {
  it('refuse de rendre à l’utilisateur un geste d’écran quand le bureau était piloté (c4e319ca)', () => {
    expect(exigeFaireLeGeste(REPONSE_C4E319CA, true)).toBe(true)
  })
  it('ne mord pas sans outil de bureau utilisé dans le tour', () => {
    expect(exigeFaireLeGeste(REPONSE_C4E319CA, false)).toBe(false)
  })
  it('laisse passer un compte-rendu sans consigne manuelle', () => {
    expect(exigeFaireLeGeste('✅ J’ai saisi le code, la page confirme la connexion.', true)).toBe(false)
  })
  it('laisse passer le mot de passe, vraie limite', () => {
    expect(exigeFaireLeGeste('À faire : saisis ton mot de passe Microsoft.', true)).toBe(false)
  })
  it('la relance cite le cas mesuré', () => {
    expect(RELANCE_FAIRE_LE_GESTE).toContain('c4e319ca')
  })
})
