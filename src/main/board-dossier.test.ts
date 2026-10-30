import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CarteDesBesoins, DemandeDeLaCarte, StatutDemande } from '../shared/carte-des-besoins'
import {
  boardEnMarkdown,
  creerDossierDuBoard,
  FICHIER_DU_REGLAGE,
  lireDossierDuBoard,
  lireReglageDuBoard,
  postItsDuBoard,
  sousDossierDuPoste
} from './board-dossier'

const comptes = (): Record<StatutDemande, number> => ({
  prouve: 0,
  refuse: 0,
  'en-cours': 0,
  'sans-preuve': 0
})

function demande(
  partiel: Partial<DemandeDeLaCarte> & { conversationId: string; rang: number }
): DemandeDeLaCarte {
  return {
    conversationTitre: `Fil ${partiel.conversationId}`,
    titre: `demande ${partiel.rang}`,
    statut: 'sans-preuve',
    constat: 'aucune vérification',
    ...partiel
  }
}

function carte(demandes: DemandeDeLaCarte[]): CarteDesBesoins {
  return {
    projets: [
      {
        cle: 'D:\\Projet',
        libelle: 'Projet',
        nature: 'dossier',
        conversations: 2,
        demandes,
        runsBloques: [],
        comptes: comptes()
      }
    ],
    comptes: { ...comptes(), prouve: 1 },
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: 2,
    demandeurs: [],
    demandesJournalisees: 0,
    calculeeA: 1,
    dureeMs: 1
  }
}

const H = 3_600_000
const CARTE = carte([
  demande({ conversationId: 'conv-1', rang: 0, debut: 10 * H, statut: 'prouve' }),
  demande({
    conversationId: 'conv-1',
    rang: 2,
    debut: 12 * H,
    statut: 'en-cours',
    demandeur: { cle: 'a@b', nom: 'Alice', email: 'a@b', origine: 'journal' }
  }),
  demande({ conversationId: 'conv-2', rang: 0, debut: 11 * H, statut: 'prouve' }),
  demande({ conversationId: 'conv-3', rang: 0, statut: 'refuse' })
])

describe('postItsDuBoard — ce que le Board affiche', () => {
  it('un post-it par fil, à l’état de sa DERNIÈRE demande, le plus récent d’abord', () => {
    const { postIts, filsSansDate } = postItsDuBoard(CARTE)
    expect(postIts.map((p) => [p.conversationId, p.etage])).toEqual([
      ['conv-1', 'en-cours'],
      ['conv-2', 'prouve']
    ])
    expect(postIts[0].demandes.map((d) => d.rang)).toEqual([0, 2])
    expect(postIts[0].demandeur).toEqual({ nom: 'Alice', email: 'a@b' })
    // Un fil sans aucune date n'est pas posé sur le Board : seulement compté.
    expect(filsSansDate).toBe(1)
  })

  it('l’état posé à la main passe devant tant qu’il est plus récent que la dernière demande', () => {
    const tenu = postItsDuBoard(CARTE, { 'conv-1': { etage: 'a-faire', a: 13 * H } }).postIts[0]
    expect(tenu.etage).toBe('a-faire')
    expect(tenu.etatPreuve).toBe('en-cours')
    expect(tenu.manuel?.etage).toBe('a-faire')
    // Posé AVANT la dernière demande : caduc, comme sur l'écran.
    const caduc = postItsDuBoard(CARTE, { 'conv-1': { etage: 'a-faire', a: 11 * H } }).postIts[0]
    expect(caduc.etage).toBe('en-cours')
    expect(caduc.manuel).toBeUndefined()
  })

  // conv-1278 : les collègues lisent le message ENTIER dans la fiche, pas la première ligne coupée.
  it('écrit le message entier d’une demande quand il en dit plus que son titre', () => {
    const { postIts } = postItsDuBoard(
      carte([
        demande({ conversationId: 'conv-1', rang: 0, debut: H, texte: 'ligne une\nligne deux' }),
        demande({ conversationId: 'conv-1', rang: 2, debut: 2 * H })
      ])
    )
    expect(postIts[0].demandes[0].texte).toBe('ligne une\nligne deux')
    expect(postIts[0].demandes[1]).not.toHaveProperty('texte')
  })
})

