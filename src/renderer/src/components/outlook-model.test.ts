import { describe, expect, it } from 'vitest'
import {
  formatEventTime,
  splitByExchange,
  formatExchangeDate,
  formatMessageDate,
  extraireCorpsUtile,
  compterFilsNonLus,
  groupByInterlocutor,
  groupThreads,
  normaliserSujet,
  sortByName,
  parseOutlookResult,
  splitAgenda,
  totalUnread,
  type OutlookRawEvent,
  type OutlookRawMail
} from './outlook-model'

const NOW = Date.parse('2026-08-21T14:00:00.000Z')
const JOUR = 86_400_000

function mail(over: Partial<OutlookRawMail>): OutlookRawMail {
  return {
    id: 'm1',
    adresse: 'jean.dupont@amitel.fr',
    nom: 'Jean Dupont',
    sujet: 'Sujet',
    recuLe: new Date(NOW).toISOString(),
    nonLu: false,
    conversation: 'c1',
    ...over
  }
}

function event(over: Partial<OutlookRawEvent>): OutlookRawEvent {
  return {
    id: 'e1',
    sujet: 'Point equipe',
    lieu: 'Teams',
    debut: new Date(NOW + 3600_000).toISOString(),
    fin: new Date(NOW + 2 * 3600_000).toISOString(),
    journeeEntiere: false,
    recurrent: false,
    ...over
  }
}

describe('regroupement par interlocuteur', () => {
  it('reunit sous UN fil le meme contact ecrit avec deux graphies de nom', () => {
    const fils = groupByInterlocutor([
      mail({ id: 'a', nom: 'Jean Dupont', recuLe: new Date(NOW - 2 * JOUR).toISOString() }),
      mail({ id: 'b', nom: 'DUPONT Jean', recuLe: new Date(NOW).toISOString() })
    ])
    expect(fils).toHaveLength(1)
    expect(fils[0].messages.map((m) => m.id)).toEqual(['b', 'a'])
    // Le nom retenu est celui du message le plus RECENT : c'est la graphie a jour.
    expect(fils[0].nom).toBe('DUPONT Jean')
  })

  it('separe deux adresses distinctes portant le meme nom affiche', () => {
    const fils = groupByInterlocutor([
      mail({ id: 'a', adresse: 'contact@a.fr', nom: 'Support' }),
      mail({ id: 'b', adresse: 'contact@b.fr', nom: 'Support' })
    ])
    expect(fils).toHaveLength(2)
  })

  it('ignore la casse de l adresse', () => {
    const fils = groupByInterlocutor([
      mail({ id: 'a', adresse: 'Jean.Dupont@Amitel.FR' }),
      mail({ id: 'b', adresse: 'jean.dupont@amitel.fr' })
    ])
    expect(fils).toHaveLength(1)
  })

  it('garde un message sans adresse en le groupant sur son nom affiche', () => {
    const fils = groupByInterlocutor([mail({ id: 'a', adresse: '', nom: 'Notification systeme' })])
    expect(fils).toHaveLength(1)
    expect(fils[0].nom).toBe('Notification systeme')
  })

  it('ecarte un message sans adresse NI nom, qui ne designe personne', () => {
    expect(groupByInterlocutor([mail({ adresse: '', nom: '' })])).toEqual([])
  })

  it('remonte les fils avec du non lu devant les fils plus recents deja lus', () => {
    const fils = groupByInterlocutor([
      mail({ id: 'recent', adresse: 'a@x.fr', nonLu: false, recuLe: new Date(NOW).toISOString() }),
      mail({
        id: 'vieux',
        adresse: 'b@x.fr',
        nonLu: true,
        recuLe: new Date(NOW - 5 * JOUR).toISOString()
      })
    ])
    expect(fils.map((f) => f.cle)).toEqual(['b@x.fr', 'a@x.fr'])
  })

  it('compte les non lus par fil et au total', () => {
    const fils = groupByInterlocutor([
      mail({ id: 'a', adresse: 'a@x.fr', nonLu: true }),
      mail({ id: 'b', adresse: 'a@x.fr', nonLu: true }),
      mail({ id: 'c', adresse: 'b@x.fr', nonLu: false })
    ])
    expect(fils.find((f) => f.cle === 'a@x.fr')!.nonLus).toBe(2)
    expect(totalUnread(fils)).toBe(2)
  })

  it('supporte une date absente ou invalide sans casser le classement', () => {
    const fils = groupByInterlocutor([
      mail({ id: 'a', adresse: 'a@x.fr', recuLe: null }),
      mail({ id: 'b', adresse: 'b@x.fr', recuLe: 'pas une date' })
    ])
    expect(fils).toHaveLength(2)
    for (const fil of fils) expect(fil.dernierEchange).toBe(0)
  })

  it('remplace un objet vide par une mention explicite', () => {
    expect(groupByInterlocutor([mail({ sujet: '' })])[0].messages[0].sujet).toBe('(sans objet)')
  })
})

