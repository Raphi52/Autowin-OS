import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OuvertureDeCopie } from '../copies/copie-de-tache'
import { refDeBaseDuFil } from '../git/photo-du-code'
import { defaultGitRunner } from '../runs/run-autoclose'
import { ConversationStore } from '../store/conversations'
import {
  avertissementDossierConversation,
  diagnostiqueDossierConversation,
  dossierDeLectureDuFil,
  dossierDeTravailDuTour,
  dossierDuFilOuvertPar,
  DossierRangeDisparuError,
  ecrireReglageCopieParFil,
  lireReglageCopieParFil,
  ouvrirLaCopieDuFilPourLeTour,
  preparerLeDossierDuTour,
  refusDossierDuTour,
  refuserTourSiDossierDisparu,
  revenirSiSaCopieADisparu
} from './bascule-dossier-conversation'

describe('avertissement quand le rangement ne pilote pas le dossier de travail', () => {
  const existe = (): boolean => true
  const AUTOWIN = 'D:\\AutoWinOS'
  const avertir = (projectPath: string | undefined, existeF = existe): string | null =>
    avertissementDossierConversation(
      diagnostiqueDossierConversation(projectPath, AUTOWIN, existeF),
      projectPath,
      AUTOWIN
    )

  it('nomme le motif de chaque cas', () => {
    expect(diagnostiqueDossierConversation('D:\\CONTOSOApplication', AUTOWIN, existe)).toBe(
      'bascule-requise'
    )
    expect(diagnostiqueDossierConversation(AUTOWIN, AUTOWIN, existe)).toBe('deja-aligne')
    expect(diagnostiqueDossierConversation(undefined, AUTOWIN, existe)).toBe('non-range')
    expect(diagnostiqueDossierConversation('Clients/Acme', AUTOWIN, existe)).toBe(
      'libelle-non-absolu'
    )
    expect(diagnostiqueDossierConversation('D:\\Disparu', AUTOWIN, () => false)).toBe(
      'dossier-absent'
    )
  })

  /** LE defaut a rendre visible : un libelle laisse le modele dans le depot d'Autowin, en silence. */
  it('avertit sur un libelle de rangement, en citant le dossier reellement utilise', () => {
    const texte = avertir('Clients/Acme')
    expect(texte).toContain('Clients/Acme')
    expect(texte).toContain(AUTOWIN)
  })

  it('avertit sur un dossier disparu du poste', () => {
    expect(avertir('D:\\Disparu', () => false)).toContain('introuvable')
  })

  it('se tait quand le dossier pilote vraiment le travail', () => {
    expect(avertir('D:\\CONTOSOApplication')).toBeNull()
    expect(avertir(AUTOWIN)).toBeNull()
    expect(avertir(undefined)).toBeNull()
  })
})

describe('dossierDeTravailDuTour', () => {
  const existe = (chemin: string): boolean => chemin.toLowerCase().includes('projet')
  const REPLI = resolve('/depot/autowin')

  it('rend le dossier range sur la conversation quand il existe', () => {
    expect(dossierDeTravailDuTour(resolve('/projet/contoso'), REPLI, existe)).toBe(
      resolve('/projet/contoso')
    )
  })

  it('retombe sur le repli pour un libelle non absolu', () => {
    expect(dossierDeTravailDuTour('Clients/Acme', REPLI, existe)).toBe(REPLI)
  })

  it('refuse le tour quand le dossier range a disparu, au lieu de se replier sur le depot partage', () => {
    const disparu = resolve('/disparu')
    let refus: unknown
    try {
      dossierDeTravailDuTour(disparu, REPLI, existe)
    } catch (erreur) {
      refus = erreur
    }
    expect(refus).toBeInstanceOf(DossierRangeDisparuError)
    const raison = (refus as DossierRangeDisparuError).message
    expect(raison).toContain(disparu)
    expect(raison).toContain('disparu')
    expect(raison).toContain('un autre dossier')
    expect(raison).not.toContain(REPLI)
    expect((refus as DossierRangeDisparuError).dossierRange).toBe(disparu)
  })

  it('la lecture sans tour garde le repli quand le dossier range a disparu', () => {
    expect(dossierDeLectureDuFil(resolve('/disparu'), REPLI, existe)).toBe(REPLI)
    expect(dossierDeLectureDuFil(resolve('/projet/x'), REPLI, existe)).toBe(resolve('/projet/x'))
  })

  it('refusDossierDuTour : la raison seulement pour un dossier range disparu', () => {
    expect(refusDossierDuTour(resolve('/disparu'), existe)).toContain('disparu')
    expect(refusDossierDuTour(resolve('/projet/x'), existe)).toBeNull()
    expect(refusDossierDuTour('Clients/Acme', existe)).toBeNull()
    expect(refusDossierDuTour(undefined, existe)).toBeNull()
  })

  it('retombe sur le repli quand la conversation n est pas rangee', () => {
    expect(dossierDeTravailDuTour(undefined, REPLI, existe)).toBe(REPLI)
    expect(dossierDeTravailDuTour('   ', REPLI, existe)).toBe(REPLI)
  })
})

