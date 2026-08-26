import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * DEFAUT VECU le 2026-08-26 (conv-1407). L'orchestrateur a recu « remake les pastilles de
 * couleurs » — quatre mots qui referent au tour precedent, dans une AUTRE conversation. Il n'avait
 * aucun moyen de le retrouver : `get_state` ne rend que des titres tronques, `conversation_read`
 * exige un id connu d'avance, et la seule recherche par CONTENU du catalogue, `find_in_files`,
 * fouille les fichiers du depot. Il a donc cherche son propre besoin dans le CODE SOURCE : 20
 * inspections, zero `conversation_read`, un run arrete a 0,96 $.
 *
 * Ce n'est pas un agent distrait, c'est un agent qui se sert du seul instrument qu'on lui laisse.
 * Le corpus est pourtant deja en memoire vive (`list()`, `messagesOf()`) : la matiere etait sous sa
 * main, sans poignee.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA RECHERCHE EST FAUSSE : une conversation qui ne
 * contient PAS le terme doit rester absente du resultat. Une recherche qui rend tout est aussi
 * inutile qu'une recherche qui ne rend rien -- elle rendrait juste l'inutilite plus chere.
 */

const SAUT = String.fromCharCode(10)

function magasinPeuple(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  const a = store.create({ title: 'Pastilles', provider: 'claude' })
  store.append(a.id, { role: 'user', content: 'explique le code couleur de la pastille' })
  store.append(a.id, { role: 'assistant', content: 'ambre = en cours, cyan = a jour' })
  const b = store.create({ title: 'Autre sujet', provider: 'claude' })
  store.append(b.id, { role: 'user', content: 'parle-moi des tickets RIG' })
  return store
}

describe('recherche par contenu dans le corpus des conversations', () => {
  it('retrouve la conversation qui porte le terme', () => {
    const store = magasinPeuple()
    const trouve = store.search('pastille')
    expect(trouve.length).toBe(1)
    expect(trouve[0].title).toBe('Pastilles')
    expect(trouve[0].extraits.length).toBeGreaterThan(0)
    expect(trouve[0].extraits[0].extrait.toLowerCase()).toContain('pastille')
  })

  it('laisse dehors une conversation qui ne porte pas le terme', () => {
    const store = magasinPeuple()
    const trouve = store.search('pastille')
    expect(trouve.map((c) => c.title)).not.toContain('Autre sujet')
  })

  it('ignore la casse et les accents, comme un humain qui tape vite', () => {
    const store = magasinPeuple()
    expect(store.search('PASTILLE').length).toBe(1)
    expect(store.search('a jour').length).toBe(1)
  })

  it('ne confond pas « conversion » avec « conversation », le mot le plus frequent d ici', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const parasite = store.create({ title: 'Parasite', provider: 'claude' })
    store.append(parasite.id, { role: 'user', content: 'range mes conversations par dossier' })
    const vraie = store.create({ title: 'Vraie cible', provider: 'claude' })
    store.append(vraie.id, { role: 'user', content: 'la conversion du fichier a echoue' })

    // Le mecanisme est un CLASSEMENT, pas un filtre : exiger l'ABSENCE du parasite demandait plus
    // que ce qu'il promet, et sur un corpus de deux conversations « conversations » n'est pas
    // omnipresent, donc rien ne doit l'ecarter. Ce qui compte est le RANG. Le cas ou le parasite
    // EST omnipresent -- le vrai defaut -- est tenu par derivation.test.ts.
    const trouve = store.search('conversion').map((c) => c.title)
    expect(trouve[0]).toBe('Vraie cible')
  })

  it('retrouve une REFORMULATION : la demande n est jamais formulee comme la reponse', () => {
    const store = magasinPeuple()
    // Ce que l utilisateur a tape en conv-1407, contre ce qui avait ete dit en conv-1405.
    // Cherchee comme UNE chaine, cette demande ne trouvait rien ; ni au pluriel, ni dans le desordre.
    const trouve = store.search('remake les pastilles de couleurs')
    expect(trouve.map((c) => c.title)).toContain('Pastilles')
  })

  it('rend la REPONSE avec la question : le sens est dans la reponse', () => {
    const store = magasinPeuple()
    const trouve = store.search('code couleur pastille')
    const textes = trouve[0].extraits.map((e) => e.extrait).join(' ')
    expect(textes).toContain('ambre')
  })

  it('classe en tete ce qui porte le PLUS de mots de la demande', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const faible = store.create({ title: 'Un seul mot', provider: 'claude' })
    store.append(faible.id, { role: 'user', content: 'juste une pastille ici' })
    const fort = store.create({ title: 'Trois mots', provider: 'claude' })
    store.append(fort.id, { role: 'user', content: 'le code couleur de la pastille, remake' })
    // « Un seul mot » est PLUS ANCIEN mais porte moins : la pertinence passe avant la recence.
    expect(store.search('remake les pastilles de couleurs')[0].title).toBe('Trois mots')
  })

  it('rend un resultat vide plutot que tout le corpus sur un terme absent', () => {
    const store = magasinPeuple()
    expect(store.search('kubernetes')).toEqual([])
  })

  it('compte les mots ENSEMBLE, pas disperses dans une longue conversation', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    // Une conversation fourre-tout : chaque mot y est, mais dans des messages sans rapport.
    const fourreTout = store.create({ title: 'Fourre-tout', provider: 'claude' })
    store.append(fourreTout.id, { role: 'user', content: 'on parle de couleur ici' })
    store.append(fourreTout.id, { role: 'user', content: 'et de pastille, mais bien plus tard' })
    store.append(fourreTout.id, { role: 'user', content: 'un remake, sans lien avec ce qui precede' })
    // Une phrase qui dit les trois choses A LA FOIS.
    const precise = store.create({ title: 'Precise', provider: 'claude' })
    store.append(precise.id, { role: 'user', content: 'remake de la pastille de couleur' })

    // Cumules sur la conversation, les deux scoreraient 3 et la plus recente gagnerait. C'est la
    // PROXIMITE qui fait le sens : trois mots dans une phrase valent mieux que trois mots eparpilles.
    expect(store.search('remake pastille couleur')[0].title).toBe('Precise')
  })

  it('borne le nombre de conversations rendues', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    for (let i = 0; i < 30; i++) {
      const c = store.create({ title: 'sujet ' + i, provider: 'claude' })
      store.append(c.id, { role: 'user', content: 'terme commun' + SAUT })
    }
    expect(store.search('terme commun', { limite: 5 }).length).toBe(5)
  })
})