describe('decoupage de l agenda', () => {
  it('range aujourd hui, la semaine, et rien au-dela quand la semaine est pleine', () => {
    const agenda = splitAgenda(
      [
        event({ id: 'today', debut: new Date(NOW + 3600_000).toISOString() }),
        event({ id: 'demain', debut: new Date(NOW + JOUR).toISOString() }),
        event({ id: 'loin', debut: new Date(NOW + 30 * JOUR).toISOString() })
      ],
      NOW
    )
    expect(agenda.aujourdHui.map((e) => e.id)).toEqual(['today'])
    expect(agenda.semaine.map((e) => e.id)).toEqual(['demain'])
    expect(agenda.suivant).toBeNull()
  })

  it('annonce le PROCHAIN rendez-vous quand la semaine est vide', () => {
    // Un agenda calme ne doit pas se lire comme une panne.
    const agenda = splitAgenda(
      [event({ id: 'loin', debut: new Date(NOW + 40 * JOUR).toISOString() })],
      NOW
    )
    expect(agenda.aujourdHui).toEqual([])
    expect(agenda.semaine).toEqual([])
    expect(agenda.suivant?.id).toBe('loin')
  })

  it('garde un rendez-vous EN COURS dans aujourd hui', () => {
    const agenda = splitAgenda(
      [
        event({
          id: 'encours',
          debut: new Date(NOW - 600_000).toISOString(),
          fin: new Date(NOW + 1800_000).toISOString()
        })
      ],
      NOW
    )
    expect(agenda.aujourdHui.map((e) => e.id)).toEqual(['encours'])
  })

  it('ecarte un rendez-vous du jour deja TERMINE', () => {
    const agenda = splitAgenda(
      [
        event({
          id: 'passe',
          debut: new Date(NOW - 4 * 3600_000).toISOString(),
          fin: new Date(NOW - 3 * 3600_000).toISOString()
        })
      ],
      NOW
    )
    expect(agenda.aujourdHui).toEqual([])
  })

  it('classe par heure de debut', () => {
    const agenda = splitAgenda(
      [
        event({ id: 'tard', debut: new Date(NOW + 5 * 3600_000).toISOString() }),
        event({ id: 'tot', debut: new Date(NOW + 3600_000).toISOString() })
      ],
      NOW
    )
    expect(agenda.aujourdHui.map((e) => e.id)).toEqual(['tot', 'tard'])
  })

  it('ecarte un rendez-vous a la date illisible', () => {
    expect(splitAgenda([event({ debut: 'nawak' })], NOW).aujourdHui).toEqual([])
  })

  it('etiquette un evenement sur la journee entiere', () => {
    const agenda = splitAgenda([event({ id: 'jour', journeeEntiere: true })], NOW)
    expect(formatEventTime(agenda.aujourdHui[0])).toBe('journée')
  })
})

describe('date lisible du dernier echange', () => {
  it('rend une heure pour aujourd hui, hier pour la veille, et une date au-dela', () => {
    expect(formatExchangeDate(NOW, NOW)).toMatch(/\d{2}[:h]\d{2}/)
    expect(formatExchangeDate(NOW - JOUR, NOW)).toBe('hier')
    expect(formatExchangeDate(NOW - 20 * JOUR, NOW)).toMatch(/\d{2}\/\d{2}/)
    expect(formatExchangeDate(null, NOW)).toBe('')
  })
})

