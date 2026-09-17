import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  RANGEMENT_SYSTEM,
  dossierDeduitParModele,
  rangerConversationSurLePremierMessage
} from './rangement-premier-message'

/**
 * LE CAS FONDATEUR, AVEC SON VRAI MESSAGE (conv-611). Il ne contient pas le mot « Autowin » : seul
 * un jugement sur le SUJET peut le rattacher. Le modele est simule ici — ce qui est prouve, c'est
 * le contrat autour de lui : son choix est borne a la liste, sous seuil il ne range rien, et une
 * panne ne casse pas le tour.
 */
const AUTOWIN = resolve('D:/AutoWinOS')
const BRAINROT = resolve('D:/BrainRotRoyale')
const CONNUS = [AUTOWIN, BRAINROT]
const existe = (): boolean => true
/** Le PREMIER message reel de conv-611, copie de sa trace causale — jamais reecrit. */
const MESSAGE_REEL_CONV_611 =
  '/kaizen mes travaux en paralele se parasitent car ils utilise pas mon systeme de bureau virtuel'
const repond = (charge: unknown) =>
  vi.fn(async (_systeme: string, _charge: string) => JSON.stringify(charge))

describe('dossierDeduitParModele', () => {
  it('range le VRAI premier message de conv-611, qui n ecrit jamais « Autowin »', async () => {
    const envoyer = repond({ dossier: AUTOWIN, confiance: 0.93, motif: 'bureaux virtuels' })
    expect(
      await dossierDeduitParModele(MESSAGE_REEL_CONV_611, CONNUS, BRAINROT, envoyer, existe)
    ).toBe(AUTOWIN)
    const [systeme, charge] = envoyer.mock.calls[0]
    expect(systeme).toBe(RANGEMENT_SYSTEM)
    expect(JSON.parse(charge).dossiers).toEqual(CONNUS)
  })

  it('ne range rien quand la confiance est sous le seuil', async () => {
    expect(
      await dossierDeduitParModele(
        MESSAGE_REEL_CONV_611,
        CONNUS,
        BRAINROT,
        repond({ dossier: AUTOWIN, confiance: 0.6 }),
        existe
      )
    ).toBeNull()
  })

  it('refuse un dossier hors de la liste proposee', async () => {
    expect(
      await dossierDeduitParModele(
        'un sujet',
        CONNUS,
        BRAINROT,
        repond({ dossier: 'D:/Invente', confiance: 1 }),
        existe
      )
    ).toBeNull()
  })

  it('ne range rien si le modele repond vide, du texte libre, ou tombe en panne', async () => {
    const appels = [
      repond({ dossier: '', confiance: 1 }),
      vi.fn(async () => 'je ne sais pas'),
      vi.fn(async () => {
        throw new Error('modele indisponible')
      })
    ]
    for (const envoyer of appels) {
      expect(await dossierDeduitParModele('un sujet', CONNUS, BRAINROT, envoyer, existe)).toBeNull()
    }
  })

  it('ecarte le dossier absent du poste avant meme d interroger le modele', async () => {
    const envoyer = repond({ dossier: AUTOWIN, confiance: 1 })
    expect(
      await dossierDeduitParModele('un sujet', [AUTOWIN], BRAINROT, envoyer, () => false)
    ).toBeNull()
    expect(envoyer).not.toHaveBeenCalled()
  })
})

describe('bout en bout — conv-611 rangee par le modele', () => {
  it('applique le rangement et l annonce, la ou le lexical seul ne trouvait rien', async () => {
    const ranges: string[] = []
    const annonces: string[] = []
    const applique = await rangerConversationSurLePremierMessage({
      conversation: { messages: [{ role: 'user', content: MESSAGE_REEL_CONV_611 }] },
      dossiersConnus: CONNUS,
      dossierActif: BRAINROT,
      existe,
      demanderAuModele: repond({ dossier: AUTOWIN, confiance: 0.95 }),
      ranger: (c) => ranges.push(c),
      annoncer: (m) => annonces.push(m)
    })
    expect(applique).toBe(AUTOWIN)
    expect(ranges).toEqual([AUTOWIN])
    expect(annonces[0]).toContain(AUTOWIN)
  })

  it('ne bascule pas sur une mention en passant quand le modele dit non', async () => {
    const ranges: string[] = []
    const applique = await rangerConversationSurLePremierMessage({
      conversation: {
        messages: [{ role: 'user', content: 'rien a voir avec AutoWinOS, parle moi de cuisine' }]
      },
      dossiersConnus: CONNUS,
      dossierActif: BRAINROT,
      existe,
      demanderAuModele: repond({ dossier: '', confiance: 0.1, motif: 'negation' }),
      ranger: (c) => ranges.push(c),
      annoncer: () => {}
    })
    expect(applique).toBeNull()
    expect(ranges).toEqual([])
  })
})

