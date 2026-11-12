import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { filsVivants, idDuSatellite, jugerDonnees, sessionsAGarder } from './gc-donnees-autowin.mjs'

/*
 * Un `.autowin-data` jetable. Chaque reste reçoit une date : `vieux(n)` = modifié il y a n jours.
 * Fils vivants : conv-1 (instantané), conv-2 (journal), conv-3 (archive). Morts : conv-4 (supprimé
 * par le journal), conv-5 (archive sous pierre tombale), conv-9 (jamais vu).
 */
const MAINTENANT = Date.parse('2026-11-12T08:00:00Z')
const JOUR_MS = 86_400_000
const UUID_CITE = '11111111-2222-3333-4444-555555555555'
const UUID_LIBRE = '66666666-7777-8888-9999-aaaaaaaaaaaa'

let donnees
let ao

function poser(relatif, jours, contenu = 'x') {
  const chemin = join(donnees, relatif)
  mkdirSync(dirname(chemin), { recursive: true })
  writeFileSync(chemin, contenu)
  const date = new Date(MAINTENANT - jours * JOUR_MS)
  utimesSync(chemin, date, date)
  return chemin
}

beforeEach(() => {
  donnees = mkdtempSync(join(tmpdir(), 'gc-donnees-'))
  ao = join(donnees, 'autowin-os')
  poser('autowin-os/conversations.json', 0, JSON.stringify([{ id: 'conv-1' }, { id: 'conv-4' }]))
  poser(
    'autowin-os/conversations.json.journal.jsonl',
    0,
    [
      { op: 'upsert', conversation: { id: 'conv-2' } },
      { op: 'turn-event', turnId: 't' },
      { op: 'delete', id: 'conv-4' }
    ]
      .map((o) => JSON.stringify(o))
      .join('\n')
  )
  poser('autowin-os/conversations.json.archive/conv-3.json', 0, '{}')
  poser('autowin-os/conversations.json.archive/conv-5.json', 0, '{}')
  poser('autowin-os/conversations.json.archive/conv-5.supprime', 0, '')
})

afterEach(() => rmSync(donnees, { recursive: true, force: true }))

describe('idDuSatellite', () => {
  it.each([
    ['conv-12.jsonl', 'conv-12'],
    ['.conv-12.sequence', 'conv-12'],
    ['conv-12-tour-3', 'conv-12'],
    ['conv-12', 'conv-12'],
    ['conv-12abc', null],
    ['systems', null],
    ['run-12.json', null],
    ['xconv-12.jsonl', null]
  ])('%s → %s', (nom, attendu) => expect(idDuSatellite(nom)).toBe(attendu))
})

describe('filsVivants', () => {
  it("rejoue le journal dans l'ordre et ajoute les archives, pierres tombales écartées", () => {
    const fils = filsVivants(ao)
    expect([...fils.ids].sort()).toEqual(['conv-1', 'conv-2', 'conv-3'])
    expect(fils.operations).toEqual({ upsert: 1, 'turn-event': 1, delete: 1 })
  })

  it("lit un instantané précédé d'une marque d'encodage, sous la forme { conversations }", () => {
    const marque = String.fromCharCode(0xfeff)
    poser('autowin-os/conversations.json', 0, `${marque}{"conversations":[{"id":"conv-1"}]}`)
    expect(filsVivants(ao).ids.has('conv-1')).toBe(true)
  })

  it('lève sur un journal abîmé plutôt que de rendre une liste partielle', () => {
    poser('autowin-os/conversations.json.journal.jsonl', 0, '{"op":"upsert"\n')
    expect(() => filsVivants(ao)).toThrow()
  })
})

