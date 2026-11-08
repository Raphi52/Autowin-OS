import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConversationPourLaCarte, MessageStockePourLaCarte } from './carte-des-besoins'
import {
  DOSSIER_DES_FICHES,
  INDEX_DES_FICHES,
  creerFichesDeDemande,
  ficheMiseAJour,
  lireIndexDesFiches,
  placerLaDemande,
  resumeDeLaFiche,
  type LigneDeFiche,
  type TourPourLaFiche
} from './fiches-de-demande'
import type { LigneBesoin } from '../../shared/ligne-besoin'
import { cleDuJournal } from './journal-des-besoins'

const dossiers: string[] = []
afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
})

function racineTemporaire(): string {
  const racine = mkdtempSync(join(tmpdir(), 'aos-fiches-'))
  dossiers.push(racine)
  return racine
}

const utilisateur = (messageId: string, content: string, ts = 1_000): MessageStockePourLaCarte => ({
  role: 'user',
  messageId,
  content,
  ts
})

const reponse = (
  messageId: string,
  parts: unknown[] = [{ kind: 'text', text: 'fini' }],
  extra: Record<string, unknown> = {}
): MessageStockePourLaCarte =>
  ({
    role: 'assistant',
    messageId,
    content: 'fini',
    status: 'done',
    parts,
    ...extra
  }) as unknown as MessageStockePourLaCarte

const verify = (exitCode: number): unknown => ({
  kind: 'action',
  name: 'verify',
  ok: true,
  data: { command: 'npm test', exitCode, ok: exitCode === 0 }
})

const fil = (id: string, messages: MessageStockePourLaCarte[]): ConversationPourLaCarte => ({
  id,
  title: id,
  messages
})

function tour(
  conversation: ConversationPourLaCarte | undefined,
  conversationId: string,
  messageId: string,
  besoin: LigneBesoin | null
): TourPourLaFiche {
  return {
    evenement: {
      conversationId,
      messageId,
      demandeLe: 1_000,
      demandeur: { nom: 'Personne', email: 'p@exemple.test', dossier: 'D:/depot' },
      besoin
    },
    conversation
  }
}

const cheminDe = (racine: string, ligne: LigneDeFiche | null): string =>
  join(racine, DOSSIER_DES_FICHES, ligne?.fiche ?? 'absente')

describe('placerLaDemande', () => {
  const index = { ficheDuFil: new Map([['conv-1', 'conv-1/a/RUN.md']]) }

  it('une nouvelle demande ouvre toujours une fiche, même si le fil en a une', () => {
    expect(placerLaDemande({ nature: 'nouveau' }, 'conv-1', index)).toEqual({
      classement: 'declare'
    })
  })

  it('une suite rejoint la fiche de son fil', () => {
    expect(placerLaDemande({ nature: 'suite' }, 'conv-1', index)).toEqual({
      fiche: 'conv-1/a/RUN.md',
      classement: 'declare'
    })
  })

  it('« suite conv-1 » depuis un autre fil rejoint la fiche de conv-1', () => {
    expect(placerLaDemande({ nature: 'suite', de: 'conv-1' }, 'conv-2', index)).toEqual({
      fiche: 'conv-1/a/RUN.md',
      classement: 'declare'
    })
  })

  it('une suite sans fiche connue n’est pas perdue : elle en ouvre une, marquée déduite', () => {
    expect(placerLaDemande({ nature: 'suite' }, 'conv-9', index)).toEqual({ classement: 'deduit' })
  })

  it('une ligne de besoin absente rejoint la fiche du fil, marquée déduite', () => {
    expect(placerLaDemande(null, 'conv-1', index)).toEqual({
      fiche: 'conv-1/a/RUN.md',
      classement: 'deduit'
    })
  })
})

describe('ficheMiseAJour', () => {
  it('ne réécrit que l’en-tête, même si le texte imite ses lignes', () => {
    const texte = 'status: en-cours\nmaj: avant\n\n## Besoin\nstatus: faux\nmaj: faux\n'
    expect(ficheMiseAJour(texte, 'prouve', 0)).toBe(
      'status: prouve\nmaj: 1970-01-01T00:00:00.000Z\n\n## Besoin\nstatus: faux\nmaj: faux\n'
    )
  })
})