describe('refuserTourSiDossierDisparu (entrée des tours)', () => {
  const absent = (): boolean => false
  const present = (): boolean => true

  it('écrit la raison dans le fil puis lève : le tour ne part pas', () => {
    const ecrit: string[] = []
    const chemin = resolve('/copies/fil-perdu')
    expect(() => refuserTourSiDossierDisparu(chemin, (r) => ecrit.push(r), absent)).toThrow(chemin)
    expect(ecrit).toHaveLength(1)
    expect(ecrit[0]).toContain(chemin)
  })

  it('lève même si l écriture dans le fil échoue', () => {
    expect(() =>
      refuserTourSiDossierDisparu(
        resolve('/copies/x'),
        () => {
          throw new Error('disque plein')
        },
        absent
      )
    ).toThrow(/x/)
  })

  it('jumeau : dossier présent ou fil sans dossier rangé → rien, rien écrit', () => {
    const ecrit: string[] = []
    refuserTourSiDossierDisparu(resolve('/copies/ok'), (r) => ecrit.push(r), present)
    refuserTourSiDossierDisparu(undefined, (r) => ecrit.push(r), absent)
    expect(ecrit).toEqual([])
  })
})

/*
 * UNE COPIE PAR FIL, AU DÉBUT DU TOUR. Un fil d'AutoWinOS (rangé dans le dépôt, ou sans dossier)
 * travaille dans SA copie : son dossier rangé devient la copie, jamais au milieu d'un tour. Les
 * entrées qui font échouer une version fausse :
 *  - un fil déjà commencé : il passe au tour suivant, et le fil le dit en une ligne ;
 *  - un fil rangé dans un autre projet : rien ne change, aucune copie ;
 *  - un fil déjà dans sa copie : pas de seconde copie ;
 *  - le réglage éteint : le fil revient au dossier partagé, sa copie reste intacte.
 * fix-ok: cause mesurée — 12 rouges sur le code d'avant (fonctions absentes), verts ensuite ; la
 * 3e édition n'est que la mise en forme de mes lignes que `npx prettier --check` signalait.
 */
