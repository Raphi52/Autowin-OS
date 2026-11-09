import { describe, expect, it } from 'vitest'
import type { CarteDesBesoins, NatureDuProjet, ProjetDeLaCarte } from './carte-des-besoins'
import {
  carteDesDossiersDuChat,
  cleDeDossier,
  DOSSIERS_DU_CHAT_MAX,
  dossiersDuBoard,
  dossiersDuChatLisibles,
  estDossierDuChat
} from './board-dossiers-du-chat'

/**
 * Le Board réduit aux dossiers du Chat. Entrée qui doit faire échouer ce fichier :
 * « Divers » ou un dossier absent de la liste du Chat qui resterait sur le Board, ou un dossier
 * écrit avec d'autres séparateurs ou une autre casse qui en sortirait.
 */
function projet(cle: string, nature: NatureDuProjet, n: number, bloques = 0): ProjetDeLaCarte {
  return {
    cle,
    libelle: cle,
    nature,
    conversations: 1,
    demandes: Array.from({ length: n }, (_, rang) => ({
      conversationId: `conv-${cle}`,
      conversationTitre: cle,
      rang,
      titre: `d${rang}`,
      statut: 'prouve' as const,
      constat: ''
    })),
    runsBloques: Array.from({ length: bloques }, () => ({
      sujet: 's',
      statut: 'red',
      chemin: 'c',
      mtime: 1
    })),
    comptes: { prouve: n, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 }
  }
}

const CARTE: CarteDesBesoins = {
  projets: [
    projet('D:\\AutoWinOS', 'dossier', 4, 1),
    projet('D:\\mesure-skills\\depot', 'dossier', 1),
    projet('divers', 'divers', 0, 3),
    projet('Perso', 'categorie', 2),
    projet('auto-kaizen', 'kaizen', 1)
  ],
  comptes: { prouve: 8, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 },
  demandes: 8,
  runsBloques: 4,
  conversationsLues: 5,
  demandeurs: [],
  demandesJournalisees: 0,
  calculeeA: 1,
  dureeMs: 1
}

describe('dossiersDuChatLisibles — la liste reçue de la vue ou relue du poste', () => {
  it('chemins canoniques, sans doublon ; libellés écartés ; forme inattendue refusée', () => {
    expect(
      dossiersDuChatLisibles(['d:/AutoWinOS/', 'D:\\AutoWinOS', 'Perso', 'D:\\Factures'])
    ).toEqual(['D:\\AutoWinOS', 'D:\\Factures'])
    expect(dossiersDuChatLisibles([])).toEqual([])
    expect(dossiersDuChatLisibles(null)).toBeUndefined()
    expect(dossiersDuChatLisibles('D:\\A')).toBeUndefined()
    expect(dossiersDuChatLisibles([1])).toBeUndefined()
    expect(dossiersDuChatLisibles(Array(DOSSIERS_DU_CHAT_MAX + 1).fill('D:\\x'))).toBeUndefined()
  })

  it('cleDeDossier ignore séparateurs, barre finale et casse', () => {
    expect(cleDeDossier('d:/autowinos/')).toBe(cleDeDossier('D:\\AutoWinOS'))
  })
})

describe('carteDesDossiersDuChat — le Board ne montre que les dossiers du Chat', () => {
  it('liste jamais reçue = la carte telle quelle', () => {
    expect(carteDesDossiersDuChat(CARTE, null)).toBe(CARTE)
  })

  it('garde les dossiers de la liste, sort Divers, catégories, Auto-kaizen et les dossiers retirés', () => {
    const reduite = carteDesDossiersDuChat(CARTE, ['d:/autowinos'])
    expect(reduite.projets.map((p) => p.cle)).toEqual(['D:\\AutoWinOS'])
    // Comptes refaits : les 3 runs bloqués de Divers et les demandes des autres ne s'annoncent plus.
    expect(reduite.demandes).toBe(4)
    expect(reduite.runsBloques).toBe(1)
    expect(reduite.comptes.prouve).toBe(4)
  })

  it('liste vide = Board vide, jamais retour à « tout »', () => {
    expect(carteDesDossiersDuChat(CARTE, []).projets).toEqual([])
  })
})