describe('lireIndexDesFiches', () => {
  it('saute une ligne abîmée et applique un retrait de fil', () => {
    const ligne = (conversationId: string, messageId: string, fiche: string): string =>
      JSON.stringify({ v: 1, ts: 1, fiche, conversationId, messageId })
    const index = lireIndexDesFiches(
      [
        ligne('conv-1', 'm1', 'conv-1/a/RUN.md'),
        '{coupée',
        ligne('conv-2', 'm2', 'conv-1/a/RUN.md'),
        ligne('conv-3', 'm3', 'conv-3/b/RUN.md'),
        JSON.stringify({ v: 1, ts: 2, retraitDuFil: 'conv-1' })
      ].join('\n')
    )
    expect([...index.parMessage.keys()]).toHaveLength(1)
    expect([...index.ficheDuFil.entries()]).toEqual([['conv-3', 'conv-3/b/RUN.md']])
  })
})

describe('creerFichesDeDemande', () => {
  it('une nouvelle demande écrit un RUN.md hors de runs/, avec l’état du Board', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine, maintenant: () => 86_400_000 })
    const conversation = fil('conv-1', [
      utilisateur('m1', 'Ajoute un tri par date'),
      reponse('m2', [verify(0)])
    ])

    const ligne = await fiches.noterTour(tour(conversation, 'conv-1', 'm1', { nature: 'nouveau' }))

    expect(ligne?.fiche).toMatch(/^conv-1\/ajoute-tri-date-[a-z0-9]+\/RUN\.md$/u)
    expect(ligne).toMatchObject({ role: 'besoin', classement: 'declare', etat: 'prouve' })
    expect(existsSync(join(racine, 'runs'))).toBe(false)
    const texte = readFileSync(cheminDe(racine, ligne), 'utf8')
    expect(texte).toContain('status: prouve\nsession: conv-1\nregime: leger\ndemande: m1\n')
    expect(texte).toContain('demandeur: Personne\ndossier: D:/depot\nclassement: declare\n')
    expect(texte).not.toContain('p@exemple.test')
    expect(texte).toContain('## Besoin\nAjoute un tri par date\n')
    expect(texte).toContain('Résultat (1970-01-02 00:00 UTC) : prouvé — npm test → exit 0')
  })

  it('une suite s’ajoute au même fichier et met son état à jour', async () => {
    const racine = racineTemporaire()
    let maintenant = 1_000_000
    const fiches = creerFichesDeDemande({ racine, maintenant: () => (maintenant += 60_000) })
    const debut = [utilisateur('m1', 'Ajoute un tri'), reponse('m2', [verify(0)])]
    const premiere = await fiches.noterTour(
      tour(fil('conv-1', debut), 'conv-1', 'm1', { nature: 'nouveau' })
    )
    const seconde = await fiches.noterTour(
      tour(
        fil('conv-1', [...debut, utilisateur('m3', 'Il casse sur les dates vides'), reponse('m4')]),
        'conv-1',
        'm3',
        { nature: 'suite' }
      )
    )

    expect(seconde).toMatchObject({ fiche: premiere?.fiche, role: 'suite', etat: 'sans-preuve' })
    expect(readdirSync(join(racine, DOSSIER_DES_FICHES, 'conv-1'))).toHaveLength(1)
    const texte = readFileSync(cheminDe(racine, seconde), 'utf8')
    expect(texte.startsWith('status: sans-preuve\n')).toBe(true)
    expect(texte).toContain('## Besoin\nAjoute un tri\n')
    expect(texte).toMatch(/## Suite \(.+ UTC, conv-1\)\nIl casse sur les dates vides\n/u)
    expect(texte).toContain('sans preuve — fini sans vérification')
  })

  it('une fiche suit l’état que le Board montre après coup : fusion arrivée, règle changée', async () => {
    const racine = racineTemporaire()
    let maintenant = 1_000_000
    const fiches = creerFichesDeDemande({ racine, maintenant: () => (maintenant += 60_000) })
    const refusee = await fiches.noterTour(
      tour(
        fil('conv-1', [utilisateur('m1', 'Corrige le tri'), reponse('m2', [verify(1)])]),
        'conv-1',
        'm1',
        { nature: 'nouveau' }
      )
    )
    expect(refusee).toMatchObject({ etat: 'refuse' })
    const constatDuBoard = 'npm test → exit 0'
    const ecart = [
      { conversationId: 'conv-1', messageId: 'm1', etatDuBoard: 'prouve' as const, constatDuBoard }
    ]

    expect(await fiches.resynchroniser(ecart)).toBe(1)

    const ligne = (await fiches.lignes()).find((l) => l.messageId === 'm1')
    expect(ligne).toMatchObject({ etat: 'prouve', constat: constatDuBoard, fiche: refusee?.fiche })
    const texte = readFileSync(cheminDe(racine, refusee), 'utf8')
    expect(texte.startsWith('status: prouve\n')).toBe(true)
    expect(texte).toContain(': prouvé — npm test → exit 0')
    // Rejouée sans rien de nouveau : rien n'est ajouté.
    expect(await fiches.resynchroniser(ecart)).toBe(0)
  })

  it('mettre à jour une fiche ancienne ne détourne pas la suite du fil vers elle', async () => {
    const racine = racineTemporaire()
    let maintenant = 1_000_000
    const fiches = creerFichesDeDemande({ racine, maintenant: () => (maintenant += 60_000) })
    const premier = [utilisateur('m1', 'Premier sujet'), reponse('m2', [verify(1)])]
    const ancienne = await fiches.noterTour(
      tour(fil('conv-1', premier), 'conv-1', 'm1', { nature: 'nouveau' })
    )
    const deuxieme = [...premier, utilisateur('m3', 'Autre sujet'), reponse('m4', [verify(0)])]
    const recente = await fiches.noterTour(
      tour(fil('conv-1', deuxieme), 'conv-1', 'm3', { nature: 'nouveau' })
    )
    expect(recente?.fiche).not.toBe(ancienne?.fiche)

    await fiches.resynchroniser([
      { conversationId: 'conv-1', messageId: 'm1', etatDuBoard: 'prouve', constatDuBoard: 'ok' }
    ])
    const suite = await fiches.noterTour(
      tour(
        fil('conv-1', [...deuxieme, utilisateur('m5', 'Et aussi ceci'), reponse('m6')]),
        'conv-1',
        'm5',
        { nature: 'suite' }
      )
    )

    expect(suite).toMatchObject({ role: 'suite', fiche: recente?.fiche })
  })

  it('une question n’ouvre pas de fiche et ne touche pas celle du fil', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const conversation = fil('conv-1', [utilisateur('m1', 'Pourquoi ?'), reponse('m2')])

    expect(
      await fiches.noterTour(tour(conversation, 'conv-1', 'm1', { nature: 'aucun' }))
    ).toBeNull()
    expect(existsSync(join(racine, DOSSIER_DES_FICHES))).toBe(false)
  })

  it('une demande que le Board ne montre pas n’a pas de fiche', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })

    expect(
      await fiches.noterTour(tour(undefined, 'conv-1', 'm1', { nature: 'nouveau' }))
    ).toBeNull()
    expect(
      await fiches.noterTour(
        tour(fil('conv-1', [utilisateur('autre', 'Bonjour')]), 'conv-1', 'm1', {
          nature: 'nouveau'
        })
      )
    ).toBeNull()
  })

  it('une ligne de besoin absente ne perd pas la demande', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const conversation = fil('conv-1', [utilisateur('m1', 'Corrige le bouton'), reponse('m2')])

    expect(await fiches.noterTour(tour(conversation, 'conv-1', 'm1', null))).toMatchObject({
      role: 'besoin',
      classement: 'deduit'
    })
  })

  it('un tour repris sur le même message met à jour l’état sans refaire de bloc', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const messages = [utilisateur('m1', 'Corrige le bouton')]
    const premier = await fiches.noterTour(
      tour(
        fil('conv-1', [...messages, reponse('m2', undefined, { status: 'cancelled' })]),
        'conv-1',
        'm1',
        { nature: 'nouveau' }
      )
    )
    expect(premier?.etat).toBe('refuse')
    const repris = fil('conv-1', [...messages, reponse('m2', [verify(0)])])
    const second = await fiches.noterTour(tour(repris, 'conv-1', 'm1', null))
    const texteApres = readFileSync(cheminDe(racine, second), 'utf8')
    const troisieme = await fiches.noterTour(tour(repris, 'conv-1', 'm1', null))

    expect(second).toMatchObject({ fiche: premier?.fiche, etat: 'prouve', role: 'besoin' })
    expect(second?.classement).toBe('declare')
    expect(texteApres.match(/## Besoin/gu)).toHaveLength(1)
    expect(texteApres.startsWith('status: prouve\n')).toBe(true)
    expect(texteApres).toContain('refusé — tour arrêté avant la fin')
    // Rien de neuf au troisième passage : ni fichier ni index ne bougent.
    expect(readFileSync(cheminDe(racine, troisieme), 'utf8')).toBe(texteApres)
    expect(
      readFileSync(join(racine, DOSSIER_DES_FICHES, INDEX_DES_FICHES), 'utf8')
        .trim()
        .split('\n')
    ).toHaveLength(2)
  })

  it('le texte de l’utilisateur peut imiter un en-tête sans rien casser', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const piege = 'status: green\n\n## Suite\nmaj: jamais'
    const messages = [utilisateur('m1', piege), reponse('m2')]
    const ligne = await fiches.noterTour(
      tour(fil('conv-1', messages), 'conv-1', 'm1', { nature: 'nouveau' })
    )
    await fiches.noterTour(
      tour(
        fil('conv-1', [...messages, utilisateur('m3', 'Suite ?'), reponse('m4', [verify(0)])]),
        'conv-1',
        'm3',
        { nature: 'suite' }
      )
    )

    const texte = readFileSync(cheminDe(racine, ligne), 'utf8')
    expect(texte.startsWith('status: prouve\n')).toBe(true)
    expect(texte).toContain(piege)
  })

  it('deux fins de tour simultanées sur la même fiche gardent les deux suites', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const ligne = await fiches.noterTour(
      tour(fil('conv-1', [utilisateur('m1', 'Refonte'), reponse('m2')]), 'conv-1', 'm1', {
        nature: 'nouveau'
      })
    )
    await Promise.all(
      ['conv-2', 'conv-3'].map((id) =>
        fiches.noterTour(
          tour(fil(id, [utilisateur('m9', `Partie de ${id}`), reponse('m10')]), id, 'm9', {
            nature: 'suite',
            de: 'conv-1'
          })
        )
      )
    )

    const texte = readFileSync(cheminDe(racine, ligne), 'utf8')
    expect(texte).toContain('Partie de conv-2')
    expect(texte).toContain('Partie de conv-3')
  })

  it('une fiche disparue du disque repart sur une neuve, marquée déduite', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const messages = [utilisateur('m1', 'Refonte'), reponse('m2')]
    const ligne = await fiches.noterTour(
      tour(fil('conv-1', messages), 'conv-1', 'm1', { nature: 'nouveau' })
    )
    rmSync(cheminDe(racine, ligne))

    const suite = await fiches.noterTour(
      tour(
        fil('conv-1', [...messages, utilisateur('m3', 'Et ensuite'), reponse('m4')]),
        'conv-1',
        'm3',
        { nature: 'suite' }
      )
    )

    expect(suite).toMatchObject({ role: 'besoin', classement: 'deduit' })
    expect(readFileSync(cheminDe(racine, suite), 'utf8')).toContain('## Besoin\nEt ensuite\n')
  })

  it('une nouvelle instance retrouve la fiche du fil sur le disque', async () => {
    const racine = racineTemporaire()
    const messages = [utilisateur('m1', 'Refonte'), reponse('m2')]
    const ligne = await creerFichesDeDemande({ racine }).noterTour(
      tour(fil('conv-1', messages), 'conv-1', 'm1', { nature: 'nouveau' })
    )
    const apresRedemarrage = creerFichesDeDemande({ racine })

    const suite = await apresRedemarrage.noterTour(
      tour(
        fil('conv-1', [...messages, utilisateur('m3', 'Et ensuite'), reponse('m4')]),
        'conv-1',
        'm3',
        { nature: 'suite' }
      )
    )

    expect(suite?.fiche).toBe(ligne?.fiche)
    expect(await apresRedemarrage.lignes()).toHaveLength(2)
  })

  it('un fil supprimé emporte son dossier et sort des lignes, même après redémarrage', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    await fiches.noterTour(
      tour(fil('conv-1', [utilisateur('m1', 'Refonte'), reponse('m2')]), 'conv-1', 'm1', {
        nature: 'nouveau'
      })
    )

    await fiches.retirerLeFil('conv-1')

    expect(existsSync(join(racine, DOSSIER_DES_FICHES, 'conv-1'))).toBe(false)
    expect(await fiches.lignes()).toEqual([])
    expect(await creerFichesDeDemande({ racine }).lignes()).toEqual([])
  })

  /*
   * Mesuré dans `ecarts.json` : 21 des 35 demandes « sans fiche » en avaient une. Supprimer
   * un fil avait effacé la fiche où (sa branche, toujours ouverte) rangeait ses demandes,
   * et leurs 18 lignes ; supprimer avait effacé de même les 3 suites.
   */
  it('un fil supprimé laisse en place la fiche qu’un autre fil a nourrie, avec ses lignes', async () => {
    const racine = racineTemporaire()
    let maintenant = 1_000_000
    const fiches = creerFichesDeDemande({ racine, maintenant: () => (maintenant += 60_000) })
    const chantier = fil('conv-1', [
      utilisateur('m1', 'Construis le village'),
      reponse('m2'),
      utilisateur('m3', 'Autre sujet'),
      reponse('m4')
    ])
    const partagee = await fiches.noterTour(tour(chantier, 'conv-1', 'm1', { nature: 'nouveau' }))
    const lot = fil('conv-2', [utilisateur('l1', 'Lot 1/2'), reponse('l2')])
    await fiches.noterTour(tour(lot, 'conv-2', 'l1', { nature: 'suite', de: 'conv-1' }))
    const seule = await fiches.noterTour(tour(chantier, 'conv-1', 'm3', { nature: 'nouveau' }))

    await fiches.retirerLeFil('conv-1')

    expect(existsSync(cheminDe(racine, partagee))).toBe(true)
    expect(existsSync(cheminDe(racine, seule))).toBe(false)
    for (const instance of [fiches, creerFichesDeDemande({ racine })])
      expect(
        (await instance.lignes()).map((l) => [l.conversationId, l.messageId, l.fiche])
      ).toEqual([['conv-2', 'l1', partagee?.fiche]])
    // La suite suivante du lot rejoint toujours la même fiche.
    const suite = await fiches.noterTour(
      tour(
        { ...lot, messages: [...lot.messages, utilisateur('l3', 'Lot 2/2'), reponse('l4')] },
        'conv-2',
        'l3',
        { nature: 'suite' }
      )
    )
    expect(suite?.fiche).toBe(partagee?.fiche)
  })

  it('un identifiant de fil qui sortirait du dossier est refusé', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })

    expect(
      await fiches.noterTour(
        tour(fil('../x', [utilisateur('m1', 'Refonte'), reponse('m2')]), '../x', 'm1', {
          nature: 'nouveau'
        })
      )
    ).toBeNull()
    await fiches.retirerLeFil('..')
    expect(existsSync(racine)).toBe(true)
  })
})

