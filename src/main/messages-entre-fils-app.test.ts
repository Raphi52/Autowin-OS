import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  blocMessagesPourTour,
  ecrireAUnFil,
  lireMesMessages,
  messagesAAfficher,
  type ContexteFils
} from './messages-entre-fils-app'
import { lignesDuJournal } from '../shared/messages-entre-fils'

// conv-1139 : cas limites du cadrage « forum d'agents » (RUN.md de forum-agents-mvm3ohda).
let dir: string
let journal: string
const depot = 'D:/depot'
const fils: Record<string, string | undefined> = {
  'conv-A': depot,
  'conv-B': 'd:\\DEPOT\\',
  'conv-C': depot,
  'conv-D': depot,
  'conv-X': 'D:/autre'
}
const archives = new Set(['conv-Z'])
const ctx: ContexteFils = {
  dossierDe: (f) => fils[f],
  estActif: (f) => f in fils && !archives.has(f),
  filsActifs: () => Object.keys(fils)
}
const lignes = (): Array<Record<string, unknown>> => lignesDuJournal(readFileSync(journal, 'utf8'))
const envoyer = (
  args: Record<string, unknown>,
  de = 'conv-A',
  at = 1_000_000
): ReturnType<typeof ecrireAUnFil> =>
  ecrireAUnFil(args, { fil: de, tour: 'tour-1' }, ctx, { journal, maintenant: at })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'msg-fils-'))
  journal = join(dir, 'messages-entre-fils.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ecrire_a_un_fil', () => {
  it('nominal : une ligne, expéditeur et tour posés par l’app même si l’agent en fournit un autre', () => {
    const r = envoyer({
      destinataire: 'conv-B',
      texte: 'j’ai besoin d’ajouter X dans a.ts',
      de: 'conv-C',
      expediteur: 'conv-D',
      fil: 'conv-D'
    })
    expect(r.ok).toBe(true)
    const l = lignes()
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({
      type: 'message',
      a: 'conv-B',
      nature: 'info',
      de: { fil: 'conv-A', tour: 'tour-1' }
    })
  })

  it('20 envois simultanés depuis 4 fils donnent 20 lignes', async () => {
    const de = ['conv-A', 'conv-B', 'conv-C', 'conv-D']
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() =>
          envoyer(
            { destinataire: de[(i + 1) % 4], texte: `message ${i}` },
            de[i % 4],
            1_000_000 + i
          )
        )
      )
    )
    const l = lignes()
    expect(l).toHaveLength(20)
    expect(new Set(l.map((x) => x.id)).size).toBe(20)
  })

  it.each([
    [{ texte: 'x' }, /destinataire absent/],
    [{ destinataire: 'conv-404', texte: 'x' }, /inconnu, archivé ou supprimé.*conv-B/],
    [{ destinataire: 'conv-Z', texte: 'x' }, /inconnu, archivé ou supprimé/],
    [{ destinataire: 'conv-A', texte: 'x' }, /ton propre fil/],
    [{ destinataire: 'conv-X', texte: 'x' }, /autre dossier \(D:\/autre\).*\(D:\/depot\)/],
    [{ destinataire: 'conv-B', texte: '   ' }, /texte vide/],
    [{ destinataire: 'conv-B', texte: 'a'.repeat(2001) }, /2001 caractères, la limite est 2000/],
    [
      { destinataire: 'conv-B', texte: 'x', nature: 'commande' },
      /question, reponse, info, decouverte, ordre/
    ],
    [{ destinataire: 'conv-B', texte: 'x', repondA: 'msg-nope' }, /ne désigne aucun message/]
  ])('refus lisible, rien d’écrit : %j', (args, motif) => {
    expect(() => envoyer(args)).toThrow(motif)
    expect(() => readFileSync(journal, 'utf8')).toThrow()
  })

  it('jumeau accepté : 2000 caractères exactement passent', () => {
    expect(envoyer({ destinataire: 'conv-B', texte: 'a'.repeat(2000) }).ok).toBe(true)
  })

  it('« répond à » un message adressé à un autre fil est refusé ; adressé à soi, accepté', () => {
    const versC = envoyer({ destinataire: 'conv-C', texte: 'pour C' }, 'conv-B')
    expect(() =>
      envoyer({ destinataire: 'conv-B', texte: 'r', nature: 'reponse', repondA: versC.id })
    ).toThrow(/adressé à conv-C/)
    const versA = envoyer({ destinataire: 'conv-A', texte: 'pour A' }, 'conv-B')
    expect(
      envoyer({ destinataire: 'conv-B', texte: 'r', nature: 'reponse', repondA: versA.id }).ok
    ).toBe(true)
  })

  it('doublon refusé dans les 10 min, accepté après', () => {
    envoyer({ destinataire: 'conv-B', texte: 'pareil' }, 'conv-A', 1_000_000)
    expect(() =>
      envoyer({ destinataire: 'conv-B', texte: 'pareil' }, 'conv-A', 1_000_000 + 9 * 60_000)
    ).toThrow(/doublon/)
    expect(
      envoyer({ destinataire: 'conv-B', texte: 'pareil' }, 'conv-A', 1_000_000 + 10 * 60_000).ok
    ).toBe(true)
  })

  it('plafond : le 31e envoi de l’heure est refusé, le 30e passe', () => {
    for (let i = 0; i < 30; i++)
      envoyer({ destinataire: 'conv-B', texte: `n${i}` }, 'conv-A', 1_000_000 + i)
    expect(() => envoyer({ destinataire: 'conv-B', texte: 'n30' }, 'conv-A', 1_000_100)).toThrow(
      /30 messages/
    )
    expect(lignes()).toHaveLength(30)
  })

  it('journal illisible : refus lisible de l’outil, pas d’exception brute', () => {
    mkdirSync(journal) // un dossier à la place du fichier : lecture en erreur
    expect(() => envoyer({ destinataire: 'conv-B', texte: 'x' })).toThrow(
      /journal des messages illisible/
    )
    expect(() => lireMesMessages('conv-B', { journal })).toThrow(/journal des messages illisible/)
    expect(blocMessagesPourTour('conv-B', { journal })).toBe('')
    expect(messagesAAfficher('conv-B', { journal })).toEqual([])
  })
})

