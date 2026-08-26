import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { ajouterConversation, bancDEssai, remplissage } from './recherche.test-helpers'

/**
 * LE BANC D'ESSAI TIENT-IL SA PROMESSE ?
 *
 * Un banc d'essai non teste est un instrument dont on ignore l'etalonnage. Celui-ci promet une seule
 * chose : que la rarete y SEPARE, comme en production. Trois fois le 2026-08-26, un test ecrit sur une
 * douzaine de conversations a rendu un verdict faux -- parce que `rarete` vaut
 * `log(1 / part) / log(messagesVus + 1)` et que sur treize messages ce denominateur compresse tout.
 */
describe('banc d’essai de la recherche', () => {
  it('la rarete y separe les mots courants du terme rare', () => {
    const store = bancDEssai({ conversations: 250 })
    ajouterConversation(store, 'Cible', [`${remplissage(600)}\nzarbitro et zarbitro\n${remplissage()}`])
    store.search('amorce', { limite: 1 })
    const index = (store as unknown as { voisinage: () => { rarete: (m: string) => number } }).voisinage()

    // Les mots du bruit sont partout : ils doivent tomber au plancher.
    for (const courant of ['projet', 'decide', 'ensemble']) {
      expect(index.rarete(courant)).toBeLessThan(0.2)
    }
    // Le terme rare garde une valeur haute : l'ecart est ce qui rend un test interpretable.
    expect(index.rarete('zarbitro')).toBeGreaterThan(0.8)
  })

  it('sur un mini-corpus, la rarete ne separe PAS -- c’est la raison d’etre du banc', () => {
    // Contre-epreuve : le meme montage a treize conversations rend « projet » aussi rare que le terme
    // recherche, parce qu'il n'y figure pas du tout et recoit la valeur du doute.
    let horloge = 1000
    const mini = new ConversationStore(() => horloge++)
    for (let i = 0; i < 12; i++) {
      const c = mini.create({ title: `B${i}`, provider: 'claude' })
      mini.append(c.id, { role: 'user', content: 'on avait decide ensemble cette semaine' })
    }
    mini.search('amorce', { limite: 1 })
    const index = (mini as unknown as { voisinage: () => { rarete: (m: string) => number } }).voisinage()
    expect(index.rarete('projet')).toBe(index.rarete('zarbitro'))
  })

  it('le corpus est deterministe : meme graine, meme resultat', () => {
    const a = bancDEssai({ conversations: 30, seed: 7 })
    const b = bancDEssai({ conversations: 30, seed: 7 })
    const textes = (s: ConversationStore): string =>
      s.list().map((c) => c.messages.map((m) => String(m.content)).join('|')).join('#')
    expect(textes(a)).toBe(textes(b))
  })
})