// Les fiches s'écrivaient, mais aucun écran ne les lisait.
describe('resumeDeLaFiche', () => {
  it('lit l’état de l’en-tête seul et la première ligne du besoin', () => {
    const texte =
      'status: refuse\nsession: conv-1\n\n## Besoin\n\nRefais   le Board\nstatus: prouve\n'
    expect(resumeDeLaFiche(texte)).toEqual({ statut: 'refuse', titre: 'Refais le Board' })
  })

  it('un état inconnu n’est pas recopié', () => {
    expect(resumeDeLaFiche('status: green\n\n## Besoin\nX\n')).toEqual({ titre: 'X' })
  })
})

describe('lecture des fiches pour l’interface', () => {
  it('le panneau d’un fil voit sa fiche ET celle du chantier où il a rangé une suite', async () => {
    const racine = racineTemporaire()
    let maintenant = 1_000_000
    const fiches = creerFichesDeDemande({ racine, maintenant: () => (maintenant += 60_000) })
    const chantier = fil('conv-1', [utilisateur('m1', 'Construis le village'), reponse('m2')])
    const premiere = await fiches.noterTour(tour(chantier, 'conv-1', 'm1', { nature: 'nouveau' }))
    const lot = fil('conv-2', [utilisateur('l1', 'Lot 1/2 — la présence'), reponse('l2')])
    await fiches.noterTour(tour(lot, 'conv-2', 'l1', { nature: 'suite', de: 'conv-1' }))
    const autre = fil('conv-3', [utilisateur('a1', 'Autre chose'), reponse('a2', [verify(0)])])
    await fiches.noterTour(tour(autre, 'conv-3', 'a1', { nature: 'nouveau' }))

    const duLot = await fiches.fichesDuFil('conv-2')
    expect(duLot).toHaveLength(1)
    expect(duLot[0]).toMatchObject({
      chemin: cheminDe(racine, premiere),
      conversationId: 'conv-1',
      titre: 'Construis le village',
      statut: 'sans-preuve',
      demandes: 2
    })
    expect((await fiches.fichesDuFil('conv-1')).map((f) => f.chemin)).toEqual([
      cheminDe(racine, premiere)
    ])
    expect(await fiches.fichesDuFil('conv-9')).toEqual([])
    expect(await fiches.fichesDuFil('../conv-1')).toEqual([])
  })

  it('le Board reçoit le chemin de la fiche de chaque demande', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const conversation = fil('conv-1', [utilisateur('m1', 'Ajoute un tri'), reponse('m2')])
    const ligne = await fiches.noterTour(tour(conversation, 'conv-1', 'm1', { nature: 'nouveau' }))

    expect(await fiches.fichesDesDemandes()).toEqual({ 'conv-1': { m1: cheminDe(racine, ligne) } })
  })

  it('donne au calcul du Board la fiche de chaque demande, sous la clé du journal (conv-1456)', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const conversation = fil('conv-1', [
      utilisateur('m1', 'Ajoute un tri'),
      reponse('m2'),
      utilisateur('m3', 'Et le filtre aussi'),
      reponse('m4')
    ])
    const besoin = await fiches.noterTour(tour(conversation, 'conv-1', 'm1', { nature: 'nouveau' }))
    await fiches.noterTour(tour(conversation, 'conv-1', 'm3', { nature: 'suite' }))

    // La suite pointe sur la même fiche : c'est ce qui la range sur le même post-it.
    expect(await fiches.fichesParDemande()).toEqual(
      new Map([
        [cleDuJournal('conv-1', 'm1'), besoin?.fiche],
        [cleDuJournal('conv-1', 'm3'), besoin?.fiche]
      ])
    )
  })

  it('une fiche effacée à la main disparaît du panneau sans erreur', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const conversation = fil('conv-1', [utilisateur('m1', 'Ajoute un tri'), reponse('m2')])
    const ligne = await fiches.noterTour(tour(conversation, 'conv-1', 'm1', { nature: 'nouveau' }))
    rmSync(cheminDe(racine, ligne))

    expect(await fiches.fichesDuFil('conv-1')).toEqual([])
  })
})

