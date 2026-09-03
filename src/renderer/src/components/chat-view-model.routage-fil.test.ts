import { describe, expect, it } from 'vitest'
import { doitSuivreLeRoutage } from './chat-view-model'

/**
 * DEFAUT VECU LE 2026-09-03 (conv-171) : « je crois que la conv s'est pas cree et que ca a laisse
 * le message ici ». Le routeur avait ouvert conv-170, le message y avait ete envoye, mais l'ecran
 * n'y avait pas basculee. Constat mesure : conv-170 a recu un numero (compteur passe a 179),
 * aucun message, et n'existait plus ensuite. Le texte ne survivait que dans le journal de secours
 * des saisies (`saisies-utilisateur.jsonl`).
 *
 * L'INVARIANT PROUVE ICI : on ne suit le routage QUE si on peut y emmener l'utilisateur. Des
 * qu'une des trois conditions de la bascule d'ecran manque, le message reste dans le fil ou il a
 * ete ecrit.
 */
const base = {
  routed: true,
  cibleId: 'conv-170',
  sourceId: 'conv-167',
  filAffiche: 'conv-167',
  cleBrouillonEnvoi: 'conv-167',
  cleBrouillonActuelle: 'conv-167',
  generationSelectionEnvoi: 3,
  generationSelectionActuelle: 3
}

describe('doitSuivreLeRoutage', () => {
  it('suit le routage quand les trois conditions de bascule tiennent', () => {
    expect(doitSuivreLeRoutage(base)).toBe(true)
  })

  it("ne suit PAS le routage quand l'ecran a deja quitte le fil source", () => {
    // Le cas exact du 2026-09-03 : l'utilisateur regarde ailleurs, le message aurait file dans un
    // fil qu'il ne verrait jamais.
    expect(doitSuivreLeRoutage({ ...base, filAffiche: 'conv-171' })).toBe(false)
  })

  it('ne suit PAS le routage quand le brouillon a change pendant que le routeur reflechissait', () => {
    expect(doitSuivreLeRoutage({ ...base, cleBrouillonActuelle: 'conv-172' })).toBe(false)
  })

  it('ne suit PAS le routage quand la selection a change pendant le meme intervalle', () => {
    expect(doitSuivreLeRoutage({ ...base, generationSelectionActuelle: 4 })).toBe(false)
  })

  it('ne suit PAS le routage sans conversation affichee du tout', () => {
    expect(doitSuivreLeRoutage({ ...base, filAffiche: null })).toBe(false)
  })

  it('ne suit rien quand le routeur a dit de rester', () => {
    expect(doitSuivreLeRoutage({ ...base, routed: false })).toBe(false)
  })

  it('ne suit rien quand la cible est le fil source lui-meme', () => {
    expect(doitSuivreLeRoutage({ ...base, cibleId: 'conv-167' })).toBe(false)
  })
})