/**
 * LA PENALITE DE LONGUEUR EST BORNEE EN HAUT.
 *
 * Mesure du 2026-08-26 sur le corpus reel (1201 conversations), avec un oracle de 10 requetes dont
 * les cibles sont etablies par comptage de tokens et non par intuition : le rappel@8 valait 7/10 sur
 * le mot seul mais 2/10 des que ce mot etait pose dans une phrase -- et la phrase ramenait les MEMES
 * quatre conversations quel que soit le terme distinctif, preuve que ce terme ne pesait rien. Les
 * messages qui portaient le terme rare faisaient 1677 a 7886 caracteres (diviseur 41 a 89) ; les
 * gagnantes constantes avaient une mediane de 93 a 609 (diviseur 8 a 25) : un facteur onze offert a
 * la brievete, quel que soit le contenu. Diviseur borne au 3e quartile -> 8/10 et 4/10.
 *
 * COMMENT CE TEST DISCRIMINE, car ce n'est pas evident et une premiere version ne discriminait RIEN.
 * Au-dela du plafond, deux messages qui portent le meme terme obtiennent le MEME score : l'ordre est
 * alors decide par la recence. Le montage exploite exactement cela -- la plus longue est creee EN
 * DERNIER, donc la plus recente. Avec le plafond elle passe devant (scores egaux, recence tranche) ;
 * sans lui, sa longueur la fait reculer derriere la courte malgre sa recence. L'ordre S'INVERSE :
 * mesure dans les deux etats avant d'ecrire l'assertion, et le sabotage du plafond fait bien rougir.
 */