describe('dossiersDuBoard — même les dossiers que le Chat propose toujours se retirent', () => {
  const toujours = ['D:\\AutoWinOS', 'C:\\Users\\moi', undefined, null, '']

  it('dossiers du Chat + dépôt par défaut + « This computer », sans doublon', () => {
    expect(dossiersDuBoard(['d:/AutoWinOS/', 'D:\\Factures'], toujours, [])).toEqual([
      'D:\\AutoWinOS',
      'D:\\Factures',
      'C:\\Users\\moi'
    ])
  })

  it('un dossier toujours proposé que la croix a retiré sort du Board', () => {
    expect(
      dossiersDuBoard(['D:\\Factures'], toujours, ['d:/autowinos', 'c:\\users\\MOI\\'])
    ).toEqual(['D:\\Factures'])
  })

  it('un retrait ne cache pas un dossier que le Chat affiche (le Board suit le Chat)', () => {
    expect(dossiersDuBoard(['D:\\Factures'], [], ['D:\\Factures'])).toEqual(['D:\\Factures'])
  })

  /** « j'ai perdu le this computer, il doit être impossible à supprimer ». */
  it('« This computer » reste au Board même si une ancienne croix l’a mémorisé comme retiré', () => {
    expect(
      dossiersDuBoard(
        ['D:\\Factures'],
        toujours,
        ['d:/autowinos', 'c:\\users\\MOI\\'],
        ['C:\\Users\\moi']
      )
    ).toEqual(['D:\\Factures', 'C:\\Users\\moi'])
  })
})

/**
 * La copie de travail qu'un fil reçoit tout seul (`essai__<fil>-<instant>-<rang>`) n'est pas un
 * dossier de l'utilisateur : elle sortait dans « Ranger dans… » et sur le Board, une ligne par fil.
 * Entrée qui doit faire échouer : une copie gardée dans la liste lue ou dans les dossiers du Board.
 */
describe('copies de travail des fils', () => {
  const COPIE =
    'D:\\AutoWinOS\\.autowin-data\\autowin-os\\retours-de-tour\\essai__conv-1700-1794038023563-1'

  it('sont des chemins, mais pas des dossiers du Chat', () => {
    expect(estDossierDuChat(COPIE)).toBe(false)
    expect(
      estDossierDuChat('D:\\AutoWinOS\\.autowin-data\\autowin-os\\copies-de-fil\\conv-1710')
    ).toBe(false)
    expect(estDossierDuChat('D:\\AutoWinOS')).toBe(true)
    expect(estDossierDuChat('Perso')).toBe(false)
    // Un nom qui contient « essai__ » sans être une copie reste un dossier.
    expect(estDossierDuChat('D:\\projets\\mon-essai__depot')).toBe(true)
  })

  it('sortent de la liste relue et des dossiers du Board', () => {
    expect(dossiersDuChatLisibles(['D:\\AutoWinOS', COPIE])).toEqual(['D:\\AutoWinOS'])
    expect(dossiersDuBoard(['D:\\AutoWinOS'], [COPIE], [])).toEqual(['D:\\AutoWinOS'])
  })
})

/**
 * Tout dossier rangé dans les données de l'app est une copie qu'elle a ouverte pour un agent : un
 * fil qui y travaille (un lot de plan repris dans la copie d'un run) l'ajoutait à la liste au
 * lancement suivant, comme un nouveau dossier de travail. Entrée qui doit faire échouer : une copie
 * d'agent `worktrees/<h>/agent__run-…` ou `copies-de-taches/<fil>` acceptée, ou un vrai projet refusé.
 */
describe('copies ouvertes par l’app pour ses agents', () => {
  const COPIE_D_AGENT =
    'D:\\AutoWinOS\\.autowin-data\\autowin-os\\worktrees\\5a94588848d48682\\agent__run-12795ca2f627-1'

  it('ne sont jamais des dossiers du Chat, quel que soit leur rangement', () => {
    expect(estDossierDuChat(COPIE_D_AGENT)).toBe(false)
    expect(estDossierDuChat('d:/AutoWinOS/.Autowin-Data/autowin-os/copies-de-taches/conv-1')).toBe(
      false
    )
    expect(estDossierDuChat('D:\\AutoWinOS\\.autowin-data')).toBe(false)
    // Un vrai projet dont le nom ressemble ne sort pas.
    expect(estDossierDuChat('D:\\projets\\autowin-data')).toBe(true)
    expect(estDossierDuChat('D:\\BrainRotRoyale')).toBe(true)
  })

  it('sortent de la liste relue, donc aussi celles déjà mémorisées', () => {
    expect(dossiersDuChatLisibles(['D:\\AutoWinOS', COPIE_D_AGENT])).toEqual(['D:\\AutoWinOS'])
  })
})
