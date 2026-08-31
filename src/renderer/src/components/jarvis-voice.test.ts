import { describe, expect, it } from 'vitest'
import {
  appliquerParole,
  basculerEcoute,
  conversationsEnDirect,
  ecouteInitiale,
  evenementsDirects,
  contientEveil,
  extraireCommandeEveil,
  reagirAParole,
  type SommaireDirect
} from './jarvis-voice'

const sommaire = (p: Partial<SommaireDirect> & { id: string }): SommaireDirect => ({
  title: p.id,
  updatedAt: 0,
  messageCount: 0,
  ...p
})

describe('écoute continue de Jarvis', () => {
  it('ignore une parole finale tant que le widget n’est pas activé', () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : si `appliquerParole` n'interrogeait pas `active`,
    // le micro du navigateur (qui peut rendre un dernier résultat après l'arrêt) créerait
    // une commande alors que l'utilisateur a coupé l'écoute.
    const apres = appliquerParole(ecouteInitiale, {
      texte: 'ouvre le task manager',
      final: true,
      le: 5
    })
    expect(apres.commandes).toEqual([])
    expect(apres.partiel).toBe('')
  })

  it('retient une parole finale quand l’écoute est active', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const apres = appliquerParole(on, { texte: 'ouvre le task manager', final: true, le: 5 })
    expect(apres.commandes.map((c) => c.texte)).toEqual(['ouvre le task manager'])
    expect(apres.partiel).toBe('')
  })

  it('affiche le partiel sans en faire une commande', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const apres = appliquerParole(on, { texte: 'ouvre le', final: false, le: 4 })
    expect(apres.partiel).toBe('ouvre le')
    expect(apres.commandes).toEqual([])
  })

  it('ne crée aucune commande pour une parole vide', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const apres = appliquerParole(on, { texte: '   ', final: true, le: 4 })
    expect(apres.commandes).toEqual([])
  })

  it('couper l’écoute vide le partiel mais garde l’historique', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const avec = appliquerParole(appliquerParole(on, { texte: 'salut', final: true, le: 2 }), {
      texte: 'et pu',
      final: false,
      le: 3
    })
    const off = basculerEcoute(avec, 4)
    expect(off.active).toBe(false)
    expect(off.partiel).toBe('')
    expect(off.commandes.map((c) => c.texte)).toEqual(['salut'])
    expect(basculerEcoute(off, 5).active).toBe(true)
  })
})

describe('monitoring des conversations en direct', () => {
  it('garde une conversation qui streame même si elle est ancienne', () => {
    const direct = conversationsEnDirect(
      [
        sommaire({ id: 'a', updatedAt: 0, lastAssistantStatus: 'streaming' }),
        sommaire({ id: 'b', updatedAt: 0, lastAssistantStatus: 'completed' })
      ],
      10_000_000
    )
    expect(direct.map((c) => c.id)).toEqual(['a'])
    expect(direct[0].enCours).toBe(true)
  })

  it('garde une conversation terminée récemment, la plus fraîche d’abord', () => {
    const now = 1_000_000
    const direct = conversationsEnDirect(
      [
        sommaire({ id: 'vieux', updatedAt: now - 60 * 60_000, lastAssistantStatus: 'completed' }),
        sommaire({ id: 'frais', updatedAt: now - 1_000, lastAssistantStatus: 'completed' }),
        sommaire({ id: 'moyen', updatedAt: now - 60_000, lastAssistantStatus: 'completed' })
      ],
      now
    )
    expect(direct.map((c) => c.id)).toEqual(['frais', 'moyen'])
    expect(direct[0].enCours).toBe(false)
  })

  it('signale un nouveau message et la fin d’un tour', () => {
    const avant = [
      sommaire({ id: 'a', messageCount: 2, lastAssistantStatus: 'streaming' }),
      sommaire({ id: 'b', messageCount: 1, lastAssistantStatus: 'streaming' })
    ]
    const apres = [
      sommaire({ id: 'a', messageCount: 3, lastAssistantStatus: 'streaming' }),
      sommaire({ id: 'b', messageCount: 1, lastAssistantStatus: 'completed' })
    ]
    const evenements = evenementsDirects(avant, apres, 42)
    expect(evenements.map((e) => [e.conversationId, e.genre])).toEqual([
      ['a', 'message'],
      ['b', 'fin']
    ])
    expect(evenements[0].le).toBe(42)
    expect(evenementsDirects(apres, apres, 43)).toEqual([])
  })
})

