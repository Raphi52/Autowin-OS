import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CAP_MURS_PAR_CONVERSATION, chargerMurs, enregistrerMur, mursStorePath, oublierMurs } from './murs-store'
import { relireFichier } from '../gel/ecriture-hors-fil'

let base = ''
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'murs-'))
  return () => rmSync(base, { recursive: true, force: true })
})

describe('registre des murs — un mur du tour 1 doit être connu au tour 5', () => {
  it('un mur enregistré est relu, conversation par conversation', () => {
    enregistrerMur('conv-A', 'edit_file::enoent', base)
    enregistrerMur('conv-B', 'run_tests::rouge', base)
    expect(chargerMurs('conv-A', base)).toEqual(['edit_file::enoent'])
    // L'isolation par conversation est LE point : un mur de conv-B ne doit pas escalader conv-A.
    expect(chargerMurs('conv-B', base)).toEqual(['run_tests::rouge'])
  })

  it('une conversation inconnue rend une liste vide, pas une erreur', () => {
    expect(chargerMurs('jamais-vue', base)).toEqual([])
  })

  it('le même mur enregistré deux fois n’apparaît qu’une fois', () => {
    enregistrerMur('conv-A', 'edit_file::enoent', base)
    enregistrerMur('conv-A', 'edit_file::enoent', base)
    expect(chargerMurs('conv-A', base)).toEqual(['edit_file::enoent'])
  })

  it('le registre est BORNÉ : au-delà du cap, les murs les plus anciens tombent', () => {
    for (let i = 0; i < CAP_MURS_PAR_CONVERSATION + 5; i++) enregistrerMur('conv-A', `mur-${i}`, base)
    const murs = chargerMurs('conv-A', base)
    expect(murs.length).toBe(CAP_MURS_PAR_CONVERSATION)
    // Les plus RÉCENTS survivent : un mur qu'on vient de rencontrer compte plus qu'un mur ancien.
    expect(murs).toContain(`mur-${CAP_MURS_PAR_CONVERSATION + 4}`)
    expect(murs).not.toContain('mur-0')
  })

  it('FAIL-OPEN : un fichier corrompu vaut « aucun mur connu », jamais une exception', () => {
    // C'est un CACHE, pas une autorité : oublier un mur coûte une reprise de plus, jamais un faux.
    writeFileSync(mursStorePath(base), '{ ceci n est pas du json', 'utf8')
    expect(chargerMurs('conv-A', base)).toEqual([])
  })

  it('oublier une conversation efface ses murs sans toucher aux autres', () => {
    enregistrerMur('conv-A', 'a', base)
    enregistrerMur('conv-B', 'b', base)
    oublierMurs('conv-A', base)
    expect(chargerMurs('conv-A', base)).toEqual([])
    expect(chargerMurs('conv-B', base)).toEqual(['b'])
  })

  it('oublier une conversation inconnue n’est pas une erreur', () => {
    expect(() => oublierMurs('jamais-vue', base)).not.toThrow()
  })
})

/**
 * Un mur dont la cause est corrigée continuait d'être compté sans fin : rien ne disait QUAND il avait
 * été vu la dernière fois. Chaque entrée porte donc la date de sa dernière occurrence, et l'ancien
 * format (une signature seule) se relit toujours.
 */
describe('registre des murs — date de la dernière occurrence', () => {
  const T1 = new Date('2026-11-01T08:00:00.000Z')
  const T2 = new Date('2026-11-13T09:30:00.000Z')
  const brut = (): Record<string, unknown> =>
    JSON.parse(relireFichier(mursStorePath(base)) ?? '{}') as Record<string, unknown>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    return () => vi.useRealTimers()
  })

  it('un mur enregistré porte la date de sa rencontre', () => {
    vi.setSystemTime(T1)
    enregistrerMur('conv-A', 'edit_file::enoent', base)
    expect(brut()).toEqual({
      'conv-A': [{ signature: 'edit_file::enoent', derniereFois: T1.toISOString() }]
    })
  })

  it('le même mur revu avance sa date, sans créer de doublon', () => {
    vi.setSystemTime(T1)
    enregistrerMur('conv-A', 'edit_file::enoent', base)
    vi.setSystemTime(T2)
    enregistrerMur('conv-A', 'edit_file::enoent', base)
    expect(brut()).toEqual({
      'conv-A': [{ signature: 'edit_file::enoent', derniereFois: T2.toISOString() }]
    })
    expect(chargerMurs('conv-A', base)).toEqual(['edit_file::enoent'])
  })

  it('un mur revu passe en dernier : le plafond garde les plus récemment VUS', () => {
    for (let i = 0; i < CAP_MURS_PAR_CONVERSATION; i++) enregistrerMur('conv-A', `mur-${i}`, base)
    enregistrerMur('conv-A', 'mur-0', base)
    enregistrerMur('conv-A', 'nouveau', base)
    const murs = chargerMurs('conv-A', base)
    expect(murs).toContain('mur-0')
    expect(murs).not.toContain('mur-1')
    expect(murs.at(-1)).toBe('nouveau')
  })

  it('l’ancien format (signatures sans date) se relit tel quel, et n’est jamais daté après coup', () => {
    writeFileSync(
      mursStorePath(base),
      JSON.stringify({ 'conv-A': ['ancien::mur'], 'conv-B': ['autre::mur'] }),
      'utf8'
    )
    expect(chargerMurs('conv-A', base)).toEqual(['ancien::mur'])
    vi.setSystemTime(T2)
    enregistrerMur('conv-A', 'neuf::mur', base)
    expect(chargerMurs('conv-A', base)).toEqual(['ancien::mur', 'neuf::mur'])
    expect(brut()).toEqual({
      'conv-A': ['ancien::mur', { signature: 'neuf::mur', derniereFois: T2.toISOString() }],
      'conv-B': ['autre::mur']
    })
  })

  it('un ancien mur revu prend sa première date', () => {
    writeFileSync(mursStorePath(base), JSON.stringify({ 'conv-A': ['ancien::mur'] }), 'utf8')
    vi.setSystemTime(T2)
    enregistrerMur('conv-A', 'ancien::mur', base)
    expect(brut()).toEqual({
      'conv-A': [{ signature: 'ancien::mur', derniereFois: T2.toISOString() }]
    })
  })

  it('une date illisible rend l’index douteux : FAIL-OPEN, comme un JSON corrompu', () => {
    writeFileSync(
      mursStorePath(base),
      JSON.stringify({ 'conv-A': [{ signature: 'mur', derniereFois: 'hier' }] }),
      'utf8'
    )
    expect(chargerMurs('conv-A', base)).toEqual([])
  })
})
