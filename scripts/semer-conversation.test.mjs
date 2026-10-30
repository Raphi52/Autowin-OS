import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  emplacementsDeConversation,
  lignesDuJournal,
  racineDonneesInstance,
  retirerSemence,
  semerConversation
} from './semer-conversation.mjs'
import { demandeDeConversation } from './ui-capture.mjs'

let dossiers = []
afterEach(() => {
  for (const dossier of dossiers) rmSync(dossier, { recursive: true, force: true })
  dossiers = []
})
const temporaire = () => {
  const dossier = mkdtempSync(join(tmpdir(), 'semer-conv-'))
  dossiers.push(dossier)
  return dossier
}
const ecrire = (chemin, contenu) => {
  mkdirSync(join(chemin, '..'), { recursive: true })
  writeFileSync(chemin, contenu)
}
const ligne = (objet) => JSON.stringify({ schema: 'autowin.conversation-change/v1', ...objet })

/** Une racine de données avec DEUX conversations : seule la première doit passer. */
function racineSource() {
  const source = temporaire()
  ecrire(
    join(source, 'conversations.json'),
    JSON.stringify([
      { id: 'conv-955', title: 'la bonne', messages: [] },
      { id: 'conv-1', title: 'une autre', messages: [] }
    ])
  )
  ecrire(
    join(source, 'conversations.json.journal.jsonl'),
    [
      ligne({ op: 'turn-event', id: 'conv-955', turnId: 't1', event: { kind: 'delta' } }),
      ligne({ op: 'turn-event', id: 'conv-1', turnId: 't2', event: { kind: 'delta' } }),
      ligne({ op: 'upsert', conversation: { id: 'conv-955', title: 'recree' } }),
      '{ illisible'
    ].join('\n')
  )
  for (const id of ['conv-955', 'conv-1']) {
    ecrire(join(source, 'causal-trace', `${id}.jsonl`), `trace ${id}`)
    ecrire(join(source, 'activity', `${id}.jsonl`), `activite ${id}`)
    ecrire(join(source, 'runs', id, 'run-a', 'RUN.md'), `run ${id}`)
    ecrire(join(source, 'runs', id, 'run-a', 'trace.json'), '[]')
    // Ce qui fait AGIR l'application au démarrage : ne doit jamais être copié.
    ecrire(join(source, 'turn-journals', id, 't1.jsonl'), '{"kind":"start"}')
    ecrire(join(source, 'run-state', `${id}.json`), '{}')
  }
  ecrire(join(source, 'causal-trace', '.conv-955.sequence'), '42')
  return source
}

