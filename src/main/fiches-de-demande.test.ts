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
  type LigneDeFiche,
  type TourPourLaFiche
} from './fiches-de-demande'
import type { LigneBesoin } from '../shared/ligne-besoin'

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