describe('sousDossierDuPoste', () => {
  it('garde le compte Windows, sans caractère interdit dans un nom de dossier', () => {
    expect(sousDossierDuPoste('prenom.nom')).toBe('prenom.nom')
    expect(sousDossierDuPoste('DOMAINE\\moi')).toBe('DOMAINE_moi')
    expect(sousDossierDuPoste('  ')).toBe('poste')
  })
})

describe('creerDossierDuBoard — réglage et écriture', () => {
  const temporaires: string[] = []
  const temp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'autowin-board-'))
    temporaires.push(d)
    return d
  }
  afterEach(() => {
    for (const d of temporaires.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('sans dossier choisi, rien n’est écrit', async () => {
    const racine = temp()
    const board = creerDossierDuBoard({ racine, utilisateur: 'moi', delaiMs: 0 })
    board.enregistrer(CARTE, {})
    await board.attendre()
    expect(board.etat()).toEqual({
      dossier: null,
      cible: null,
      enCours: false,
      nom: 'moi',
      compte: 'moi'
    })
  })

  it('refuse un chemin incomplet ou un dossier introuvable, sans rien enregistrer', async () => {
    const racine = temp()
    const board = creerDossierDuBoard({ racine, utilisateur: 'moi', delaiMs: 0 })
    expect((await board.choisir('Board')).erreur).toMatch(/Chemin incomplet/)
    expect((await board.choisir(join(racine, 'absent'))).erreur).toMatch(/introuvable/)
    expect(board.etat().dossier).toBeNull()
    expect(existsSync(join(racine, FICHIER_DU_REGLAGE))).toBe(false)
  })

  it('écrit board.json et board.md dans le sous-dossier du poste, avec le pont vers chaque fil', async () => {
    const racine = temp()
    const partage = temp()
    const board = creerDossierDuBoard({ racine, utilisateur: 'moi', delaiMs: 0 })
    const etat = await board.choisir(partage)
    expect(etat.erreur).toBeUndefined()
    expect(etat.cible).toBe(join(partage, 'moi'))
    // Le choix est retenu sur le poste : relu tel quel par une nouvelle instance.
    expect(lireDossierDuBoard(racine)).toBe(partage)

    board.enregistrer(CARTE, { 'conv-2': { etage: 'refuse', a: 20 * H } })
    await board.attendre()
    const json = JSON.parse(readFileSync(join(partage, 'moi', 'board.json'), 'utf8'))
    expect(json.format).toBe('autowin-board/1')
    expect(json.poste).toBe('moi')
    expect(
      json.postIts.map((p: { conversationId: string; etage: string }) => [
        p.conversationId,
        p.etage
      ])
    ).toEqual([
      ['conv-1', 'en-cours'],
      ['conv-2', 'refuse']
    ])
    const md = readFileSync(join(partage, 'moi', 'board.md'), 'utf8')
    expect(md).toContain('### conv-1 — Fil conv-1')
    expect(md).toContain('**Refusé** (posé à la main)')
    expect(board.etat().dernier?.postIts).toBe(2)
    expect(board.etat().erreur).toBeUndefined()
  })

  it('un Board inchangé ne réécrit pas le fichier ; un Board changé, si', async () => {
    const racine = temp()
    const partage = temp()
    const board = creerDossierDuBoard({ racine, utilisateur: 'moi', delaiMs: 0 })
    await board.choisir(partage)
    board.enregistrer(CARTE, {})
    await board.attendre()
    const fichier = join(partage, 'moi', 'board.json')
    writeFileSync(fichier, 'témoin', 'utf8')
    board.enregistrer(CARTE, {})
    await board.attendre()
    expect(readFileSync(fichier, 'utf8')).toBe('témoin')
    board.enregistrer(carte([demande({ conversationId: 'conv-9', rang: 0, debut: H })]), {})
    await board.attendre()
    expect(JSON.parse(readFileSync(fichier, 'utf8')).postIts[0].conversationId).toBe('conv-9')
  })

  it('espace deux écritures : la dernière carte reçue part à la fin du délai', async () => {
    const racine = temp()
    const partage = temp()
    let t = 0
    const planifies: (() => void)[] = []
    const board = creerDossierDuBoard({
      racine,
      utilisateur: 'moi',
      delaiMs: 30_000,
      maintenant: () => t,
      planifier: (fn) => {
        planifies.push(fn)
        return { annuler: () => undefined }
      }
    })
    await board.choisir(partage)
    board.enregistrer(CARTE, {})
    await board.attendre()
    board.enregistrer(carte([demande({ conversationId: 'conv-7', rang: 0, debut: H })]), {})
    board.enregistrer(carte([demande({ conversationId: 'conv-8', rang: 0, debut: H })]), {})
    expect(board.etat().enCours).toBe(true)
    expect(planifies).toHaveLength(1)
    t = 30_000
    planifies[0]()
    await board.attendre()
    const json = JSON.parse(readFileSync(join(partage, 'moi', 'board.json'), 'utf8'))
    expect(json.postIts.map((p: { conversationId: string }) => p.conversationId)).toEqual([
      'conv-8'
    ])
  })

  it('un dossier devenu injoignable laisse le Board en état et dit pourquoi', async () => {
    const racine = temp()
    const partage = join(temp(), 'partage')
    mkdirSync(partage)
    const board = creerDossierDuBoard({ racine, utilisateur: 'moi', delaiMs: 0 })
    await board.choisir(partage)
    rmSync(partage, { recursive: true, force: true })
    board.enregistrer(CARTE, {})
    await board.attendre()
    expect(board.etat().erreur).toMatch(/introuvable ou injoignable/)
    expect(board.etat().dernier).toBeUndefined()
  })

  it('seuls les projets choisis partent ; le choix est retenu et survit au changement de dossier', async () => {
    const racine = temp()
    const partage = temp()
    const deuxProjets: CarteDesBesoins = {
      ...CARTE,
      projets: [
        ...CARTE.projets,
        {
          ...CARTE.projets[0],
          cle: 'D:\\Perso',
          libelle: 'Perso',
          demandes: [demande({ conversationId: 'conv-50', rang: 0, debut: 30 * H })]
        }
      ]
    }
    const board = creerDossierDuBoard({ racine, utilisateur: 'moi', delaiMs: 0 })
    await board.choisir(partage)
    // Sans choix : tous les projets partent, y compris le perso.
    board.enregistrer(deuxProjets, {})
    await board.attendre()
    const fichier = join(partage, 'moi', 'board.json')
    const ids = (): string[] =>
      JSON.parse(readFileSync(fichier, 'utf8')).postIts.map(
        (p: { conversationId: string }) => p.conversationId
      )
    expect(ids()).toEqual(['conv-50', 'conv-1', 'conv-2'])

    expect((await board.choisirProjets(['D:\\Projet'])).projets).toEqual(['D:\\Projet'])
    board.enregistrer(deuxProjets, {})
    await board.attendre()
    expect(ids()).toEqual(['conv-1', 'conv-2'])
    expect(JSON.parse(readFileSync(fichier, 'utf8')).demandes).toBe(4)

    // Relu par une nouvelle instance, et gardé quand on oublie puis rechoisit le dossier.
    expect(lireReglageDuBoard(racine)).toEqual({
      dossier: partage,
      projets: ['D:\\Projet'],
      nom: null
    })
    await board.effacer()
    expect(lireReglageDuBoard(racine)).toEqual({
      dossier: null,
      projets: ['D:\\Projet'],
      nom: null
    })
    expect((await board.choisir(partage)).projets).toEqual(['D:\\Projet'])

    // Retour à « tous ».
    expect((await board.choisirProjets(null)).projets).toBeUndefined()
    expect(lireReglageDuBoard(racine).projets).toBeNull()
  })

  it('un choix de projets illisible sur le poste ne partage rien plutôt que tout', () => {
    const racine = temp()
    writeFileSync(
      join(racine, FICHIER_DU_REGLAGE),
      JSON.stringify({ dossier: racine, projets: 'D:\\Projet' }),
      'utf8'
    )
    expect(lireReglageDuBoard(racine).projets).toEqual([])
  })

  // conv-1230 : « nom windows par défaut et un setting pour en choisir un autre ».
  it('écrit le compte Windows comme nom par défaut, puis le nom choisi, gardé au fil des réglages', async () => {
    const racine = temp()
    const partage = temp()
    const board = creerDossierDuBoard({ racine, utilisateur: 'jdupont', delaiMs: 0 })
    expect(board.nomDuPoste()).toEqual({ compte: 'jdupont', nom: 'jdupont' })
    expect(board.etat()).toMatchObject({ nom: 'jdupont', compte: 'jdupont' })
    expect(board.etat().nomChoisi).toBeUndefined()
    await board.choisir(partage)
    const fichier = join(partage, 'jdupont', 'board.json')
    board.enregistrer(CARTE, {})
    await board.attendre()
    expect(JSON.parse(readFileSync(fichier, 'utf8'))).toMatchObject({
      poste: 'jdupont',
      nom: 'jdupont'
    })

    // Le nom choisi part à la copie suivante, même si le Board n'a pas bougé ; le sous-dossier,
    // lui, reste celui du compte (les collègues le retrouvent au même endroit).
    expect(await board.choisirNom('Jean Dupont')).toMatchObject({
      nom: 'Jean Dupont',
      compte: 'jdupont',
      nomChoisi: 'Jean Dupont'
    })
    board.enregistrer(CARTE, {})
    await board.attendre()
    expect(JSON.parse(readFileSync(fichier, 'utf8')).nom).toBe('Jean Dupont')
    expect(readFileSync(join(partage, 'jdupont', 'board.md'), 'utf8')).toContain(
      '# Board — Jean Dupont'
    )

    // Gardé sur le poste, et par les autres réglages : projets, oubli du dossier.
    await board.choisirProjets(['D:\\Projet'])
    await board.effacer()
    expect(lireReglageDuBoard(racine).nom).toBe('Jean Dupont')
    expect(creerDossierDuBoard({ racine, utilisateur: 'jdupont' }).nomDuPoste().nom).toBe(
      'Jean Dupont'
    )

    // Retour au compte Windows.
    expect((await board.choisirNom(null)).nom).toBe('jdupont')
    expect(lireReglageDuBoard(racine).nom).toBeNull()
  })

  it('effacer oublie le dossier sur le poste', async () => {
    const racine = temp()
    const partage = temp()
    const board = creerDossierDuBoard({ racine, utilisateur: 'moi', delaiMs: 0 })
    await board.choisir(partage)
    expect((await board.effacer()).dossier).toBeNull()
    expect(lireDossierDuBoard(racine)).toBeNull()
  })
})

describe('boardEnMarkdown', () => {
  it('un titre de fil sur plusieurs lignes reste sur une seule ligne', () => {
    const md = boardEnMarkdown({
      format: 'autowin-board/1',
      poste: 'moi',
      demandes: 1,
      comptes: comptes(),
      postIts: postItsDuBoard(
        carte([demande({ conversationId: 'conv-4', rang: 0, debut: H, conversationTitre: 'a\nb' })])
      ).postIts,
      filsSansDate: 0,
      runsBloques: []
    })
    expect(md).toContain('### conv-4 — a b')
  })
})