describe('penalite de longueur, bornee au 3e quartile', () => {
  const PLAFOND = 564
  const bourre = (n: number): string => 'contexte neutre sans rapport. '.repeat(Math.ceil(n / 30))

  /** La COURTE est creee d'abord : la longue est donc la plus recente des deux. */
  function magasin(courte: number, longue: number): ConversationStore {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const c = store.create({ title: 'Courte', provider: 'claude' })
    store.append(c.id, { role: 'assistant', content: `zarbitrophage ${bourre(courte)}` })
    const l = store.create({ title: 'Longue', provider: 'claude' })
    store.append(l.id, { role: 'assistant', content: `zarbitrophage ${bourre(longue)}` })
    return store
  }

  it('au-dela du plafond, la longueur ne decide plus : la plus recente passe devant', () => {
    const titres = magasin(PLAFOND * 2, PLAFOND * 12).search('zarbitrophage').map((r) => r.title)
    expect(titres).toEqual(['Longue', 'Courte'])
  })

  it('et l’ecart de longueur, meme multiplie par vingt, n’y change rien', () => {
    const titres = magasin(PLAFOND * 2, PLAFOND * 40).search('zarbitrophage').map((r) => r.title)
    expect(titres).toEqual(['Longue', 'Courte'])
  })

  it('en DESSOUS du plafond, la longueur discrimine encore -- l’original est preserve', () => {
    // Contre-epreuve : le plafond ne doit pas avoir aplani la normalisation la ou elle sert
    // vraiment. Ici la courte doit devancer la longue MALGRE sa moindre recence.
    const titres = magasin(60, PLAFOND - 120).search('zarbitrophage').map((r) => r.title)
    expect(titres).toEqual(['Courte', 'Longue'])
  })
})

/**
 * LE MOT PORTEUR DECIDE, MEME QUAND LE SCORE NE LE VOIT PAS.
 *
 * Defaut mesure le 2026-08-26 sur le corpus reel (1201 conversations, oracle de 40 cas aux cibles
 * etablies par comptage de tokens). Le rappel injecte a chaque tour demande TROIS conversations, et
 * sur une demande en langage naturel la bonne a un rang MEDIAN de 12 : il ratait 38 fois sur 40.
 * La cible n'etait pourtant jamais exclue -- a profondeur 50, la phrase retrouvait presque aussi bien
 * que le mot-cle seul. C'etait le CLASSEMENT qui echouait, pas la recherche. Le re-classement par
 * presence du mot porteur a porte ce top-3 de 2/40 a 21/40, et le mot-cle seul de 31/40 a 36/40,
 * pour un surcout nul (61 ms contre 60).
 */
describe('re-classement par le mot porteur', () => {
  function magasin(): ConversationStore {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    // Le bruit : des messages COURTS qui portent les mots d'adresse, donc un score de densite eleve.
    for (let i = 0; i < 12; i++) {
      const b = store.create({ title: `Adresse ${i}`, provider: 'claude' })
      store.append(b.id, { role: 'user', content: 'rappelle moi ce qu on a dit dans le projet' })
    }
    // La cible : le terme porteur, noye dans un message long -- la forme normale d'une explication.
    const cible = store.create({ title: 'Cible', provider: 'claude' })
    const long = 'contexte technique sans rapport particulier avec la demande. '.repeat(80)
    store.append(cible.id, {
      role: 'assistant',
      content: `${long}${SAUT}le detail decisif porte sur zarbitrophage${SAUT}${long}`
    })
    return store
  }

  it('remonte dans les trois premiers la conversation qui porte vraiment le terme', () => {
    const res = magasin().search(
      'rappelle moi ce qu on a dit a propos de zarbitrophage dans le projet',
      { limite: 3 }
    )
    expect(res.map((r) => r.title)).toContain('Cible')
  })

  it('sans terme distinctif, le classement par score est preserve', () => {
    // Contre-epreuve : quand aucun mot ne se distingue, le re-classement ne doit rien bouleverser.
    const res = magasin().search('rappelle moi ce qu on a dit dans le projet', { limite: 3 })
    expect(res.length).toBe(3)
    expect(res.every((r) => r.title.startsWith('Adresse'))).toBe(true)
  })
})