describe('semerConversation — une conversation copiée dans l’instance cachée', () => {
  it('copie la conversation demandée, et elle seule', () => {
    const source = racineSource()
    const destination = join(temporaire(), 'instance')
    const rapport = semerConversation({ source, destination, id: 'conv-955' })

    expect(rapport.ok).toBe(true)
    expect(JSON.parse(readFileSync(join(destination, 'conversations.json'), 'utf8'))).toEqual([
      { id: 'conv-955', title: 'la bonne', messages: [] }
    ])
    const journal = readFileSync(join(destination, 'conversations.json.journal.jsonl'), 'utf8')
    expect(journal).toContain('"turnId":"t1"')
    expect(journal).toContain('"title":"recree"')
    expect(journal).not.toContain('conv-1')
    expect(readFileSync(join(destination, 'causal-trace', 'conv-955.jsonl'), 'utf8')).toBe(
      'trace conv-955'
    )
    expect(existsSync(join(destination, 'causal-trace', '.conv-955.sequence'))).toBe(true)
    expect(existsSync(join(destination, 'activity', 'conv-955.jsonl'))).toBe(true)
    expect(existsSync(join(destination, 'runs', 'conv-955', 'run-a', 'trace.json'))).toBe(true)
    expect(rapport.runs).toBe(1)
    expect(existsSync(join(destination, 'causal-trace', 'conv-1.jsonl'))).toBe(false)
    expect(existsSync(join(destination, 'runs', 'conv-1'))).toBe(false)
  })

  it('copie les fichiers montrés dans le fil (images lues), puis les retire', () => {
    const source = racineSource()
    ecrire(join(source, 'chat-artifacts', 'conv-955-ab12', 't1', 'capture.png'), 'png')
    ecrire(join(source, 'chat-artifacts', 'conv-9551-cd34', 't1', 'autre.png'), 'png')
    const chemin = (racine) => join(racine, 'chat-artifacts', 'conv-955-ab12', 't1', 'capture.png')
    ecrire(
      join(source, 'conversations.json.journal.jsonl'),
      ligne({
        op: 'turn-event',
        id: 'conv-955',
        turnId: 't1',
        event: { kind: 'artifact', artifact: { id: 'a1', path: chemin(source) } }
      })
    )
    const destination = join(temporaire(), 'instance')
    const rapport = semerConversation({ source, destination, id: 'conv-955' })
    expect(readFileSync(chemin(destination), 'utf8')).toBe('png')
    // Le chemin enregistré pointe la COPIE : l'instance refuse tout fichier hors de sa racine.
    const journal = readFileSync(join(destination, 'conversations.json.journal.jsonl'), 'utf8')
    expect(JSON.parse(journal.trim()).event.artifact.path).toBe(chemin(destination))
    expect(existsSync(join(destination, 'chat-artifacts', 'conv-9551-cd34'))).toBe(false)
    const { restants } = retirerSemence(destination, rapport)
    expect(restants).toEqual([])
    expect(existsSync(join(destination, 'chat-artifacts', 'conv-955-ab12'))).toBe(false)
  })

  it('ne copie JAMAIS ce qui ferait reprendre un tour ou relancer un run', () => {
    const destination = join(temporaire(), 'instance')
    semerConversation({ source: racineSource(), destination, id: 'conv-955' })
    expect(existsSync(join(destination, 'turn-journals'))).toBe(false)
    expect(existsSync(join(destination, 'run-state'))).toBe(false)
  })

  it('reprend une conversation qui ne vit plus que dans son archive', () => {
    const source = temporaire()
    ecrire(join(source, 'conversations.json'), '[]')
    ecrire(join(source, 'conversations.json.archive', 'conv-7.json'), '{"id":"conv-7"}')
    const destination = join(temporaire(), 'instance')
    const rapport = semerConversation({ source, destination, id: 'conv-7' })
    expect(rapport.ok).toBe(true)
    expect(rapport.archivee).toBe(true)
    expect(existsSync(join(destination, 'conversations.json.archive', 'conv-7.json'))).toBe(true)
  })

  it('refuse une conversation absente, sans rien écrire', () => {
    const destination = join(temporaire(), 'instance')
    const rapport = semerConversation({ source: racineSource(), destination, id: 'conv-404' })
    expect(rapport).toEqual({ ok: false, echec: 'conversation-introuvable(conv-404)' })
    expect(existsSync(destination)).toBe(false)
  })

  it('refuse un identifiant qui sortirait du dossier', () => {
    for (const id of ['../conv-955', 'a/b', '..', ''])
      expect(semerConversation({ source: racineSource(), destination: temporaire(), id }).ok).toBe(
        false
      )
  })

  it('retire toute la copie après la capture, y compris ce que l’app a pu y ajouter', () => {
    const destination = join(temporaire(), 'instance')
    const rapport = semerConversation({ source: racineSource(), destination, id: 'conv-955' })
    // Pendant la capture, l'app a ouvert un journal de tour pour cette conversation.
    ecrire(join(destination, 'turn-journals', 'conv-955', 'x.jsonl'), '{}')
    ecrire(join(destination, 'model-catalog.json'), '{}')

    const { retires, restants } = retirerSemence(destination, rapport)
    expect(restants).toEqual([])
    expect(retires).toContain(join('runs', 'conv-955'))
    for (const relatif of emplacementsDeConversation('conv-955'))
      expect(existsSync(join(destination, relatif))).toBe(false)
    // Ce qui n'appartient pas à la conversation reste en place.
    expect(existsSync(join(destination, 'model-catalog.json'))).toBe(true)
  })

  it('retire aussi les sauvegardes du stockage écrites par l’app au démarrage (vu : pre-remake)', () => {
    const destination = join(temporaire(), 'instance')
    const rapport = semerConversation({ source: racineSource(), destination, id: 'conv-955' })
    ecrire(join(destination, 'conversations.json.pre-remake'), '[{"id":"conv-955"}]')
    ecrire(join(destination, 'conversations.json.avant-archive-2026-10-15'), '[]')
    const { retires } = retirerSemence(destination, rapport)
    expect(retires).toContain('conversations.json.pre-remake')
    expect(existsSync(join(destination, 'conversations.json.pre-remake'))).toBe(false)
    expect(existsSync(join(destination, 'conversations.json.avant-archive-2026-10-15'))).toBe(false)
  })

  it('ne retire rien quand la copie n’a pas eu lieu', () => {
    expect(retirerSemence(temporaire(), { ok: false })).toEqual({ retires: [], restants: [] })
  })

  it('range la copie dans la racine de données de l’instance, comme autowin-headless.ps1', () => {
    expect(racineDonneesInstance('D:/depot', 'ui-capture-12')).toBe(
      join(
        'D:/depot',
        'Audit',
        'headless-instances',
        'ui-capture-12',
        'user-data',
        'app-data',
        'autowin-os'
      )
    )
  })

  it('lit le journal ligne à ligne, sans attribuer une ligne illisible', () => {
    expect(
      lignesDuJournal(`${ligne({ op: 'delete', id: 'conv-9' })}\n{ casse\n\n`, 'conv-9')
    ).toHaveLength(1)
  })
})