describe('preparerLeDossierDuTour — une copie par fil d’AutoWinOS', () => {
  const DEPOT = 'D:\\AutoWinOS'
  const COPIE = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\retours-de-tour\\essai__conv-1-5-1'
  const existe = (): boolean => true
  /** Une ouverture réussie, dans la forme exacte que rend la primitive (`ouvrirLaCopieDeTache`). */
  // fix-ok: le faux résultat porte base, deja et dependances : sans eux, le typage refuse le stub.
  const OUVERTE: OuvertureDeCopie = {
    ok: true,
    chemin: COPIE,
    base: 'base-du-fil',
    deja: false,
    dependances: { fait: 'liees' }
  }
  type Ouverture = OuvertureDeCopie

  function preparer(
    store: ConversationStore,
    id: string,
    options: {
      actif?: boolean
      depot?: string | null
      ouvrir?: () => Promise<Ouverture>
      questionSeule?: boolean
    } = {}
  ): {
    issue: ReturnType<typeof preparerLeDossierDuTour>
    annonces: string[]
    ouvertures: () => number
  } {
    const annonces: string[] = []
    let ouvertures = 0
    const issue = preparerLeDossierDuTour({
      fil: store.get(id),
      depotPartage: options.depot === undefined ? DEPOT : options.depot,
      actif: options.actif ?? true,
      questionSeule: options.questionSeule ?? false,
      ouvrirCopie: async () => {
        ouvertures += 1
        return options.ouvrir ? options.ouvrir() : OUVERTE
      },
      passer: (copie) => {
        store.passerDansLaCopie(id, copie)
      },
      revenir: () => {
        store.revenirDeLaCopie(id)
      },
      annoncer: (ligne) => annonces.push(ligne),
      dossierExiste: existe
    })
    return { issue, annonces, ouvertures: () => ouvertures }
  }

  it('un fil déjà commencé, rangé dans le dépôt, passe dans sa copie et le dit en une ligne', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    store.append(id, { role: 'user', content: 'premier message' })
    store.append(id, { role: 'assistant', content: 'ma réponse' })

    const essai = preparer(store, id)

    expect(await essai.issue).toBe('ouverte')
    expect(store.get(id)?.projectPath).toBe(COPIE)
    expect(dossierDeTravailDuTour(store.get(id)?.projectPath, DEPOT, existe)).toBe(COPIE)
    expect(essai.annonces).toHaveLength(1)
    expect(essai.annonces[0]).toContain(COPIE)
    expect(essai.annonces[0]).not.toContain('\n')
  })

  it('un nouveau fil sans dossier naît dans sa copie', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude' }).id

    const essai = preparer(store, id)

    expect(await essai.issue).toBe('ouverte')
    expect(store.get(id)?.projectPath).toBe(COPIE)
    expect(essai.ouvertures()).toBe(1)
  })

  it('une question seule n’ouvre aucune copie : le fil reste au dépôt, sans annonce', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude' }).id

    const essai = preparer(store, id, { questionSeule: true })

    expect(await essai.issue).toBe('rien')
    expect(essai.ouvertures()).toBe(0)
    expect(essai.annonces).toEqual([])
    expect(dossierDeTravailDuTour(store.get(id)?.projectPath, DEPOT, existe)).toBe(DEPOT)
  })

  it('une question reprend quand même la copie déjà ouverte du fil : rien de neuf n’est créé', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })
    store.revenirDeLaCopie(id)

    const essai = preparer(store, id, { questionSeule: true })

    expect(await essai.issue).toBe('reprise')
    expect(essai.ouvertures()).toBe(0)
    expect(store.get(id)?.projectPath).toBe(COPIE)
  })

  it('un fil rangé dans un autre projet ne change pas : ni copie, ni annonce', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: 'D:\\AutreProjet' }).id

    const essai = preparer(store, id)

    expect(await essai.issue).toBe('rien')
    expect(store.get(id)?.projectPath).toBe('D:\\AutreProjet')
    expect(essai.ouvertures()).toBe(0)
    expect(essai.annonces).toEqual([])
  })

  it('un fil déjà dans sa copie y reste : jamais une seconde copie', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })

    const essai = preparer(store, id)

    expect(await essai.issue).toBe('rien')
    expect(essai.ouvertures()).toBe(0)
    expect(store.get(id)?.projectPath).toBe(COPIE)
  })

  it('une façon d’« Essaie 3 façons » garde la copie de son essai', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: COPIE }).id

    const essai = preparer(store, id)

    expect(await essai.issue).toBe('rien')
    expect(essai.ouvertures()).toBe(0)
  })

  it('réglage éteint : le fil revient au dossier partagé, sa copie reste notée', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })

    const essai = preparer(store, id, { actif: false })

    expect(await essai.issue).toBe('revenu')
    expect(store.get(id)?.projectPath).toBe(DEPOT)
    expect(store.get(id)?.copieDuFil?.chemin).toBe(COPIE)
    expect(essai.annonces).toHaveLength(1)
    expect(essai.annonces[0]).toContain(COPIE)
  })

  it('réglage éteint : un fil du dépôt n’ouvre aucune copie', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id

    const essai = preparer(store, id, { actif: false })

    expect(await essai.issue).toBe('rien')
    expect(essai.ouvertures()).toBe(0)
    expect(store.get(id)?.projectPath).toBe(DEPOT)
  })

  it('réglage rallumé : le fil reprend SA copie, sans en ouvrir une autre', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    store.passerDansLaCopie(id, { chemin: COPIE, depot: DEPOT })
    store.revenirDeLaCopie(id)

    const essai = preparer(store, id)

    expect(await essai.issue).toBe('reprise')
    expect(essai.ouvertures()).toBe(0)
    expect(store.get(id)?.projectPath).toBe(COPIE)
  })

  it('copie impossible : le fil reste où il était, et la raison est dite', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id

    const essai = preparer(store, id, {
      ouvrir: async () => ({
        ok: false,
        motif: 'chemin-trop-long',
        raison: 'chemin de 216 caractères (215 au plus)'
      })
    })

    expect(await essai.issue).toBe('refusee')
    expect(store.get(id)?.projectPath).toBe(DEPOT)
    expect(essai.annonces.join(' ')).toContain('215 au plus')
  })

  it('hors du dépôt d’Autowin (aucun dépôt partagé) : rien ne change', async () => {
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude' }).id

    const essai = preparer(store, id, { depot: null })

    expect(await essai.issue).toBe('rien')
    expect(essai.ouvertures()).toBe(0)
  })
})