describe('mot d’éveil', () => {
  it('n’extrait rien d’une phrase qui ne nomme pas Jarvis', () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : sans exigence du mot d'éveil, une conversation de bureau
    // captée par un micro toujours ouvert partirait en run réel.
    expect(extraireCommandeEveil('ouvre le task manager')).toBeNull()
  })

  it('extrait ce qui suit le mot d’éveil, casse et ponctuation comprises', () => {
    expect(extraireCommandeEveil('Jarvis, ouvre le task manager')).toBe('ouvre le task manager')
    expect(extraireCommandeEveil('jarvis ouvre le task manager')).toBe('ouvre le task manager')
    expect(extraireCommandeEveil('Dis Jarvis : lance la routine')).toBe('lance la routine')
  })

  it('reconnaît son nom TEL QUE LES MOTEURS LE TRANSCRIVENT, pas seulement bien orthographié', () => {
    // MESURE RÉELLE (2026-08-31) : whisper.cpp small-q5_1, phrase prononcée « Jarvis, ouvre le task
    // manager », transcription rendue « jarvie, ouvre le task manager. ». Un mot d'éveil exigé au
    // caractère près laisse donc Jarvis MUET alors qu'il a parfaitement entendu — c'est le défaut
    // signalé (« il n'entend pas quand je dis son nom »), une couche plus loin.
    expect(extraireCommandeEveil('jarvie, ouvre le task manager.')).toBe('ouvre le task manager.')
    expect(contientEveil('jarvie, ouvre le task manager.')).toBe(true)
    for (const variante of ['jarvis', 'jarvie', 'jarvi', 'jarviss', 'jarvice', 'Jarvys']) {
      expect(contientEveil(`${variante} ouvre le chat`)).toBe(true)
    }
  })

  it('ne prend PAS n’importe quel mot pour son nom', () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : élargir le mot d'éveil jusqu'à l'absurde ferait partir un run
    // sur une conversation ordinaire. Ces mots-là ne réveillent rien.
    for (const mot of ['java', 'jardin', 'service', 'j’arrive', 'harvest', 'jars']) {
      expect(contientEveil(`${mot} ouvre le chat`)).toBe(false)
    }
  })

  it('ne retient pas un éveil sans ordre', () => {
    expect(extraireCommandeEveil('jarvis')).toBeNull()
    expect(extraireCommandeEveil('jarvis  ,  ')).toBeNull()
  })
})

describe('accusé sonore d’éveil', () => {
  it('bipe dès que « Jarvis » est entendu, avant même que la phrase soit figée', () => {
    // L'ENTRÉE QUI CASSERAIT UN FAUX FIX : {texte:'jarvis', final:false}. Un fix qui n'écoute
    // que les résultats FINAUX ne biperait pas ici — et l'utilisateur, sans signal, croirait
    // encore que Jarvis ne l'entend pas.
    const on = basculerEcoute(ecouteInitiale, 1)
    const r = reagirAParole(on, { texte: 'jarvis', final: false, le: 2 })
    expect(r.bip).toBe(true)
    expect(r.etat.eveille).toBe(true)
    expect(r.ordre).toBeNull()
  })

  it('ne bipe qu’une fois par phrase, malgré les partiels répétés', () => {
    // L'ENTRÉE QUI CASSERAIT UN FAUX FIX : deux partiels de suite contenant « jarvis ».
    // Sans verrou par phrase, le moteur (qui republie le partiel à chaque mot) mitraillerait.
    const on = basculerEcoute(ecouteInitiale, 1)
    const a = reagirAParole(on, { texte: 'jarvis', final: false, le: 2 })
    const b = reagirAParole(a.etat, { texte: 'jarvis ouvre', final: false, le: 3 })
    expect(b.bip).toBe(false)
  })

  it('ne bipe pas quand l’écoute est coupée', () => {
    const r = reagirAParole(ecouteInitiale, { texte: 'jarvis', final: false, le: 2 })
    expect(r.bip).toBe(false)
    expect(r.ordre).toBeNull()
  })

  it('prend la phrase SUIVANTE comme ordre quand l’éveil était seul', () => {
    // LE DÉFAUT SIGNALÉ : « Jarvis » puis une pause, puis l'ordre. L'ancien code exigeait
    // l'ordre dans la MÊME phrase et ne faisait rien — d'où « il ne m'entend pas ».
    const on = basculerEcoute(ecouteInitiale, 1)
    const eveil = reagirAParole(on, { texte: 'Jarvis', final: true, le: 2 })
    expect(eveil.ordre).toBeNull()
    expect(eveil.etat.eveille).toBe(true)
    const suite = reagirAParole(eveil.etat, { texte: 'ouvre le task manager', final: true, le: 9 })
    expect(suite.ordre).toBe('ouvre le task manager')
    expect(suite.etat.eveille).toBe(false)
  })

  it('garde l’ordre de la même phrase et retombe endormi ensuite', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const un = reagirAParole(on, { texte: 'Jarvis, ouvre le chat', final: true, le: 2 })
    expect(un.ordre).toBe('ouvre le chat')
    expect(un.etat.eveille).toBe(false)
    // L'ENTRÉE QUI CASSERAIT UN FAUX FIX : une phrase sans éveil après un ordre servi.
    // Si l'état restait éveillé, une conversation de bureau partirait en run.
    const deux = reagirAParole(un.etat, { texte: 'passe moi le sel', final: true, le: 3 })
    expect(deux.ordre).toBeNull()
  })

  it('couper l’écoute rendort Jarvis', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const eveil = reagirAParole(on, { texte: 'jarvis', final: true, le: 2 })
    const off = basculerEcoute(eveil.etat, 3)
    expect(off.eveille).toBe(false)
    const rallume = basculerEcoute(off, 4)
    expect(rallume.eveille).toBe(false)
  })
})