describe('validation de la reponse de la passerelle', () => {
  it('accepte un instantane complet', () => {
    const resultat = parseOutlookResult({
      ok: true,
      luLe: '2026-08-21T12:00:00.000Z',
      boite: 'Boîte de réception',
      mailsNonLus: 3,
      mails: [],
      evenements: []
    })
    expect(resultat.ok).toBe(true)
    if (resultat.ok) expect(resultat.boite).toBe('Boîte de réception')
  })

  it('transporte la cause quand la passerelle a echoue', () => {
    const resultat = parseOutlookResult({ ok: false, erreur: 'Outlook est ferme' })
    expect(resultat).toEqual({ ok: false, erreur: 'Outlook est ferme' })
  })

  it('nomme l echec plutot que de rendre une liste vide trompeuse', () => {
    // Une liste vide se lirait « vous n avez pas de mail » alors qu elle veut dire « la lecture a
    // echoue » : la distinction est tout l objet de cette frontiere.
    for (const mauvais of [null, 'texte', 42, {}, { ok: true }, { ok: true, mails: [] }]) {
      const resultat = parseOutlookResult(mauvais)
      expect(resultat.ok).toBe(false)
      if (!resultat.ok) expect(resultat.erreur.length).toBeGreaterThan(0)
    }
  })
})

describe('une personne n est pas un automate', () => {
  // Friction relevee en PILOTANT l app sur la vraie boite le 2026-08-21 : le widget promettait « mes
  // echanges par interlocuteur » et livrait surtout du bruit machine -- codes a usage unique, ajouts
  // a des groupes, robots de suivi. Sur 23 emetteurs, 3 personnes.
  //
  // Le critere n est PAS une liste noire de domaines : elle serait fausse le jour ou un collegue
  // ecrit depuis un domaine inattendu. C est un fait verifiable -- les adresses auxquelles
  // l utilisateur a ECRIT.
  const messages = [
    mail({ id: 'p', adresse: 'collegue@amitel.fr', nom: 'Collegue', nonLu: false,
      recuLe: new Date(NOW - 5 * JOUR).toISOString() }),
    mail({ id: 'r', adresse: 'otp@notifications.example', nom: 'Codes', nonLu: true,
      recuLe: new Date(NOW).toISOString() })
  ]

  it('place la PERSONNE devant l automate, meme quand l automate a du non lu et est plus recent', () => {
    const fils = groupByInterlocutor(messages, ['collegue@amitel.fr'])
    expect(fils.map((f) => f.cle)).toEqual(['collegue@amitel.fr', 'otp@notifications.example'])
    expect(fils[0].echange).toBe(true)
    expect(fils[1].echange).toBe(false)
  })

  it('ignore la casse de l adresse dans la comparaison', () => {
    const fils = groupByInterlocutor(messages, ['  COLLEGUE@Amitel.FR '])
    expect(fils[0].echange).toBe(true)
  })

  it('ne PRETEND pas savoir quand l information manque', () => {
    // `null` veut dire « je n ai pas pu savoir », ce qui n est pas « aucune personne ». Confondre les
    // deux ferait passer tous les vrais collegues pour des automates.
    for (const inconnu of [undefined, null]) {
      const fils = groupByInterlocutor(messages, inconnu)
      expect(fils.every((f) => f.echange === null)).toBe(true)
      // L ordre retombe alors sur le comportement d avant : non lu d abord.
      expect(fils[0].cle).toBe('otp@notifications.example')
      expect(splitByExchange(fils).indistinct).toBe(true)
    }
  })

  it('separe les deux populations pour l affichage', () => {
    const { personnes, automates, indistinct } = splitByExchange(
      groupByInterlocutor(messages, ['collegue@amitel.fr'])
    )
    expect(personnes.map((f) => f.cle)).toEqual(['collegue@amitel.fr'])
    expect(automates.map((f) => f.cle)).toEqual(['otp@notifications.example'])
    expect(indistinct).toBe(false)
  })

  it('transporte les adresses echangees depuis la passerelle, et distingue absent de vide', () => {
    const avec = parseOutlookResult({
      ok: true, luLe: '', boite: '', mailsNonLus: 0, mails: [], evenements: [],
      adressesEchangees: ['a@x.fr']
    })
    expect(avec.ok && avec.adressesEchangees).toEqual(['a@x.fr'])
    const sans = parseOutlookResult({
      ok: true, luLe: '', boite: '', mailsNonLus: 0, mails: [], evenements: []
    })
    expect(sans.ok && sans.adressesEchangees).toBeNull()
  })
})

