import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * /draft : LE BLOC DE CHOIX EST OBLIGATOIRE, SUJET 3D COMPRIS.
 *
 * Constat du 2026-10-17 (journal des tours) : les quatre tours /draft fautifs portaient tous sur le
 * fond 3D de l'Accueil. La procédure envoyait ce « sujet en VOLUME » vers des scènes ```threejs, et
 * réservait les boutons de choix au carrousel des maquettes HTML : pour la 3D, il ne restait que
 * « Préfère AskUserQuestion, sinon demande ». Tours c7d72274-db73-49bd-93fe-435f6647863a et
 * 40cbea6c-99bf-405f-8ad6-1e709913766a (conv-310), 4c898868-7bfa-4535-8300-c2802e61cf10 (conv-311) :
 * scènes threejs puis `ask`. Tour 938a67c1-78bc-4bc5-addf-865167663f44 (conv-312) : une vidéo puis
 * `ask`, et « je vois pas le block draft pour faire mon choix » (saisie ts 1792247730596).
 */
const SKILL = readFileSync(join(__dirname, '..', '..', 'skills', 'draft', 'SKILL.md'), 'utf8')

describe('procédure /draft : un bloc de choix à chaque fournée, sujet 3D compris', () => {
  it('donne au sujet 3D le même carrousel de choix, avec une fiche par proposition', () => {
    const regle = SKILL.split('\n').find((ligne) => ligne.includes('BLOC DE CHOIX, À CHAQUE FOURNÉE'))
    expect(regle, 'paragraphe « BLOC DE CHOIX, À CHAQUE FOURNÉE » absent').toBeTruthy()
    expect(regle).toMatch(/threejs/)
    expect(regle).toMatch(/draft-carrousel\.mjs/)
    expect(regle).toMatch(/fiche/)
    expect(regle).toMatch(/vidéo/)
  })

  it('ne justifie plus les 6 propositions par la capacité de la question cliquable', () => {
    const plafond = SKILL.split('\n').find((ligne) => ligne.startsWith('- K = **6**'))
    expect(plafond).toBeTruthy()
    expect(plafond).not.toMatch(/question cliquable/)
  })
})
