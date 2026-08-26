import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { construireVoisinage } from './voisinage'

/**
 * LES RAPPROCHEMENTS SE DERIVENT DU CORPUS, ILS NE S'ECRIVENT PAS A LA MAIN.
 *
 * Le lexique de familles reglait le cas connu (« badges » -> « pastilles ») mais restait une liste
 * FINIE : chaque mot nouveau demandait une ligne de code. Une couverture qui s'etend au cas par cas
 * n'est pas un savoir, c'est un rattrapage permanent.
 *
 * Le corpus, lui, PORTE ces liens. Quand quelqu'un ecrit « les badges, enfin les pastilles », les
 * deux mots se rencontrent ; quand ils designent la meme chose, ils reviennent dans les memes
 * phrases. Cette cooccurrence se mesure -- et elle se met a jour toute seule, a chaque message
 * ajoute, sans qu'on la maintienne.
 *
 * CE QUE CELA NE FAIT PAS, et il faut le dire precisement : un mot ABSENT du corpus entier reste
 * introuvable. Mais alors aucune conversation ne l'emploie -- il n'y a rien a retrouver. La lacune
 * n'est pas dans la recherche, elle est dans l'absence de matiere.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE VOISINAGE EST TROP LARGE : deux mots qui se croisent
 * UNE fois par hasard ne doivent pas devenir interchangeables. Le dernier cas garde ce bord.
 */

function corpusQuiPorteLeLien(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  // Trois messages ou les deux mots se rencontrent : le corpus ENSEIGNE le lien.
  const glossaire = store.create({ title: 'Glossaire', provider: 'claude' })
  store.append(glossaire.id, { role: 'user', content: 'les macarons, enfin les rondelles de statut' })
  store.append(glossaire.id, { role: 'user', content: 'ces macarons et ces rondelles, meme chose' })
  store.append(glossaire.id, { role: 'user', content: 'macarons ou rondelles, comme tu veux' })
  // La conversation cible n'emploie QUE l'un des deux mots.
  const cible = store.create({ title: 'Cible', provider: 'claude' })
  store.append(cible.id, { role: 'user', content: 'explique-moi les rondelles de statut' })
  // Un croisement unique, fortuit : ne doit rien lier.
  const hasard = store.create({ title: 'Hasard', provider: 'claude' })
  store.append(hasard.id, { role: 'user', content: 'kubernetes et rondelles dans la meme phrase' })
  return store
}

describe('le corpus enseigne ses propres rapprochements', () => {
  it('« macarons » retrouve « rondelles », appris du corpus et d aucune liste', () => {
    const trouve = corpusQuiPorteLeLien().search('macarons')
    expect(trouve.map((c) => c.title)).toContain('Cible')
  })

  it('le mot cherche directement marche toujours', () => {
    expect(corpusQuiPorteLeLien().search('rondelles').map((c) => c.title)).toContain('Cible')
  })

  it('un croisement unique et fortuit ne rend PAS deux mots interchangeables', () => {
    // « kubernetes » n'a croise « rondelles » qu'une fois : chercher kubernetes ne doit pas
    // ramener toute conversation parlant de rondelles.
    expect(corpusQuiPorteLeLien().search('kubernetes').map((c) => c.title)).not.toContain('Cible')
  })

  it('APPREND en continu : un lien ajoute apres coup est pris en compte', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const cible = store.create({ title: 'Cible', provider: 'claude' })
    store.append(cible.id, { role: 'user', content: 'explique-moi les rondelles de statut' })

    // Avant que le corpus enseigne le lien, « macarons » ne mene a rien.
    expect(store.search('macarons')).toEqual([])

    // L'utilisateur emploie les deux mots ensemble : le corpus vient d'apprendre.
    const glossaire = store.create({ title: 'Glossaire', provider: 'claude' })
    store.append(glossaire.id, { role: 'user', content: 'macarons ou rondelles, meme chose' })
    store.append(glossaire.id, { role: 'user', content: 'ces macarons, ces rondelles' })

    // Un index garde sans invalidation repondrait encore « rien » : il rapprocherait selon un
    // corpus qui n'existe plus.
    expect(store.search('macarons').map((c) => c.title)).toContain('Cible')
  })

  it('reste rapide sur un corpus bavard', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    for (let index = 0; index < 400; index++) {
      const c = store.create({ title: 'sujet ' + index, provider: 'claude' })
      store.append(c.id, { role: 'user', content: `message ${index} au sujet des rondelles et du statut` })
    }
    const debut = Date.now()
    store.search('rondelles', { limite: 5 })
    // Premiere recherche = construction de l'index comprise.
    expect(Date.now() - debut).toBeLessThan(4_000)
  })

  it('un mot absent du corpus entier ne rend rien -- il n y a rien a retrouver', () => {
    expect(corpusQuiPorteLeLien().search('zzzabsentpartout')).toEqual([])
  })
})

/**
 * UN MOT ECARTE POUR BANALITE N'EST PAS UN MOT INCONNU.
 *
 * `TROP_COURANTS` retire du comptage les mots qui voisinent avec tout ; `rarete` leur rendait donc 1
 * -- la valeur du doute, qui est aussi la plus favorable. Le systeme les declarait non discriminants
 * d'un cote et les sacrait les plus rares de tous de l'autre. Mesure du 2026-08-26 : « dans » arrivait
 * juste derriere « projet » au score de porteur, alors qu'il ne porte aucun sujet.
 */
describe('rarete : banalite et ignorance ne se confondent pas', () => {
  it('un mot trop courant recoit le plancher, un mot inconnu garde le benefice du doute', () => {
    const index = construireVoisinage(
      ['le statut du travail avance bien ici', 'un autre message avec des mots dedans'],
      (texte) => texte.toLowerCase().split(/[^a-z0-9]+/).filter((m) => m.length >= 3)
    )
    // « dans » est dans TROP_COURANTS : il ne peut pas etre le mot le plus rare de la demande.
    expect(index.rarete('dans')).toBeLessThan(0.2)
    // Un mot jamais vu garde 1 : on ne le penalise pas d'etre absent, c'est peut-etre le seul precis.
    expect(index.rarete('zarbitrophage')).toBe(1)
    // Et il doit rester STRICTEMENT au-dessus du mot banal, sinon le choix du porteur les confond.
    expect(index.rarete('zarbitrophage')).toBeGreaterThan(index.rarete('dans'))
  })
})