/**
 * LE VRAI CAS conv-611, MESURE EN DIRECT le 2026-09-16 : la conversation portait
 * `categorie = "Autowin OS"` et AUCUN `projectPath`. Le « dossier » de la barre laterale est donc
 * la CATEGORIE — c'est elle qu'il fallait deduire, sinon le cas fondateur reste non resolu.
 */
describe('rangement par CATEGORIE — le cas conv-611 tel qu il existe vraiment', () => {
  const CATEGORIES = ['Autowin OS', 'Perso']

  it('range dans la categorie « Autowin OS » sans toucher au dossier de travail', async () => {
    const ranges: string[] = []
    const annonces: string[] = []
    const applique = await rangerConversationSurLePremierMessage({
      conversation: { messages: [{ role: 'user', content: MESSAGE_REEL_CONV_611 }] },
      dossiersConnus: CONNUS,
      categoriesConnues: CATEGORIES,
      dossierActif: AUTOWIN,
      existe,
      demanderAuModele: repond({ rangement: 'Autowin OS', confiance: 0.94 }),
      ranger: (c) => ranges.push(c),
      annoncer: (m) => annonces.push(m)
    })
    expect(applique).toBe('Autowin OS')
    expect(ranges).toEqual(['Autowin OS'])
    expect(annonces[0]).toContain('Autowin OS')
  })

  it('propose les deux listes au modele', async () => {
    const envoyer = repond({ rangement: 'Autowin OS', confiance: 0.9 })
    await dossierDeduitParModele(
      MESSAGE_REEL_CONV_611,
      CONNUS,
      AUTOWIN,
      envoyer,
      existe,
      CATEGORIES
    )
    const charge = JSON.parse(envoyer.mock.calls[0][1])
    expect(charge.dossiers).toEqual(CONNUS)
    expect(charge.categories).toEqual(CATEGORIES)
  })

  it('refuse une categorie inventee hors de la liste', async () => {
    expect(
      await dossierDeduitParModele(
        MESSAGE_REEL_CONV_611,
        CONNUS,
        AUTOWIN,
        repond({ rangement: 'Categorie Inventee', confiance: 1 }),
        existe,
        CATEGORIES
      )
    ).toBeNull()
  })

  it('une categorie n est PAS ecartee par la regle du dossier deja actif', async () => {
    expect(
      await dossierDeduitParModele(
        MESSAGE_REEL_CONV_611,
        [AUTOWIN],
        AUTOWIN,
        repond({ rangement: 'Autowin OS', confiance: 0.95 }),
        existe,
        CATEGORIES
      )
    ).toBe('Autowin OS')
  })
})

/**
 * MESURE EN DIRECT (sonde, conv-618, 2026-09-16) : le modele rendait bien « D:\AutoWinOS » a 0,88,
 * et le rangement etait JETE parce que ce dossier etait aussi le dossier ACTIF — alors que celui-ci
 * n'etait qu'un repli, la conversation n'etant rangee nulle part. Le rangement doit s'ecrire.
 */
describe('dossier deja actif par simple repli', () => {
  it('range quand meme : c est ce qui rend le classement visible dans la liste', async () => {
    const ranges: string[] = []
    const annonces: string[] = []
    const applique = await rangerConversationSurLePremierMessage({
      conversation: { messages: [{ role: 'user', content: MESSAGE_REEL_CONV_611 }] },
      dossiersConnus: CONNUS,
      dossierActif: AUTOWIN,
      existe,
      demanderAuModele: repond({ rangement: AUTOWIN, confiance: 0.88 }),
      ranger: (c) => ranges.push(c),
      annoncer: (m) => annonces.push(m)
    })
    expect(applique).toBe(AUTOWIN)
    expect(ranges).toEqual([AUTOWIN])
    expect(annonces[0]).toContain("n'était rangée nulle part")
  })
})

/**
 * LA CATEGORIE PASSE AVANT LE DOSSIER (choix utilisateur du 2026-09-16). Mesure conv-619 : le
 * modele choisissait D:\AutoWinOS alors que la categorie « Autowin OS » existait et designait la
 * meme chose. Une equivalence de NOM suffit a rebasculer sur le libelle.
 */
describe('preference de la categorie sur le dossier', () => {
  it('rebascule sur « Autowin OS » quand le modele a choisi le dossier equivalent', async () => {
    expect(
      await dossierDeduitParModele(
        MESSAGE_REEL_CONV_611,
        CONNUS,
        BRAINROT,
        repond({ rangement: AUTOWIN, confiance: 0.9 }),
        existe,
        ['Autowin OS', 'Perso']
      )
    ).toBe('Autowin OS')
  })

  it('garde le dossier quand aucun libelle ne lui correspond', async () => {
    expect(
      await dossierDeduitParModele(
        'un souci dans le projet',
        CONNUS,
        AUTOWIN,
        repond({ rangement: BRAINROT, confiance: 0.9 }),
        existe,
        ['Autowin OS']
      )
    ).toBe(BRAINROT)
  })

  it('demande explicitement au modele de preferer la categorie', () => {
    expect(RANGEMENT_SYSTEM).toContain('la CATEGORIE PASSE D’ABORD')
  })
})
