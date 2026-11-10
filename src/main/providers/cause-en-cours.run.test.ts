import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { configureAutowinAppDataBase } from '../app/app-data'
import { signalDeCauseDuLancement } from './claude'
import { scriptHookCauseEnCours } from './cause-en-cours'

/**
 * LE SIGNAL DE CAUSE SE TIENT AU NIVEAU DU RUN, PAS DU LANCEMENT.
 *
 * Cas mesuré (run-080cb6b764d3-1, src/main/chemins-cites.test.ts) : un premier agent du run écrit son
 * `fix-ok:` dans le fichier. Un second agent du même run, lancé huit minutes plus tard, reçoit « 3
 * édits sans cause vérifiée » et pose un second jeton pour rien. Cause : le compte et le jeton vivaient
 * dans le dossier de réglages, créé à chaque lancement.
 *
 * Le banc lance le VRAI script par node, comme le CLI : un script par lancement, un état par run.
 */

const FICHIER = 'src/main/chemins-cites.test.ts'
const JETON = '// fix-ok: cause mesurée — le chemin cité perdait sa lettre de lecteur'
const dossiers: string[] = []
afterAll(() => {
  configureAutowinAppDataBase(undefined)
  for (const d of dossiers) rmSync(d, { recursive: true, force: true })
})

const dossierNeuf = (prefixe: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(d)
  return d
}

interface Run {
  depot: string
  /** Un agent lancé : son propre dossier de réglages, son propre script, l'état du run en commun. */
  lancement: (session: string) => (texte?: { old_string?: string; new_string?: string }) => string
  ecrire: (contenu: string) => void
}

function run(): Run {
  const depot = dossierNeuf('hook-cause-run-depot-')
  mkdirSync(join(depot, '.git'))
  mkdirSync(dirname(join(depot, FICHIER)), { recursive: true })
  const etat = join(dossierNeuf('hook-cause-run-etat-'), 'run-080cb6b764d3-1.json')
  return {
    depot,
    ecrire: (contenu) => writeFileSync(join(depot, FICHIER), contenu, 'utf8'),
    lancement: (session) => {
      const script = join(dossierNeuf('hook-cause-run-reglages-'), 'cause-en-cours.mjs')
      writeFileSync(script, scriptHookCauseEnCours(depot, etat), 'utf8')
      return (texte = {}) => {
        const entree = {
          hook_event_name: 'PostToolUse',
          tool_name: 'Edit',
          session_id: session,
          tool_input: {
            file_path: join(depot, FICHIER),
            old_string: texte.old_string ?? 'const a = 1',
            new_string: texte.new_string ?? 'const a = 2'
          }
        }
        return spawnSync(process.execPath, [script], {
          input: JSON.stringify(entree),
          encoding: 'utf8'
        }).stdout
      }
    }
  }
}

const contexte = (sortie: string): string =>
  (JSON.parse(sortie) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
    .additionalContext

describe('signal de cause — tenu au niveau du run', () => {
  it('chemins-cites : le jeton écrit par un premier agent vaut pour le suivant du même run', () => {
    const { lancement, ecrire } = run()
    const premier = lancement('e2dd8f5a')
    expect(premier({ new_string: `${JETON}\nconst a = 2` })).toBe('')
    ecrire(`${JETON}\nconst a = 2\n`)

    const second = lancement('972bf003')
    for (let i = 0; i < 4; i++) expect(second()).toBe('')
  })

  it('le compte ne repart pas à zéro : 2 modifications puis 1 dans un autre lancement = 3', () => {
    const { lancement, ecrire } = run()
    ecrire('const a = 2\n')
    const premier = lancement('e2dd8f5a')
    expect(premier()).toBe('')
    expect(premier()).toBe('')
    expect(contexte(lancement('972bf003')())).toContain(`3 édits de ${FICHIER}`)
  })

  it('un jeton dont la ligne a quitté le fichier ne compte plus', () => {
    const { lancement, ecrire } = run()
    const premier = lancement('e2dd8f5a')
    expect(premier({ new_string: `${JETON}\nconst a = 2` })).toBe('')
    expect(premier()).toBe('')
    // La ligne du jeton est retirée du fichier (réécriture, retour arrière).
    ecrire('const a = 2\n')
    expect(contexte(lancement('972bf003')())).toContain(`3 édits de ${FICHIER}`)
  })

  it('un jeton écrit au milieu d’une ligne est retrouvé dans le fichier', () => {
    const { lancement, ecrire } = run()
    const premier = lancement('e2dd8f5a')
    expect(premier({ new_string: 'const a = 2 // check: lu dans la trace' })).toBe('')
    ecrire('    const a = 2 // check: lu dans la trace\r\n')
    const second = lancement('972bf003')
    for (let i = 0; i < 3; i++) expect(second()).toBe('')
  })

  it('une session reprise ne relit pas son avertissement ; un agent neuf le reçoit une fois', () => {
    const { lancement, ecrire } = run()
    ecrire('const a = 2\n')
    const premier = lancement('e2dd8f5a')
    premier()
    premier()
    expect(premier()).not.toBe('')
    // Même session, relancée (réparation) : elle porte déjà l'avertissement.
    expect(lancement('e2dd8f5a')()).toBe('')
    // Autre agent du run : il ne l'a jamais lu.
    const neuf = lancement('972bf003')
    expect(contexte(neuf())).toContain(`5 édits de ${FICHIER}`)
    expect(neuf()).toBe('')
  })
})

describe('signalDeCauseDuLancement — où vit l’état', () => {
  it('deux lancements du même run partagent un état, hors de leurs dossiers de réglages', async () => {
    const donnees = dossierNeuf('hook-cause-run-donnees-')
    configureAutowinAppDataBase(donnees)
    const depot = dossierNeuf('hook-cause-run-depot-')
    mkdirSync(join(depot, '.git'))
    const execution = {
      cwd: depot,
      sandbox: 'workspace-write' as const,
      agentEnv: { AUTOWIN_HDESK_ID: 'run-080cb6b764d3-1' }
    }
    const entree = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(depot, 'src', 'x.ts'), old_string: 'a', new_string: 'b' }
    })
    const sorties: string[] = []
    for (let i = 0; i < 3; i++) {
      const reglages = dossierNeuf('hook-cause-run-reglages-')
      const script = (await signalDeCauseDuLancement(reglages, execution)) as string
      sorties.push(
        spawnSync(process.execPath, [script], { input: entree, encoding: 'utf8' }).stdout
      )
      expect(existsSync(join(reglages, 'cause-en-cours.json'))).toBe(false)
    }
    expect(sorties.slice(0, 2)).toEqual(['', ''])
    expect(contexte(sorties[2])).toContain('3 édits de src/x.ts')
    const rangs = readdirSync(donnees, { recursive: true }).map(String)
    expect(
      rangs.some((r) => r.replace(/\\/g, '/').endsWith('cause-en-cours/run-080cb6b764d3-1.json'))
    ).toBe(true)
  })
})
