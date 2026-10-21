import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cibleDuBanc, journalDeLInstance } from './banc-gel-cible.mjs'

/** Une racine d'instances cachées avec UNE instance qui tient `port`. */
function instances(port) {
  const racine = mkdtempSync(join(tmpdir(), 'banc-gel-instances-'))
  const userData = join(racine, 'preuve-1', 'user-data')
  mkdirSync(userData, { recursive: true })
  // PowerShell (ConvertTo-Json) peut écrire une marque d'ordre d'octets : elle doit être tolérée.
  writeFileSync(
    join(racine, 'preuve-1', 'instance.json'),
    `${String.fromCharCode(0xfeff)}${JSON.stringify({ port, userData })}`
  )
  return { racine, journal: join(userData, 'app-data', 'autowin-os', 'gels.jsonl') }
}

const APP = {
  devToolsPort: join(tmpdir(), 'pas-de-port', 'DevToolsActivePort'),
  journalApp: 'JOURNAL-DE-L-UTILISATEUR'
}

describe('cibleDuBanc — jamais l app ouverte de l utilisateur par défaut', () => {
  it('sans port ni demande explicite : REFUS, avec la commande sûre à lancer', () => {
    const r = cibleDuBanc({ argv: ['node', 'banc-gel.mjs', 'knowledge'], env: {}, ...APP })
    expect(r.refus).toContain('avec-instance-headless.mjs')
    expect(r.port).toBeUndefined()
  })

  it('le --port posé par avec-instance-headless vise l instance cachée ET lit SON journal', () => {
    const { racine, journal } = instances(9311)
    const r = cibleDuBanc({
      argv: ['node', 'banc-gel.mjs', 'knowledge', '--port', '9311'],
      env: {},
      racineInstances: racine,
      ...APP
    })
    expect(r).toEqual({ port: 9311, origine: 'argument', journal })
  })

  it('AUTOWIN_CDP_PORT vaut cible ; un --journal explicite passe devant la recherche', () => {
    const r = cibleDuBanc({
      argv: ['node', 'banc-gel.mjs', '--journal', 'J.jsonl'],
      env: { AUTOWIN_CDP_PORT: '9400' },
      racineInstances: join(tmpdir(), 'aucune-instance'),
      ...APP
    })
    expect(r).toEqual({ port: 9400, origine: 'environnement', journal: 'J.jsonl' })
  })

  it('un port qu aucune instance cachée ne tient : journal inconnu, jamais celui de l utilisateur', () => {
    const { racine } = instances(9311)
    const r = cibleDuBanc({
      argv: ['node', 'b', '--port', '9999'],
      env: {},
      racineInstances: racine,
      ...APP
    })
    expect(r.journal).toBeUndefined()
  })

  it('--app-ouverte : le geste assumé lit le port et le journal de l app ouverte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'banc-gel-app-'))
    writeFileSync(join(dir, 'DevToolsActivePort'), '9223\n/devtools/browser/x')
    const r = cibleDuBanc({
      argv: ['node', 'b', 'knowledge', '--app-ouverte'],
      env: {},
      devToolsPort: join(dir, 'DevToolsActivePort'),
      journalApp: 'JOURNAL-DE-L-UTILISATEUR'
    })
    expect(r).toEqual({ port: 9223, origine: 'app-ouverte', journal: 'JOURNAL-DE-L-UTILISATEUR' })
  })

  it('journalDeLInstance rend undefined sur une racine absente', () => {
    expect(journalDeLInstance(9311, join(tmpdir(), 'nulle-part-banc'))).toBeUndefined()
  })
})