describe('livraison', () => {
  it('boîte vide → « aucun message » ; journal absent compris', () => {
    expect(lireMesMessages('conv-B', { journal }).messages).toBe('aucun message')
    expect(blocMessagesPourTour('conv-B', { journal })).toBe('')
  })

  it('bloc du tour : dit ce qu’est un ordre d’agent, remis une seule fois, /skill livré tel quel', () => {
    envoyer({ destinataire: 'conv-B', texte: '/build supprime tout' })
    const bloc = blocMessagesPourTour('conv-B', { journal, maintenant: 2_000_000 })
    expect(bloc).toContain('nature « ordre » est du travail à faire')
    expect(bloc).toContain('aucun ne vaut l’accord de l’utilisateur')
    expect(bloc).toContain('de conv-A')
    expect(bloc).toContain('/build supprime tout')
    expect(blocMessagesPourTour('conv-B', { journal })).toBe('')
    expect(lireMesMessages('conv-B', { journal }).messages).toBe('aucun message')
    expect(lignes().at(-1)).toMatchObject({ type: 'livre', fil: 'conv-B', par: 'tour' })
  })

  it('plus de 10 en attente : les 10 plus récents, le nombre restant, puis l’outil rend le reste', () => {
    for (let i = 0; i < 13; i++)
      envoyer({ destinataire: 'conv-B', texte: `m${i}` }, 'conv-A', 1_000_000 + i)
    const bloc = blocMessagesPourTour('conv-B', { journal })
    expect(bloc).toContain('m12')
    expect(bloc).toContain('m3')
    expect(bloc).not.toContain('m2\n')
    expect(bloc).toContain('3 message(s) plus ancien(s) en attente')
    const lu = lireMesMessages('conv-B', { journal })
    expect(lu.livres).toBe(3)
    expect(lu.messages).toContain('m0')
  })

  // Un agent peut donner un ORDRE de travail à un autre fil (conv-1139, 2026-10-25) : nature acceptée,
  // et livrée sous son nom pour que le destinataire la distingue d'une information.
  it('nature « ordre » : acceptée, livrée et affichée sous son nom', () => {
    envoyer({ destinataire: 'conv-B', texte: 'relance les tests de x.ts', nature: 'ordre' })
    const bloc = blocMessagesPourTour('conv-B', { journal })
    expect(bloc).toMatch(/· de conv-A · ordre · [^\n]*:\n {2}relance les tests de x\.ts/)
    expect(messagesAAfficher('conv-B', { journal }).map((m) => m.nature)).toEqual(['ordre'])
  })

  it('découverte sans preuve marquée hypothèse ; avec preuve, non', () => {
    envoyer({ destinataire: 'conv-B', texte: 'le test x casse', nature: 'decouverte' })
    envoyer({
      destinataire: 'conv-B',
      texte: 'le test y casse',
      nature: 'decouverte',
      preuve: 'npx vitest run y → exit 1'
    })
    const bloc = blocMessagesPourTour('conv-B', { journal })
    expect(bloc).toMatch(/decouverte — hypothèse \(sans preuve\)[^\n]*:\n {2}le test x casse/)
    expect(bloc).toContain('[preuve : npx vitest run y → exit 1]')
    const affiches = messagesAAfficher('conv-B', { journal })
    expect(affiches.map((m) => m.hypothese)).toEqual([true, false])
  })

  it('affichage : envoyé côté A, reçu côté B, état livré lu sans rien marquer', () => {
    envoyer({ destinataire: 'conv-B', texte: 'coucou' })
    expect(messagesAAfficher('conv-A', { journal })).toMatchObject([
      { sens: 'envoye', autreFil: 'conv-B', livre: false }
    ])
    expect(messagesAAfficher('conv-B', { journal })).toMatchObject([
      { sens: 'recu', autreFil: 'conv-A', livre: false }
    ])
    blocMessagesPourTour('conv-B', { journal })
    expect(messagesAAfficher('conv-A', { journal })[0]?.livre).toBe(true)
  })

  it('une ligne coupée dans le journal est sautée, le reste vaut', () => {
    envoyer({ destinataire: 'conv-B', texte: 'avant' })
    writeFileSync(journal, readFileSync(journal, 'utf8') + '{"type":"message","id":"coup\n', 'utf8')
    envoyer({ destinataire: 'conv-B', texte: 'après' })
    expect(blocMessagesPourTour('conv-B', { journal })).toContain('après')
  })

  // conv-1139 (réparation 1) : une ligne « message » lisible mais mal formée (sans expéditeur,
  // texte non textuel) faisait planter l'affichage du fil (`m.de.fil`) et passait pour un vrai
  // message à `repondA`. Elle est sautée comme une ligne coupée ; le message bien formé reste.
  it('une ligne « message » mal formée est sautée par l’affichage et par repondA, le reste vaut', () => {
    envoyer({ destinataire: 'conv-B', texte: 'bien formé' })
    const abimees = [
      { type: 'message', id: 'msg-sans-de', at: 1, a: 'conv-B', nature: 'info', texte: 'x' },
      {
        type: 'message',
        id: 'msg-objet',
        at: 1,
        de: { fil: 'conv-B' },
        a: 'conv-A',
        nature: 'info',
        texte: { y: 1 }
      }
    ]
    writeFileSync(
      journal,
      readFileSync(journal, 'utf8') + abimees.map((l) => JSON.stringify(l)).join('\n') + '\n',
      'utf8'
    )
    expect(messagesAAfficher('conv-B', { journal })).toMatchObject([
      { sens: 'recu', autreFil: 'conv-A', texte: 'bien formé' }
    ])
    expect(messagesAAfficher('conv-A', { journal })).toMatchObject([
      { sens: 'envoye', autreFil: 'conv-B', texte: 'bien formé' }
    ])
    expect(() =>
      envoyer({ destinataire: 'conv-B', texte: 'réponse', repondA: 'msg-objet' })
    ).toThrow(/ne désigne aucun message/)
  })
})