describe('fils de conversation d un interlocuteur', () => {
  it('regroupe par identifiant de conversation, du plus ancien au plus recent DANS le fil', () => {
    const [fil] = groupByInterlocutor([
      mail({ id: 'a', conversation: 'c1', sujet: 'Devis', recuLe: new Date(NOW - 3600_000).toISOString() }),
      mail({ id: 'b', conversation: 'c1', sujet: 'RE: Devis', recuLe: new Date(NOW).toISOString() }),
      mail({ id: 'c', conversation: 'c2', sujet: 'Facture', recuLe: new Date(NOW - JOUR).toISOString() })
    ])
    const fils = groupThreads(fil)
    expect(fils.map((f) => f.cle)).toEqual(['c1', 'c2'])
    // Le fil le plus recent en tete, mais A L INTERIEUR on lit de haut en bas comme une discussion.
    expect(fils[0].messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect(fils[0].sujet).toBe('Devis')
  })

  it('retombe sur l objet normalise quand Outlook ne donne pas de conversation', () => {
    const [fil] = groupByInterlocutor([
      mail({ id: 'a', conversation: '', sujet: 'Devis' }),
      mail({ id: 'b', conversation: '', sujet: 'RE: Devis' }),
      mail({ id: 'c', conversation: '', sujet: 'TR: Devis' })
    ])
    expect(groupThreads(fil)).toHaveLength(1)
  })

  it('porte le corps, l auteur et le sens du message', () => {
    const [fil] = groupByInterlocutor([
      mail({ id: 'a', corps: 'Bonjour, ci-joint le devis.' }),
      mail({ id: 'b', corps: 'Merci !', deMoi: true, nom: 'Jean Dupont' })
    ])
    const messages = groupThreads(fil)[0].messages
    expect(messages.map((m) => m.corps)).toEqual(['Bonjour, ci-joint le devis.', 'Merci !'])
    expect(messages.map((m) => m.deMoi)).toEqual([false, true])
    expect(messages[1].auteur).toBe('moi')
  })

  it('compte les non lus du fil, pas ceux de la boite', () => {
    const [fil] = groupByInterlocutor([
      mail({ id: 'a', conversation: 'c1', nonLu: true }),
      mail({ id: 'b', conversation: 'c2', nonLu: false })
    ])
    const fils = groupThreads(fil)
    expect(fils.find((f) => f.cle === 'c1')?.nonLus).toBe(1)
    expect(fils.find((f) => f.cle === 'c2')?.nonLus).toBe(0)
  })

  it('normalise les prefixes de reponse et de transfert', () => {
    expect(normaliserSujet('RE: RE: Devis')).toBe('devis')
    expect(normaliserSujet('TR: Devis')).toBe('devis')
    expect(normaliserSujet('Fwd: Devis')).toBe('devis')
    expect(normaliserSujet('  Devis  ')).toBe('devis')
  })

  it('range les interlocuteurs par NOM quand on le demande', () => {
    // La demande de l utilisateur est une liste « par nom » : l ordre par activite est un autre tri.
    const fils = groupByInterlocutor([
      mail({ id: 'a', adresse: 'zoe@amitel.fr', nom: 'Zoe Martin' }),
      mail({ id: 'b', adresse: 'anne@amitel.fr', nom: 'anne bernard' })
    ])
    expect(sortByName(fils).map((f) => f.nom)).toEqual(['anne bernard', 'Zoe Martin'])
  })

  it('remonte en tete ceux qui ont un nouveau message', () => {
    const fils = groupByInterlocutor([
      mail({ id: 'a', adresse: 'anne@amitel.fr', nom: 'Anne Bernard' }),
      mail({ id: 'b', adresse: 'bruno@amitel.fr', nom: 'Bruno Colin' }),
      mail({
        id: 'c',
        adresse: 'zoe@amitel.fr',
        nom: 'Zoe Martin',
        nonLu: true,
        recuLe: new Date(NOW).toISOString()
      })
    ])
    expect(sortByName(fils).map((f) => f.nom)).toEqual([
      'Zoe Martin',
      'Anne Bernard',
      'Bruno Colin'
    ])
  })

  it('compte les fils qui ont du nouveau', () => {
    const fils = groupByInterlocutor([
      mail({ id: 'a', adresse: 'anne@amitel.fr', nom: 'Anne Bernard' }),
      mail({ id: 'b', adresse: 'zoe@amitel.fr', nom: 'Zoe Martin', nonLu: true })
    ])
    expect(compterFilsNonLus(fils)).toBe(1)
  })
})

describe('cle de fil et nom du contact, tels que la vraie boite les rend', () => {
  it('regroupe sur le sujet de conversation quand l identifiant est vide', () => {
    // Mesure du 2026-09-03 sur la boite reelle : `ConversationID` est vide pour les 40 messages lus,
    // et `ConversationTopic` est renseigne pour les 40. C'est donc lui qui porte le fil ici.
    const [fil] = groupByInterlocutor([
      mail({ id: 'a', conversation: '', sujetConversation: 'test widget', sujet: 'test widget' }),
      mail({ id: 'b', conversation: '', sujetConversation: 'test widget', sujet: 'RE: test widget' })
    ])
    expect(groupThreads(fil)).toHaveLength(1)
  })

  it('garde le nom RECU du contact, pas celui qu Outlook met sur un envoi', () => {
    // Mesure du 2026-09-03 : cote Elements envoyes, le nom du destinataire arrive comme
    // "'raphael.vilain@amitel.fr'" -- entre apostrophes. Le laisser gagner parce qu'il est le plus
    // recent remplacerait "Raphael VILAIN" par cette chaine dans la liste des interlocuteurs.
    const [fil] = groupByInterlocutor([
      mail({
        id: 'recu',
        adresse: 'raphael.vilain@amitel.fr',
        nom: 'Raphael VILAIN',
        recuLe: new Date(NOW - 3600_000).toISOString()
      }),
      mail({
        id: 'envoye',
        adresse: 'raphael.vilain@amitel.fr',
        nom: "'raphael.vilain@amitel.fr'",
        deMoi: true,
        recuLe: new Date(NOW).toISOString()
      })
    ])
    expect(fil.nom).toBe('Raphael VILAIN')
  })

  it('retire les apostrophes d un nom quand c est tout ce qu on a', () => {
    const [fil] = groupByInterlocutor([
      mail({ id: 'a', adresse: 'zoe@amitel.fr', nom: "'zoe@amitel.fr'", deMoi: true })
    ])
    expect(fil.nom).toBe('zoe@amitel.fr')
  })
})

describe('le corps affiché ne contient que le message écrit', () => {
  it("coupe l'en-tête de citation Outlook", () => {
    const corps = [
      'Reponse au test',
      '',
      'De : Arthur LEPLEY <arthur.lepley@amitel.fr>',
      'Envoyé : jeudi 3 septembre 2026 14:50',
      'À : raphael.vilain@amitel.fr',
      'Objet : test widget',
      '',
      '1er message pour le test widget'
    ].join('\n')
    expect(extraireCorpsUtile(corps)).toBe('Reponse au test')
  })

  it('coupe sur « Le … a écrit : » et sur les lignes citées', () => {
    expect(extraireCorpsUtile('ok\nLe 3 septembre, Paul a écrit :\n> salut')).toBe('ok')
    expect(extraireCorpsUtile('ok\n> salut')).toBe('ok')
  })

  it("rend le texte d'origine si la coupe ne laisse rien", () => {
    expect(extraireCorpsUtile('> tout est cité')).toBe('> tout est cité')
  })
})

describe('la date du message', () => {
  it("affiche le jour à côté de l'heure", () => {
    expect(formatMessageDate(new Date(2026, 8, 3, 14, 50).getTime())).toBe('03/09 14:50')
    expect(formatMessageDate(null)).toBe('')
  })
})