describe('le réglage « une copie par fil »', () => {
  const fichier = (): string =>
    join(mkdtempSync(join(tmpdir(), 'aos-copie-par-fil-')), 'copie-par-fil.json')

  it('allumé par défaut, éteint seulement par un choix écrit', () => {
    const chemin = fichier()
    expect(lireReglageCopieParFil(chemin)).toBe(true)
    expect(ecrireReglageCopieParFil(false, chemin)).toBe(true)
    expect(lireReglageCopieParFil(chemin)).toBe(false)
    expect(ecrireReglageCopieParFil(true, chemin)).toBe(true)
    expect(lireReglageCopieParFil(chemin)).toBe(true)
  })

  it('un fichier illisible garde le mécanisme allumé', () => {
    const chemin = fichier()
    writeFileSync(chemin, '{ pas du json')
    expect(lireReglageCopieParFil(chemin)).toBe(true)
  })
})

/**
 * Une copie de fil retirée par le ménage, ou effacée à la main : le fil revient à son dossier d'avant
 * au lieu d'être refusé (« dossier rangé disparu »). Entrée qui doit faire échouer : un fil qui reste
 * rangé dans sa copie disparue, ou un fil rangé dans un VRAI dossier disparu qui en sort sans refus.
 */
describe('revenirSiSaCopieADisparu (entrée des tours)', () => {
  const COPIE = 'D:/AutoWinOS/.autowin-data/autowin-os/retours-de-tour/essai__conv-7-1-1'
  const dansSaCopie = {
    projectPath: COPIE,
    copieDuFil: { chemin: COPIE, depot: 'D:/AutoWinOS', dossierAvant: 'D:/AutoWinOS' }
  }

  it('fait revenir le fil quand sa copie a disparu', () => {
    let revenu = 0
    expect(
      revenirSiSaCopieADisparu(
        dansSaCopie,
        () => revenu++,
        () => false
      )
    ).toBe(true)
    expect(revenu).toBe(1)
  })

  it('ne touche à rien quand la copie est là, ou quand le dossier disparu n’est pas une copie', () => {
    const revenir = (): never => {
      throw new Error('ne doit pas revenir')
    }
    expect(revenirSiSaCopieADisparu(dansSaCopie, revenir, () => true)).toBe(false)
    expect(revenirSiSaCopieADisparu({ projectPath: 'D:/Perdu' }, revenir, () => false)).toBe(false)
    expect(revenirSiSaCopieADisparu(undefined, revenir, () => false)).toBe(false)
  })
})

