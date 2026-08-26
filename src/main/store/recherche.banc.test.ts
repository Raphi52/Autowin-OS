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

/**
 * LE PROFIL LEXICAL, car c'est lui qui cree la CONCURRENCE.
 *
 * La premiere version du banc calibrait la rarete mais ne mordait pas : son bruit tenait en quinze
 * mots courants, si bien qu'un mot d'adresse comme « rappelle » y etait ABSENT et ne rivalisait avec
 * rien. Or dans le corpus reel, « rappelle » a une frequence documentaire de QUATRE -- exactement la
 * tranche des termes qu'on cherche. C'est ce voisinage qui rend le choix du porteur difficile.
 *
 * Profil vise, mesure le 2026-08-26 sur 1203 conversations : 29 524 mots distincts, 55,6 % presents
 * dans une seule conversation, 27,5 % dans deux a cinq.
 */
describe('profil lexical du banc', () => {
  function frequences(store: ReturnType<typeof bancDEssai>): Map<string, number> {
    const df = new Map<string, number>()
    for (const conversation of store.list()) {
      const vus = new Set<string>()
      for (const message of conversation.messages) {
        if (typeof message.content !== 'string') continue
        for (const mot of message.content.split(/[^a-z0-9]+/)) if (mot.length >= 3) vus.add(mot)
      }
      for (const mot of vus) df.set(mot, (df.get(mot) ?? 0) + 1)
    }
    return df
  }

  it('la majorite du vocabulaire n’apparait que dans une ou deux conversations', () => {
    const df = frequences(bancDEssai({ conversations: 250 }))
    expect(df.size).toBeGreaterThan(3000)
    const hapax = [...df.values()].filter((v) => v === 1).length
    // Le reel est a 55,6 % ; on exige seulement que la queue DOMINE, pas qu'elle soit identique.
    expect(hapax / df.size).toBeGreaterThan(0.35)
  })

  it('les mots d’adresse tombent dans la tranche des termes cherches, donc les concurrencent', () => {
    const df = frequences(bancDEssai({ conversations: 250 }))
    // « rappelle » vaut 4 dans le corpus reel. Ici on exige seulement qu'il soit PRESENT et RARE :
    // present, sinon il ne concurrence rien ; rare, sinon il n'est plus un concurrent credible.
    const adresse = df.get('rappelle') ?? 0
    expect(adresse).toBeGreaterThan(0)
    expect(adresse).toBeLessThan(30)
  })
})
