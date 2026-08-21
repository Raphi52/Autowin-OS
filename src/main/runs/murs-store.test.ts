import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CAP_MURS_PAR_CONVERSATION, chargerMurs, enregistrerMur, mursStorePath, oublierMurs } from './murs-store'

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