/**
 * LE DOSSIER D'UN LOT, OUVERT PAR SON CHEF (2026-11-08). Le lot recevait le dossier rangé du
 * chef, donc sa copie personnelle quand il y travaille : le lot y écrivait par-dessus son chef,
 * sans copie à lui. Entrée qui doit faire échouer : un chef dans sa copie dont le lot hérite de
 * cette copie au lieu du dépôt.
 */
describe('dossierDuFilOuvertPar (fil d’un lot)', () => {
  const COPIE = 'D:/AutoWinOS/.autowin-data/autowin-os/copies-de-fil/conv-7'

  it('rend le dépôt, pas la copie, quand le chef travaille dans sa copie', () => {
    const chef = {
      projectPath: COPIE,
      copieDuFil: { chemin: COPIE, depot: 'D:/AutoWinOS', dossierAvant: 'D:/AutoWinOS' }
    }
    expect(dossierDuFilOuvertPar(chef)).toBe('D:/AutoWinOS')
  })

  it('garde le dossier rangé du chef quand il n’est pas dans sa copie', () => {
    expect(dossierDuFilOuvertPar({ projectPath: 'D:/Projets/Contoso' })).toBe('D:/Projets/Contoso')
    // Une copie notée mais quittée (le chef est revenu ailleurs) ne compte plus.
    const revenu = {
      projectPath: 'D:/Projets/Contoso',
      copieDuFil: { chemin: COPIE, depot: 'D:/AutoWinOS' }
    }
    expect(dossierDuFilOuvertPar(revenu)).toBe('D:/Projets/Contoso')
  })

  it('aucun dossier quand le chef n’en a pas', () => {
    expect(dossierDuFilOuvertPar({ projectPath: '  ' })).toBeUndefined()
    expect(dossierDuFilOuvertPar(undefined)).toBeUndefined()
  })
})

describe('ouvrirLaCopieDuFilPourLeTour — la garde et les annonces d’avant', () => {
  // fix-ok: à la réécriture, le refus perdait le chemin nommé et l'absence de photo (refs/autowin vide), mesurés dans photo-du-code.test.ts de la base 5ffba09f0 ; le test les reprend.
  it('une copie d’avant déjà là (copies-de-fil/<fil>) n’est jamais écrasée : refus nommé, rien n’est écrit', async () => {
    const dossierDeDonnees = mkdtempSync(join(tmpdir(), 'aos-ouverture-garde-'))
    const copieDAvant = join(dossierDeDonnees, 'copies-de-fil', 'conv-1')
    mkdirSync(copieDAvant, { recursive: true })
    writeFileSync(join(copieDAvant, 'travail.txt'), 'travail de l’ancienne copie\n', 'utf8')
    const depot = await depotTemoin()

    const ouverte = await ouvrirLaCopieDuFilPourLeTour({
      dossierDeDonnees,
      depot,
      conversationId: 'conv-1'
    })

    expect(ouverte).toMatchObject({ ok: false, motif: 'dossier-occupe' })
    expect(ouverte.ok ? '' : ouverte.raison).toContain(
      'existe déjà sans être la copie notée sur ce fil'
    )
    // Le refus nomme le dossier à sortir du chemin : l'utilisateur sait ce qui occupe la place.
    expect(ouverte.ok ? '' : ouverte.raison).toContain(copieDAvant)
    expect(readFileSync(join(copieDAvant, 'travail.txt'), 'utf8')).toBe(
      'travail de l’ancienne copie\n'
    )
    expect(existsSync(join(dossierDeDonnees, 'copies-de-taches', 'conv-1'))).toBe(false)
    // Refus avant toute photo : le dépôt n'a ni photo ni base.
    const git = await defaultGitRunner()
    expect(await git(['for-each-ref', 'refs/autowin/'], depot)).toBe('')
  })

  it('un chemin de copie trop long est refusé avec le chemin fautif, comme avant', async () => {
    const dossierDeDonnees = join(
      mkdtempSync(join(tmpdir(), 'aos-ouverture-long-')),
      'x'.repeat(230)
    )
    const depot = await depotTemoin()
    const ouverte = await ouvrirLaCopieDuFilPourLeTour({
      dossierDeDonnees,
      depot,
      conversationId: 'conv-1'
    })
    const chemin = join(dossierDeDonnees, 'copies-de-taches', 'conv-1')

    expect(ouverte).toMatchObject({ ok: false, motif: 'chemin-trop-long' })
    expect(ouverte.ok ? '' : ouverte.raison).toBe(
      `Le dossier de la copie ferait ${chemin.length} caractères (${chemin}) : git pour Windows en accepte 215 caractères au plus. Aucune copie n’a été ouverte.`
    )
    // La longueur se contrôle avant la photo : ni copie, ni base posée dans le dépôt.
    expect(existsSync(join(dossierDeDonnees, 'copies-de-taches'))).toBe(false)
    const git = await defaultGitRunner()
    expect(await git(['for-each-ref', 'refs/autowin/'], depot)).toBe('')
  })
})