/**
 * LE PORTEUR EST LE MOT LE PLUS LONG, PAS LE PLUS RARE.
 *
 * Mesure du 2026-08-26 sur le corpus reel : la rarete ne SEPARE pas. « rappelle » vit dans 4 messages,
 * « mutantes » et « habillage » dans 3, « updatebanner » dans 1 -- un mot d'adresse y est aussi rare
 * qu'un terme technique. Le critere par rarete donnait 21/40 contre 25/40 pour la longueur, et il ne
 * fonctionnait que parce que les termes rares sont ABSENTS de l'index (LONGUEUR_UTILE, voisinage.ts)
 * et recevaient la valeur « inconnu ». Une propriete accidentelle, pas un critere.
 *
 * Ce test SEPARE les deux : le mot le plus rare de la demande est ici un mot COURT, present dans une
 * seule conversation ; le mot long, lui, est present dans deux. Un porteur choisi par la rarete
 * designerait le court et remonterait la mauvaise conversation.
 */
describe('choix du mot porteur', () => {
  it('designe le mot long, meme quand un mot court est plus rare', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    for (let i = 0; i < 12; i++) {
      const b = store.create({ title: `Adresse ${i}`, provider: 'claude' })
      store.append(b.id, { role: 'user', content: 'rappelle moi ce qu on a dit dans le projet' })
    }
    const long = 'contexte technique sans rapport particulier avec la demande. '.repeat(80)
    // La CIBLE porte le mot long. Deux conversations le portent : il n'est donc pas le plus rare.
    for (const nom of ['Cible', 'Cible bis']) {
      const c = store.create({ title: nom, provider: 'claude' })
      store.append(c.id, {
        role: 'assistant',
        content: `${long}${SAUT}le detail porte sur zarbitrophage${SAUT}${long}`
      })
    }
    // Le LEURRE porte un mot court present nulle part ailleurs : le plus rare de la demande.
    const leurre = store.create({ title: 'Leurre', provider: 'claude' })
    store.append(leurre.id, { role: 'assistant', content: `${long}${SAUT}mention de wug${SAUT}${long}` })

    const res = store.search('rappelle moi wug et zarbitrophage dans le projet', { limite: 3 })
    const titres = res.map((r) => r.title)
    expect(titres.some((t) => t.startsWith('Cible'))).toBe(true)
  })
})

/**
 * A LONGUEUR ET RARETE EGALES, LA POSITION DANS LA PHRASE DEPARTAGE.
 *
 * Anatomie mesuree des echecs restants, le 2026-08-26 : sur quinze cas rates, DIX avaient pour porteur
 * « rappelle » et non le terme cherche -- et tous ces termes faisaient EXACTEMENT huit caracteres,
 * soit la longueur de « rappelle ». A longueur egale la rarete devait departager, mais les deux mots
 * sont absents de l'index (LONGUEUR_UTILE, voisinage.ts) donc tous deux a 1, et le premier gagnait :
 * le mot d'adresse, qui OUVRE la phrase. Verifie directement : `search('mutantes')` rend les bonnes
 * conversations, `search('rappelle mutantes')` rend les memes trois quel que soit le second mot.
 *
 * Le depart retenu est un fait de STRUCTURE de phrase, pas une liste de mots a entretenir : la formule
 * d'adresse ouvre, le sujet suit la preposition. A egalite parfaite, le plus TARDIF gagne. Mesure :
 * 25/40 -> 28/40, sans rien perdre sur le mot-cle seul (36/40) ni sur rarete-isole.
 */
describe('departage par la position quand tout le reste est egal', () => {
  it('retient le mot de fin de phrase, pas celui qui l’ouvre', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const long = 'contexte technique sans rapport particulier avec la demande. '.repeat(80)

    // Les deux mots font HUIT lettres et vivent dans des messages longs : absents de l'index, donc
    // de rarete egale. Seule la position peut les departager.
    for (let i = 0; i < 12; i++) {
      const b = store.create({ title: `Ouverture ${i}`, provider: 'claude' })
      store.append(b.id, { role: 'assistant', content: `${long}${SAUT}il est question de zephyrus${SAUT}${long}` })
    }
    const cible = store.create({ title: 'Sujet', provider: 'claude' })
    store.append(cible.id, {
      role: 'assistant',
      content: `${long}${SAUT}il est question de zarbitro${SAUT}${long}`
    })

    const titres = store.search('zephyrus et zarbitro', { limite: 3 }).map((r) => r.title)
    expect(titres).toContain('Sujet')
  })
})