describe('--conversation — refusée hors de l’instance cachée', () => {
  it('rend l’identifiant demandé', () => {
    expect(demandeDeConversation(['--view', 'chat', '--conversation', 'conv-955'])).toEqual({
      id: 'conv-955'
    })
  })
  it('absente, ne demande rien', () => {
    expect(demandeDeConversation(['--view', 'chat'])).toBeUndefined()
  })
  it('refuse la fenêtre réelle : elle changerait la conversation de l’utilisateur', () => {
    expect(
      demandeDeConversation(['--view', 'chat', '--conversation', 'conv-955', '--fenetre-reelle'])
    ).toEqual({ echec: 'conversation-hors-instance-cachee' })
  })
  // conv-1139 : la preuve à l'écran des messages entre fils exige qu'ils voyagent avec le fil copié —
  // ceux qu'il a envoyés ou reçus, et leurs remises ; rien d'un échange entre deux AUTRES fils.
  it('copie les messages entre fils de la conversation, et les retire après la capture', () => {
    const source = racineSource()
    const msg = (id, de, a) =>
      JSON.stringify({ type: 'message', id, at: 1, de: { fil: de }, a, nature: 'info', texte: id })
    ecrire(
      join(source, 'messages-entre-fils.jsonl'),
      [
        msg('m-envoye', 'conv-955', 'conv-1'),
        msg('m-recu', 'conv-1', 'conv-955'),
        msg('m-etranger', 'conv-1', 'conv-2'),
        JSON.stringify({ type: 'livre', at: 2, fil: 'conv-1', ids: ['m-envoye'], par: 'tour' }),
        JSON.stringify({ type: 'livre', at: 2, fil: 'conv-2', ids: ['m-etranger'], par: 'tour' }),
        '{coupée'
      ].join('\n') + '\n'
    )
    const destination = join(temporaire(), 'instance')
    const rapport = semerConversation({ source, destination, id: 'conv-955' })
    expect(rapport.ecrits).toContain('messages-entre-fils.jsonl')
    const copie = readFileSync(join(destination, 'messages-entre-fils.jsonl'), 'utf8')
    expect(copie).toContain('m-envoye')
    expect(copie).toContain('m-recu')
    expect(copie).not.toContain('m-etranger')
    expect(copie.trim().split('\n')).toHaveLength(3)
    retirerSemence(destination, rapport)
    expect(existsSync(join(destination, 'messages-entre-fils.jsonl'))).toBe(false)
  })

  // conv-1150 : le tableau d'un fil chef ne s'affiche que si ses plans de lots voyagent avec lui —
  // ceux qu'il mène et ceux dont il fait un lot ; rien du plan d'un AUTRE fil.
  it('copie les plans de lots de la conversation, et les retire après la capture', () => {
    const source = racineSource()
    const plan = (id, chef, fils) => ({
      id,
      chef,
      lots: fils.map((fil, i) => ({ rang: i + 1, fil }))
    })
    ecrire(
      join(source, 'plans-de-lots.json'),
      JSON.stringify({
        version: 1,
        plans: [
          plan('p-mene', 'conv-955', ['conv-2']),
          plan('p-lot', 'conv-3', ['conv-955']),
          plan('p-etranger', 'conv-1', ['conv-4'])
        ]
      })
    )
    const destination = join(temporaire(), 'instance')
    const rapport = semerConversation({ source, destination, id: 'conv-955' })
    expect(rapport.ecrits).toContain('plans-de-lots.json')
    const copie = JSON.parse(readFileSync(join(destination, 'plans-de-lots.json'), 'utf8'))
    expect(copie.plans.map((p) => p.id)).toEqual(['p-mene', 'p-lot'])
    retirerSemence(destination, rapport)
    expect(existsSync(join(destination, 'plans-de-lots.json'))).toBe(false)
  })

  // conv-1284 (2026-10-29) : la capture du fil chef conv-1299 montrait « — » pour le coût de chaque
  // lot, alors que l'app réelle les connaît (0,19 $, 0,06 $, 0,07 $) : la copie n'emportait que les
  // fichiers de coût du chef. Les lots du plan qu'il MÈNE voyagent avec lui, et repartent après.
  it('copie les fichiers de coût des lots du plan mené, pas ceux d’un plan dont il n’est qu’un lot', () => {
    const source = racineSource()
    ecrire(
      join(source, 'plans-de-lots.json'),
      JSON.stringify({
        version: 1,
        plans: [
          { id: 'p-mene', chef: 'conv-955', lots: [{ rang: 1, fil: 'conv-2' }, { rang: 2 }] },
          {
            id: 'p-lot',
            chef: 'conv-3',
            lots: [
              { rang: 1, fil: 'conv-955' },
              { rang: 2, fil: 'conv-6' }
            ]
          }
        ]
      })
    )
    ecrire(join(source, 'activity', 'conv-2.jsonl'), '{"cout":1}\n')
    ecrire(join(source, 'prompt-observability', 'conv-2.jsonl'), '{"cout":2}\n')
    ecrire(join(source, 'prompt-observability', 'conv-6.jsonl'), '{"cout":3}\n')
    const destination = join(temporaire(), 'instance')
    const rapport = semerConversation({ source, destination, id: 'conv-955' })
    const lot = (dossier) => join(destination, dossier, 'conv-2.jsonl')
    expect(readFileSync(lot('activity'), 'utf8')).toBe('{"cout":1}\n')
    expect(readFileSync(lot('prompt-observability'), 'utf8')).toBe('{"cout":2}\n')
    expect(existsSync(join(destination, 'prompt-observability', 'conv-6.jsonl'))).toBe(false)
    retirerSemence(destination, rapport)
    expect(existsSync(lot('activity'))).toBe(false)
    expect(existsSync(lot('prompt-observability'))).toBe(false)
  })

  it('refuse un identifiant manquant ou dangereux', () => {
    expect(demandeDeConversation(['--conversation', '--view'])?.echec).toMatch(/invalide/)
    expect(demandeDeConversation(['--conversation', '../x'])?.echec).toMatch(/invalide/)
  })
})