/** Un dépôt git témoin : un commit, et un fichier suivi `a.txt` qui vaut « version commitée ». */
async function depotTemoin(): Promise<string> {
  const depot = join(mkdtempSync(join(tmpdir(), 'aos-ouverture-depot-')), 'depot')
  mkdirSync(depot)
  const git = await defaultGitRunner()
  await git(['init', '-q', '-b', 'main'], depot)
  await git(['config', 'user.name', 'Test'], depot)
  await git(['config', 'user.email', 'test@example.invalid'], depot)
  writeFileSync(join(depot, 'a.txt'), 'version commitée\n', 'utf8')
  await git(['add', '-A'], depot)
  await git(['commit', '-q', '-m', 'base'], depot)
  return depot
}

// La limite de longueur s'applique à la copie elle-même : la primitive la contrôle (copie-de-tache.ts).
describe('ouvrirLaCopieDuFilPourLeTour — les cas que l’ouverture garde', () => {
  it('hors dépôt git : refusé avec la raison, et aucun dossier de copies', async () => {
    const dossierDeDonnees = mkdtempSync(join(tmpdir(), 'aos-ouverture-hors-'))
    const hors = mkdtempSync(join(tmpdir(), 'aos-ouverture-hors-depot-'))

    const ouverte = await ouvrirLaCopieDuFilPourLeTour({
      dossierDeDonnees,
      depot: hors,
      conversationId: 'conv-1'
    })

    expect(ouverte).toMatchObject({ ok: false, motif: 'photo-impossible' })
    expect(ouverte.ok ? '' : ouverte.raison).toBe(
      'Impossible de photographier le code de ce fil : son dossier n’est pas un dépôt git, ou la photo n’a pas pu être prise à temps. Aucune copie n’a été ouverte.'
    )
    expect(existsSync(join(dossierDeDonnees, 'copies-de-taches'))).toBe(false)
  })

  it('jumeau accepté : une copie de 215 caractères tout juste ouverte, comme avant', async () => {
    const depot = await depotTemoin()
    const base = mkdtempSync(join(tmpdir(), 'aos-ouverture-jumeau-'))
    const dossierDeDonnees = join(base, 'x'.repeat(190 - base.length))
    const chemin = join(dossierDeDonnees, 'copies-de-taches', 'conv-1')
    expect(chemin.length).toBe(215)

    const ouverte = await ouvrirLaCopieDuFilPourLeTour({
      dossierDeDonnees,
      depot,
      conversationId: 'conv-1'
    })

    // L'échec montre la raison réelle du refus, pas un objet tronqué.
    expect(ouverte.ok ? ouverte.chemin : ouverte.raison).toBe(chemin)
    expect(ouverte).toMatchObject({ ok: true, chemin })
  })

  it('copie de 210 caractères : ouverte comme avant, sans refus sous la limite', async () => {
    const depot = await depotTemoin()
    const base = mkdtempSync(join(tmpdir(), 'aos-ouverture-provisoire-'))
    const dossierDeDonnees = join(base, 'x'.repeat(185 - base.length))
    const chemin = join(dossierDeDonnees, 'copies-de-taches', 'conv-1')
    expect(chemin.length).toBe(210)

    const ouverte = await ouvrirLaCopieDuFilPourLeTour({
      dossierDeDonnees,
      depot,
      conversationId: 'conv-1'
    })

    // L'échec montre la raison réelle du refus, pas un objet tronqué.
    expect(ouverte.ok ? ouverte.chemin : ouverte.raison).toBe(chemin)
    expect(ouverte).toMatchObject({ ok: true, chemin })
  })

  it('une pose de base refusée : aucune copie laissée, et l’annonce dit que rien n’est ouvert', async () => {
    const depot = await depotTemoin()
    const dossierDeDonnees = mkdtempSync(join(tmpdir(), 'aos-ouverture-base-'))
    const gitReel = await defaultGitRunner()

    const ouverte = await ouvrirLaCopieDuFilPourLeTour({
      dossierDeDonnees,
      depot,
      conversationId: 'conv-1',
      runGit: async (args, cwd, options) => {
        if (args[0] === 'update-ref' && args[1] === refDeBaseDuFil('conv-1'))
          throw new Error('panne simulée de la pose de base')
        return gitReel(args, cwd, options)
      }
    })

    expect(ouverte).toMatchObject({ ok: false, motif: 'echec' })
    expect(ouverte.ok ? '' : ouverte.raison).toContain('La base de la tâche n’a pas été posée :')
    expect(ouverte.ok ? '' : ouverte.raison).toContain('Aucune copie n’a été ouverte.')
    expect(existsSync(join(dossierDeDonnees, 'copies-de-taches', 'conv-1'))).toBe(false)
  })

  it('deux fils modifient le même fichier dans leurs copies : le dépôt partagé ne bouge pas', async () => {
    const depot = await depotTemoin()
    const dossierDeDonnees = mkdtempSync(join(tmpdir(), 'aos-ouverture-deux-fils-'))
    const git = await defaultGitRunner()
    const statut = await git(['status', '--porcelain'], depot)

    const neuf = await ouvrirLaCopieDuFilPourLeTour({
      dossierDeDonnees,
      depot,
      conversationId: 'conv-neuf'
    })
    const ancien = await ouvrirLaCopieDuFilPourLeTour({
      dossierDeDonnees,
      depot,
      conversationId: 'conv-ancien'
    })
    expect(neuf).toMatchObject({ ok: true })
    expect(ancien).toMatchObject({ ok: true })
    const copies = [neuf, ancien].map((copie) => (copie as { chemin: string }).chemin)

    writeFileSync(join(copies[0], 'a.txt'), 'écrit par le fil neuf\n', 'utf8')
    writeFileSync(join(copies[1], 'a.txt'), 'écrit par le fil ancien\n', 'utf8')

    expect(new Set(copies).size).toBe(2)
    expect(await git(['status', '--porcelain'], depot)).toBe(statut)
    expect(readFileSync(join(depot, 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'version commitée\n'
    )
  })

  it('machine chargée : l’ouverture attend sa photo au-delà des 5 s du début de tour', async () => {
    // Git est retenu au-delà de 5 s, puis relâché : la photo doit tout de même aboutir.
    const depot = await depotTemoin()
    const dossierDeDonnees = mkdtempSync(join(tmpdir(), 'aos-ouverture-lente-'))
    const gitReel = await defaultGitRunner()
    let relacher!: () => void
    const porte = new Promise<void>((libere) => {
      relacher = libere
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const enCours = ouvrirLaCopieDuFilPourLeTour({
        dossierDeDonnees,
        depot,
        conversationId: 'conv-1',
        runGit: async (args, cwd, options) => {
          await porte
          return gitReel(args, cwd, options)
        }
      })
      await vi.advanceTimersByTimeAsync(5_001)
      vi.useRealTimers()
      relacher()
      expect(await enCours).toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })
})