/**
 * COMBIEN DE FOIS, ET NON PLUS SEULEMENT SI.
 *
 * Anatomie mesuree des cinq derniers echecs, le 2026-08-26 : dans QUATRE, les trois premieres
 * conversations portaient AUSSI le mot porteur. Le signal binaire ne discriminait donc plus -- ces
 * termes sont portes par 14 a 94 conversations du corpus, tout le monde etait dans le groupe
 * « porte », et a l'interieur seul le score decidait. Compter redonne du relief la ou la presence est
 * saturee : 38/40 -> 39/40 sur le mot-cle, 35/40 -> 36/40 sur la phrase.
 */
describe('le re-classement compte les occurrences', () => {
  it('prefere la conversation qui TRAITE le sujet a celle qui l’effleure', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const long = 'contexte technique sans rapport particulier avec la demande. '.repeat(30)

    // Douze conversations effleurent le terme : une seule mention chacune. Elles sont plus RECENTES
    // que la cible, donc a egalite de compte elles passeraient devant.
    const effleure = store.create({ title: 'Effleure', provider: 'claude' })
    store.append(effleure.id, { role: 'assistant', content: `${long}${SAUT}une mention de zarbitrophage${SAUT}${long}` })

    // La cible en parle vraiment : trois mentions, le seuil utile.
    const traite = store.create({ title: 'Traite', provider: 'claude' })
    store.append(traite.id, {
      role: 'assistant',
      content: `${long}${SAUT}zarbitrophage ici, zarbitrophage la, et encore zarbitrophage${SAUT}${long}`
    })
    // Une troisieme, plus recente que les deux, qui ne fait qu'effleurer : sans le comptage elle
    // passerait devant « Traite » a egalite de presence.
    const tardive = store.create({ title: 'Tardive', provider: 'claude' })
    store.append(tardive.id, { role: 'assistant', content: `${long}${SAUT}zarbitrophage cite une fois${SAUT}${long}` })

    const titres = store.search('rappelle moi zarbitrophage', { limite: 3 }).map((r) => r.title)
    expect(titres[0]).toBe('Traite')
  })
})

/**
 * UN TERME PLUS COURT QUE LE MOT D'ADRESSE DOIT QUAND MEME GAGNER.
 *
 * Mesure du 2026-08-26 sur un oracle de 120 cas tokenise comme la recherche, en conditions de
 * production : le critere « le plus long, puis le plus tardif » ratait 29 cas, et ces 29 termes
 * faisaient presque tous SEPT lettres -- contre huit a « rappelle ». Tout terme plus court que le mot
 * d'adresse perdait, systematiquement. La formule retenue, `rarete x (longueur + position)`, porte le
 * resultat a 115/120 : un mot d'adresse est court, tot dans la phrase, et pas rare -- il perd sur les
 * trois signaux a la fois, la ou chacun pris seul le laissait passer.
 */
describe('choix du porteur : un terme court bat le mot d’adresse', () => {
  it('« buttons » (7 lettres) l’emporte sur « rappelle » (8 lettres)', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const long = 'contexte technique sans rapport particulier avec la demande. '.repeat(30)

    // « rappelle » est present dans beaucoup de conversations : c'est un mot d'adresse, pas un sujet.
    for (let i = 0; i < 12; i++) {
      const b = store.create({ title: `Adresse ${i}`, provider: 'claude' })
      store.append(b.id, { role: 'user', content: 'rappelle moi ce qu on a dit dans le projet' })
    }
    // La cible porte un terme de SEPT lettres, plus court que « rappelle ».
    const cible = store.create({ title: 'Cible', provider: 'claude' })
    store.append(cible.id, {
      role: 'assistant',
      content: `${long}${SAUT}le detail porte sur buttons, buttons et encore buttons${SAUT}${long}`
    })

    const titres = store
      .search('rappelle moi ce qu on a dit a propos de buttons dans le projet', { limite: 3 })
      .map((r) => r.title)
    expect(titres).toContain('Cible')
  })
})
