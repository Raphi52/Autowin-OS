import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleDuJournal,
  creerIdentitesEnCache,
  creerJournalDesBesoins,
  demandeDuTour,
  identiteGitDuDossier,
  lireLeJournal,
  type EvenementDuJournal,
  type ExecGit
} from './journal-des-besoins'

const dossiers: string[] = []
afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
})
function dossierTemporaire(): string {
  const dossier = mkdtempSync(join(tmpdir(), 'besoins-'))
  dossiers.push(dossier)
  return dossier
}

describe('identité git de qui a prompté', () => {
  it('lit nom et email en un appel ; la valeur locale (listée en dernier) l’emporte', async () => {
    const exec = vi.fn<ExecGit>(
      async () =>
        'user.name Profil Global\nuser.email global@exemple.test\nuser.name Personne Du Depot\n'
    )
    const identite = await identiteGitDuDossier('D:/depot', exec, () => true)
    expect(identite).toEqual({ nom: 'Personne Du Depot', email: 'global@exemple.test' })
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0]).toEqual(['config', '--get-regexp', '^user\\.(name|email)$'])
    expect(exec.mock.calls[0][1]).toBe('D:/depot')
  })

  it('un dossier disparu lit la config GLOBALE, pas celle du dépôt courant', async () => {
    const exec = vi.fn<ExecGit>(async () => 'user.email seul@exemple.test\n')
    const identite = await identiteGitDuDossier('D:/disparu', exec, () => false)
    expect(exec.mock.calls[0][0]).toContain('--global')
    // Sans nom, l'email sert de nom : la carte doit pouvoir afficher quelqu'un.
    expect(identite).toEqual({ nom: 'seul@exemple.test', email: 'seul@exemple.test' })
  })

  it('git absent ou sans identité : null, jamais une exception', async () => {
    const echec: ExecGit = async () => {
      throw new Error('spawn git ENOENT')
    }
    expect(await identiteGitDuDossier('D:/depot', echec, () => true)).toBeNull()
    expect(
      await identiteGitDuDossier(
        'D:/depot',
        async () => '',
        () => true
      )
    ).toBeNull()
  })

  it('le cache évite un git par tour, puis se renouvelle', async () => {
    let instant = 0
    const lire = vi.fn(async () => ({ nom: 'A' }))
    const identite = creerIdentitesEnCache(lire, () => instant, 1_000)
    await identite('D:/x')
    await identite('D:/x')
    expect(lire).toHaveBeenCalledTimes(1)
    instant = 2_000
    await identite('D:/x')
    expect(lire).toHaveBeenCalledTimes(2)
  })

  it('pour le Board, une valeur expirée est rendue TOUT DE SUITE et relue en fond (conv-1248)', async () => {
    let instant = 0
    let suivante: (valeur: { nom: string }) => void = () => {}
    const lire = vi
      .fn<(dossier: string | undefined) => Promise<{ nom: string } | null>>()
      .mockResolvedValueOnce({ nom: 'A' })
      .mockImplementationOnce(() => new Promise((resolve) => (suivante = resolve)))
    const identite = creerIdentitesEnCache(lire, () => instant, 1_000, true)
    expect(await identite('D:/x')).toEqual({ nom: 'A' })
    instant = 2_000
    // Le `git config` de la relecture n'a pas répondu : l'ancienne valeur, sans l'attendre.
    expect(await identite('D:/x')).toEqual({ nom: 'A' })
    expect(lire).toHaveBeenCalledTimes(2)
    suivante({ nom: 'B' })
    expect(await identite('D:/x')).toEqual({ nom: 'B' })
    expect(lire).toHaveBeenCalledTimes(2)
  })
})

describe('le message qui porte le tour', () => {
  const fil = [
    { role: 'user', messageId: 'm1', ts: 10 },
    { role: 'assistant', messageId: 'm2', parentMessageId: 'm1', turnId: 't1' },
    { role: 'user', messageId: 'm3', parentMessageId: 'm2', orientation: true },
    { role: 'assistant', messageId: 'm4', parentMessageId: 'm3', turnId: 't2' }
  ]

  it('remonte de la réponse à la demande', () => {
    expect(demandeDuTour(fil, 't1')).toEqual({ messageId: 'm1', ts: 10 })
  })

  it('saute une consigne glissée pendant le tour et retombe sur la demande', () => {
    expect(demandeDuTour(fil, 't2')).toEqual({ messageId: 'm1', ts: 10 })
  })

  it('tour inconnu : null', () => {
    expect(demandeDuTour(fil, 'absent')).toBeNull()
  })
})

describe('le journal besoins.jsonl', () => {
  it('écrit une ligne par tour : demandeur git, date, fil, message, ligne de besoin', async () => {
    const racine = dossierTemporaire()
    const journal = creerJournalDesBesoins({
      racine,
      identite: async () => ({ nom: 'Personne', email: 'p@exemple.test' }),
      maintenant: () => 99
    })
    const evenement = await journal.noterTour({
      conversationId: 'conv-7',
      turnId: 't1',
      messages: [
        { role: 'user', messageId: 'm1', ts: 50 },
        { role: 'assistant', messageId: 'm2', parentMessageId: 'm1', turnId: 't1' }
      ],
      dossier: 'D:/depot',
      texteReponse: 'Fait.\nAUTOWIN_BESOIN_V1: suite conv-3'
    })
    const attendu: EvenementDuJournal = {
      v: 1,
      ts: 99,
      conversationId: 'conv-7',
      messageId: 'm1',
      demandeLe: 50,
      turnId: 't1',
      demandeur: { nom: 'Personne', email: 'p@exemple.test', dossier: 'D:/depot' },
      besoin: { nature: 'suite', de: 'conv-3' }
    }
    expect(evenement).toEqual(attendu)
    expect(JSON.parse(readFileSync(journal.chemin, 'utf8').trim())).toEqual(attendu)
    expect(journal.lire().get(cleDuJournal('conv-7', 'm1'))).toEqual({
      demandeur: attendu.demandeur,
      besoin: attendu.besoin,
      demandeLe: 50
    })
  })

  it('un tour sans demande retrouvable n’écrit rien', async () => {
    const journal = creerJournalDesBesoins({
      racine: dossierTemporaire(),
      identite: async () => null
    })
    const rien = await journal.noterTour({
      conversationId: 'conv-1',
      turnId: 't9',
      messages: [],
      dossier: undefined,
      texteReponse: 'AUTOWIN_BESOIN_V1: nouveau'
    })
    expect(rien).toBeNull()
    expect(journal.lire().size).toBe(0)
  })

  it('fusionne une reprise : premier demandeur relevé, dernière ligne de besoin lisible', () => {
    const ligne = (e: Partial<EvenementDuJournal>): string =>
      JSON.stringify({ v: 1, ts: 1, conversationId: 'c', messageId: 'm', ...e })
    const texte = [
      ligne({ demandeur: { nom: 'Premier', dossier: 'D:/a' }, besoin: { nature: 'nouveau' } }),
      '{ligne coupée',
      ligne({ demandeur: { nom: 'Second', dossier: 'D:/a' }, besoin: null }),
      ligne({ demandeur: null, besoin: { nature: 'suite' } })
    ].join('\n')
    expect(lireLeJournal(texte).get(cleDuJournal('c', 'm'))).toEqual({
      demandeur: { nom: 'Premier', dossier: 'D:/a' },
      besoin: { nature: 'suite' }
    })
  })
})
