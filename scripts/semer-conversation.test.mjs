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
  it('refuse un identifiant manquant ou dangereux', () => {
    expect(demandeDeConversation(['--conversation', '--view'])?.echec).toMatch(/invalide/)
    expect(demandeDeConversation(['--conversation', '../x'])?.echec).toMatch(/invalide/)
  })
})