describe('jugerDonnees', () => {
  const juger = (surcharge = {}) => {
    const runs = sessionsAGarder(
      [
        {
          session: 'conv-9',
          path: join(ao, 'runs', 'conv-9', 'a', 'RUN.md'),
          summary: { bloque: true }
        },
        {
          session: 'conv-5',
          path: join(ao, 'runs', 'conv-5', 'b', 'RUN.md'),
          summary: { bloque: false }
        }
      ],
      { isBlocked: (s) => s.bloque, travaux: ['run-t'], autowinOs: ao }
    )
    return jugerDonnees({
      donnees,
      maintenant: MAINTENANT,
      vivants: filsVivants(ao).ids,
      runs,
      travaux: ['run-t'],
      ...surcharge
    })
  }
  const chemins = (bilan) =>
    bilan.candidats.map((c) => c.chemin.slice(donnees.length + 1).replaceAll('\\', '/')).sort()

  it('ne retient que les restes qui portent leur preuve de mort', () => {
    // Satellites : orphelin et calme 24 h → part ; fil vivant, archivé, récent ou nom ambigu → reste.
    poser('autowin-os/activity/conv-9.jsonl', 3)
    poser('autowin-os/activity/conv-4.jsonl', 3)
    poser('autowin-os/activity/conv-1.jsonl', 90)
    poser('autowin-os/activity/conv-3.jsonl', 90)
    poser('autowin-os/causal-trace/conv-5.jsonl', 0.5)
    poser('autowin-os/turn-journals/inconnu.jsonl', 90)
    poser('autowin-os/chat-artifacts/conv-9/image.png', 2)
    // prompt-observability : orphelin ET 14 j ; `systems/` jamais.
    poser('autowin-os/prompt-observability/conv-9.json', 5)
    poser('autowin-os/prompt-observability/conv-7.json', 20)
    poser('autowin-os/prompt-observability/systems/vieux.json', 90)
    // runs/ : session sans run bloqué ni travail, calme 30 j → part.
    poser('autowin-os/runs/conv-5/b/RUN.md', 40)
    poser('autowin-os/runs/conv-9/a/RUN.md', 40)
    poser('autowin-os/runs/conv-6/c/RUN.md', 40)
    poser('autowin-os/runs/conv-8/d/RUN.md', 10)
    // run-state : conversation lisible et sans run bloqué ; travaux non publiés gardés.
    poser(
      'autowin-os/run-state/run-a.json',
      40,
      JSON.stringify({ conversationId: 'conv-5', agentToken: UUID_CITE })
    )
    poser('autowin-os/run-state/run-b.json', 40, JSON.stringify({ conversationId: 'conv-9' }))
    poser('autowin-os/run-state/run-t.json', 40, JSON.stringify({ conversationId: 'conv-6' }))
    poser('autowin-os/run-state/run-c.json', 40, '{abîmé')
    // run-stdout : uuid cité par un run-state → reste.
    poser(`autowin-os/run-stdout/${UUID_CITE}.log`, 40)
    poser(`autowin-os/run-stdout/${UUID_LIBRE}.log`, 40)
    poser('autowin-os/run-stdout/sans-uuid.log', 40)
    // Sauvegardes et bancs.
    poser('autowin-os/roles.json.bak', 20)
    poser('autowin-os/roles.json.bak.2', 3)
    poser('autowin-os/conversations.json.bak', 20)
    poser('autowin-os/conversations.json.pre-remake', 90)
    poser('autowin-os/banc-lecture/sortie.txt', 20)
    poser('autowin-os/arena-bench-x/sortie.txt', 2)
    // Racine des données.
    poser('tmp/reste.txt', 8)
    poser('vitest-1.txt', 8)
    poser('tmp-capture.png', 2)
    poser('petit.log', 30)

    const bilan = juger()
    expect(chemins(bilan)).toEqual(
      [
        'autowin-os/activity/conv-4.jsonl',
        'autowin-os/activity/conv-9.jsonl',
        'autowin-os/banc-lecture',
        'autowin-os/chat-artifacts/conv-9',
        'autowin-os/prompt-observability/conv-7.json',
        'autowin-os/roles.json.bak',
        'autowin-os/run-state/run-a.json',
        `autowin-os/run-stdout/${UUID_LIBRE}.log`,
        'autowin-os/runs/conv-5',
        'tmp',
        'vitest-1.txt'
      ].sort()
    )
    expect(bilan.compteurs['turn-journals']).toEqual({ ambigu: 1 })
    expect(bilan.compteurs['run-state']).toEqual({
      candidat: 1,
      'run bloqué ou travail': 2,
      'sans conversation lisible': 1
    })
    expect(bilan.compteurs['run-stdout']).toEqual({
      candidat: 1,
      'cité par un run-state': 1,
      ambigu: 1
    })
    expect(bilan.aVerifier.map((a) => a.chemin.endsWith('conversations.json.bak'))).toEqual([true])
    expect(bilan.sondesEnEchec).toEqual([])
    expect(bilan.candidats.every((c) => c.motif.includes('seuil'))).toBe(true)
  })

  it('garde un dossier qui contient une copie git, et le signale', () => {
    poser('autowin-os/runs/conv-5/b/RUN.md', 40)
    poser('autowin-os/runs/conv-5/copie/.git/HEAD', 40)
    const bilan = juger()
    expect(bilan.candidats).toEqual([])
    expect(bilan.aVerifier[0].motif).toMatch(/copie git/u)
  })

  it('une sonde en échec retire sa catégorie du jour, et le dit', () => {
    poser('autowin-os/activity/conv-9.jsonl', 3)
    poser('autowin-os/runs/conv-5/b/RUN.md', 40)
    const bilan = juger({ vivants: null, runs: null })
    expect(bilan.candidats).toEqual([])
    expect(bilan.sondesEnEchec.map((s) => s.categorie).sort()).toEqual(['runs', 'satellites'])
  })
})