/*
 * LES VERSIONS PARALLÈLES (« façon 1/3 »…) ET TOUTE BRANCHE D'UN FIL (2026-11-03).
 * Mesuré dans `ecarts.json` : les 3 seules demandes sans fiche étaient la demande d'origine RECOPIÉE
 * et 1427. La copie change l'identifiant du message et
 * aucun tour ne finit dessus dans la branche : ni journal, ni fiche. Elle rejoint celle de l'origine.
 */
describe('demandes recopiées dans une branche', () => {
  const source = (): ConversationPourLaCarte =>
    fil('conv-1', [
      utilisateur('m1', 'Rends le fond net', 1_000),
      reponse('m2', [verify(0)], { ts: 1_000, turnId: 't1' }),
      utilisateur('m3', 'Et les animations', 2_000),
      reponse('m4', [verify(0)], { ts: 2_000, turnId: 't2' })
    ])
  /** Ce que `fork()` du store rend : mêmes messages, identifiants neufs, origine notée. */
  const branche = (
    depuis: ConversationPourLaCarte,
    jusquA: number,
    id = 'conv-2'
  ): ConversationPourLaCarte & { forkedFrom: { conversationId: string; messageId: string } } => ({
    id,
    title: `${depuis.title} — façon 1/3`,
    messages: depuis.messages
      .slice(0, jusquA + 1)
      .map((message, rang) => ({ ...message, messageId: `${id}-copie-${rang}` })),
    forkedFrom: {
      conversationId: depuis.id,
      messageId: depuis.messages[jusquA]?.messageId ?? ''
    }
  })

  it('la demande recopiée pointe sur la fiche d’origine, sans rien écrire dans son RUN.md', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const origine = source()
    const premiere = await fiches.noterTour(tour(origine, 'conv-1', 'm1', { nature: 'nouveau' }))
    const avant = readFileSync(cheminDe(racine, premiere), 'utf8')

    const copie = branche(origine, 1)
    expect(await fiches.rattacherLaBranche({ branche: copie, source: origine })).toBe(1)

    expect((await fiches.fichesDesDemandes())['conv-2']).toEqual({
      'conv-2-copie-0': cheminDe(racine, premiere)
    })
    expect(await fiches.fichesDuFil('conv-2')).toMatchObject([
      { chemin: cheminDe(racine, premiere), conversationId: 'conv-1', demandes: 1 }
    ])
    expect(readFileSync(cheminDe(racine, premiere), 'utf8')).toBe(avant)
    // Rejouée (redémarrage, second appel) : rien de neuf.
    expect(await fiches.rattacherLaBranche({ branche: copie, source: origine })).toBe(0)
    const lignes = await fiches.lignes()
    expect(lignes.filter((l) => l.conversationId === 'conv-2')).toMatchObject([
      { role: 'copie', etat: 'prouve', fiche: premiere?.fiche }
    ])
  })

  it('chaque demande recopiée retrouve SA fiche, et la suite de la branche rejoint la dernière', async () => {
    const racine = racineTemporaire()
    let maintenant = 1_000_000
    const fiches = creerFichesDeDemande({ racine, maintenant: () => (maintenant += 60_000) })
    const origine = source()
    const premiere = await fiches.noterTour(tour(origine, 'conv-1', 'm1', { nature: 'nouveau' }))
    const seconde = await fiches.noterTour(tour(origine, 'conv-1', 'm3', { nature: 'nouveau' }))
    const copie = branche(origine, 3)
    expect(await fiches.rattacherLaBranche({ branche: copie, source: origine })).toBe(2)
    expect((await fiches.fichesDesDemandes())['conv-2']).toEqual({
      'conv-2-copie-0': cheminDe(racine, premiere),
      'conv-2-copie-2': cheminDe(racine, seconde)
    })

    // La branche continue : sa suite rejoint la fiche de la dernière demande qu'elle a reçue.
    const suite = {
      ...copie,
      messages: [...copie.messages, utilisateur('b1', 'Repeins la ville', 3_000), reponse('b2')]
    }
    const ligne = await fiches.noterTour(tour(suite, 'conv-2', 'b1', { nature: 'suite' }))
    expect(ligne).toMatchObject({ fiche: seconde?.fiche, role: 'suite', classement: 'declare' })
  })

  it('une branche qui a déjà sa propre fiche la garde quand ses copies sont rattachées après', async () => {
    const racine = racineTemporaire()
    let maintenant = 1_000_000
    const fiches = creerFichesDeDemande({ racine, maintenant: () => (maintenant += 60_000) })
    const origine = source()
    await fiches.noterTour(tour(origine, 'conv-1', 'm1', { nature: 'nouveau' }))
    const copie = branche(origine, 1)
    const suite = {
      ...copie,
      messages: [...copie.messages, utilisateur('b1', 'Repeins la ville', 3_000), reponse('b2')]
    }
    const propre = await fiches.noterTour(tour(suite, 'conv-2', 'b1', { nature: 'nouveau' }))

    expect(await fiches.rattacherLaBranche({ branche: suite, source: origine })).toBe(1)
    const ligne = await fiches.noterTour(
      tour(
        { ...suite, messages: [...suite.messages, utilisateur('b3', 'Plus net'), reponse('b4')] },
        'conv-2',
        'b3',
        { nature: 'suite' }
      )
    )
    expect(ligne?.fiche).toBe(propre?.fiche)
    // Même résultat pour une instance neuve, qui relit l'index sur le disque.
    const relue = creerFichesDeDemande({ racine, maintenant: () => (maintenant += 60_000) })
    const apres = await relue.noterTour(
      tour(
        {
          ...suite,
          messages: [...suite.messages, utilisateur('b5', 'Encore'), reponse('b6')]
        },
        'conv-2',
        'b5',
        { nature: 'suite' }
      )
    )
    expect(apres?.fiche).toBe(propre?.fiche)
  })

  /*
   * Et 1494 sont nées pendant qu'un fil écrivait encore sa réponse.
   * La copie a gardé la réponse coupée (109 caractères de parties, 4 211 dans la source) : comparée
   * mot pour mot, plus rien n'était apparié, ni à la création ni à aucun démarrage.
   */
  it('une branche née pendant que la source répondait encore est rattachée quand même', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const origine = source()
    const premiere = await fiches.noterTour(tour(origine, 'conv-1', 'm1', { nature: 'nouveau' }))
    const entiere = branche(origine, 1)
    const coupee = {
      ...entiere.messages[1],
      content: 'fi',
      parts: [{ kind: 'text', text: 'fi' }],
      status: 'interrupted'
    } as unknown as MessageStockePourLaCarte
    const copie = { ...entiere, messages: [entiere.messages[0], coupee] }

    expect(await fiches.rattacherLaBranche({ branche: copie, source: origine })).toBe(1)
    expect((await fiches.fichesDesDemandes())['conv-2']).toEqual({
      'conv-2-copie-0': cheminDe(racine, premiere)
    })
  })

  it('une branche dont l’histoire ne colle plus à sa source n’est rattachée à rien', async () => {
    const racine = racineTemporaire()
    const fiches = creerFichesDeDemande({ racine })
    const origine = source()
    await fiches.noterTour(tour(origine, 'conv-1', 'm1', { nature: 'nouveau' }))
    const copie = branche(origine, 1)
    const reecrite = {
      ...copie,
      messages: [utilisateur('conv-2-copie-0', 'Autre chose', 1_000), ...copie.messages.slice(1)]
    }

    expect(await fiches.rattacherLaBranche({ branche: reecrite, source: origine })).toBe(0)
    expect(
      await fiches.rattacherLaBranche({
        branche: { ...copie, forkedFrom: undefined },
        source: origine
      })
    ).toBe(0)
    expect((await fiches.fichesDesDemandes())['conv-2']).toBeUndefined()
  })
})
