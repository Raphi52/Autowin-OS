import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  avecAvertissementDesTests,
  avecGardeEcriture,
  gardeEcritureDuDepot,
  gardeEcritureDuLancement,
  reglagesCliAutowin
} from './claude'
import {
  FICHIER_GARDE_ECRITURE_GROK,
  FICHIER_GARDE_NPM_GROK,
  commandeCodexGardeNpm,
  installerGardeEcritureCodex,
  installerGardeEcritureGrok,
  installerGardeNpmGrok,
  verifierControlesCodex
} from './hooks-des-cli'

/*
 * LA GARDE D'ÉCRITURE HORS COPIE BRANCHÉE SUR LES TROIS OUTILS, comme la garde npm : Claude par ses
 * réglages de lancement, Grok et Codex par leurs contrôles personnels. Le script lui-même est testé
 * dans `scripts/garde-ecriture-hors-copie.test.mjs`.
 * fix-ok: rouge mesuré sur le code d'avant (8 échecs sur 10), puis passage à `avecGardeEcriture`
 * parce que claude.garde-onfailure.test.ts:223 fige l'appel de la garde npm sur une ligne.
 */
const MOD = resolve(__dirname, '..', '..', '..', 'mods', 'autowin')
const DEPOT_SCRIPTS = 'D:\\AutoWinOS\\scripts'
const NPM = `${DEPOT_SCRIPTS}\\garde-npm-modules.mjs`
const ECRITURE = `${DEPOT_SCRIPTS}\\garde-ecriture-hors-copie.mjs`
/** Un contrôle d'un autre outil, déjà là : l'installation doit le recopier tel quel. */
const GROUPE_AUTRE = {
  matcher: '',
  hooks: [{ type: 'command', command: 'echo contrôle déjà là', timeout: 15 }]
}

type Groupe = { matcher: string; hooks: Record<string, unknown>[] }
const groupes = (r: Record<string, unknown>): Groupe[] =>
  (r as { hooks: { PreToolUse: Groupe[] } }).hooks.PreToolUse

let dossier: string
beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'garde-ecriture-branchement-'))
})
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true })
})

describe('Claude — la garde d’écriture dans les réglages de lancement', () => {
  it('le script existe à côté du mod du dépôt', () => {
    const script = gardeEcritureDuDepot(MOD)
    expect(script && existsSync(script)).toBe(true)
    expect(script!.split('\\').join('/')).toMatch(/scripts\/garde-ecriture-hors-copie\.mjs$/)
    expect(gardeEcritureDuDepot(undefined)).toBeUndefined()
    expect(
      gardeEcritureDuDepot(join('X:', 'nulle-part', 'mods', 'autowin'), () => false)
    ).toBeUndefined()
  })

  it('branchée sur le groupe shell + édition, après les deux autres gardes, en échec fermé', () => {
    const [premier, autres] = groupes(
      avecGardeEcriture(
        reglagesCliAutowin('G.mjs', 'N.mjs'),
        'D:\\r\\garde-ecriture-hors-copie.mjs'
      )
    )
    expect(premier!.matcher.split('|')).toEqual(
      expect.arrayContaining([
        'Bash',
        'PowerShell',
        'Monitor',
        'Edit',
        'Write',
        'MultiEdit',
        'NotebookEdit'
      ])
    )
    expect(premier!.hooks.map((h) => h.command)).toEqual([
      'node "G.mjs"',
      'node "N.mjs"',
      'node "D:/r/garde-ecriture-hors-copie.mjs"'
    ])
    expect(premier!.hooks[2]).toMatchObject({ type: 'command', onFailure: 'block' })
    // Le groupe des lectures (détecteur de boucle seul) ne la reçoit pas.
    expect(JSON.stringify(autres)).not.toMatch(/garde-ecriture/)
  })

  it('sans garde d’écriture, les réglages restent ceux d’avant', () => {
    const sans = reglagesCliAutowin('G.mjs', 'N.mjs')
    expect(avecGardeEcriture(sans, undefined)).toBe(sans)
    expect(groupes(sans)[0]!.hooks).toHaveLength(2)
  })

  it('posée autour de l’avertissement des tests, comme dans `send` : même groupe, rien d’autre touché', () => {
    const avertis = avecAvertissementDesTests(reglagesCliAutowin('G.mjs', 'N.mjs'), 'T.mjs')
    const avec = avecGardeEcriture(avertis, 'E.mjs') as { hooks: Record<string, unknown> }
    expect(groupes(avec)[0]!.hooks.map((h) => h.command)).toEqual([
      'node "G.mjs"',
      'node "N.mjs"',
      'node "E.mjs"'
    ])
    const { PreToolUse: _avant, ...apresOutilAvant } = (
      avertis as { hooks: Record<string, unknown> }
    ).hooks
    const { PreToolUse: _apres, ...apresOutil } = avec.hooks
    expect(apresOutil).toEqual(apresOutilAvant)
  })

  it('le lancement en pose une copie dans son dossier de réglages, qui tourne seule', async () => {
    const copie = await gardeEcritureDuLancement(dossier, MOD)
    expect(copie).toBe(join(dossier, 'garde-ecriture-hors-copie.mjs'))
    // Seule dans son dossier, sans le reste de `scripts/` : elle lit son entrée et répond.
    const r = spawnSync(process.execPath, [copie!], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'x' }, cwd: dossier }),
      encoding: 'utf8'
    })
    expect({ code: r.status, sortie: r.stdout, erreur: r.stderr }).toEqual({
      code: 0,
      sortie: '',
      erreur: ''
    })
    expect(await gardeEcritureDuLancement(dossier, undefined)).toBeUndefined()
  })

  it('le tour Claude passe la copie de lancement aux réglages, à côté de la garde npm', () => {
    const source = readFileSync(join(__dirname, 'claude.ts'), 'utf8')
    expect(source).toMatch(
      /avecGardeEcriture\(\s*avecAvertissementDesTests\(\s*reglagesCliAutowin\(hookGarde, await gardeNpmDuLancement\(settingsDir, modAutowin\)\),\s*hookTests\s*\),\s*await gardeEcritureDuLancement\(settingsDir, modAutowin\)\s*\)/
    )
  })
})

describe('Grok — contrôle personnel garde-ecriture.json', () => {
  it('posé à côté de la garde npm, sur le shell et les outils qui écrivent, sans shell', () => {
    const hooks = join(dossier, 'hooks')
    installerGardeNpmGrok(hooks, NPM)
    const npmAvant = readFileSync(join(hooks, FICHIER_GARDE_NPM_GROK), 'utf8')
    expect(installerGardeEcritureGrok(hooks, ECRITURE)).toBe('cree')
    const ecrit = JSON.parse(readFileSync(join(hooks, FICHIER_GARDE_ECRITURE_GROK), 'utf8'))
    const [groupe] = ecrit.hooks.PreToolUse
    expect(groupe.matcher.split('|')).toEqual(
      expect.arrayContaining(['run_terminal_command', 'search_replace', 'write', 'Edit', 'Write'])
    )
    expect(groupe.hooks).toEqual([
      { type: 'command', command: 'node', args: [ECRITURE], timeout: 10 }
    ])
    expect(readFileSync(join(hooks, FICHIER_GARDE_NPM_GROK), 'utf8')).toBe(npmAvant)
    expect(installerGardeEcritureGrok(hooks, ECRITURE)).toBe('inchange')
    expect(readdirSync(hooks).sort()).toEqual([FICHIER_GARDE_ECRITURE_GROK, FICHIER_GARDE_NPM_GROK])
  })
})

describe('Codex — la garde d’écriture dans hooks.json, et reconnue par la vérification', () => {
  const gardeNpm = {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: commandeCodexGardeNpm(NPM), timeout: 10 }]
  }
  const ecrire = (hooks: Record<string, unknown>): string => {
    const f = join(dossier, 'hooks.json')
    writeFileSync(f, JSON.stringify({ hooks }))
    return f
  }
  // Le dossier du test est la racine d'un dépôt : la recherche de `.codex` de projet s'y arrête.
  beforeEach(() => mkdirSync(join(dossier, '.git')))

  it('ajoutée sur Bash et apply_patch, les autres contrôles recopiés, une copie d’abord', () => {
    const f = ecrire({ UserPromptSubmit: [GROUPE_AUTRE], PreToolUse: [gardeNpm] })
    const r = installerGardeEcritureCodex(f, ECRITURE, '2026-11-06T21-00-00-000Z')
    expect(r.issue).toBe('ajoute')
    expect(r.sauvegarde && existsSync(r.sauvegarde)).toBe(true)
    const apres = JSON.parse(readFileSync(f, 'utf8'))
    expect(apres.hooks.UserPromptSubmit).toEqual([GROUPE_AUTRE])
    expect(apres.hooks.PreToolUse).toEqual([
      gardeNpm,
      {
        matcher: 'Bash|apply_patch',
        hooks: [{ type: 'command', command: `node "${ECRITURE}"`, timeout: 10 }]
      }
    ])
    expect(installerGardeEcritureCodex(f, ECRITURE, 'second')).toEqual({ issue: 'inchange' })
  })

  it('la garde npm et la garde d’écriture : la relecture peut être levée', () => {
    const f = ecrire({ PreToolUse: [gardeNpm] })
    installerGardeEcritureCodex(f, ECRITURE, 'x')
    expect(verifierControlesCodex({ fichierHooks: f, script: NPM, cwd: dossier })).toEqual({
      contourner: true
    })
  })

  it('une garde d’écriture d’un autre dossier n’est pas la nôtre', () => {
    const f = ecrire({
      PreToolUse: [
        gardeNpm,
        {
          matcher: 'Bash|apply_patch',
          hooks: [
            { type: 'command', command: 'node "C:\\ailleurs\\garde-ecriture-hors-copie.mjs"' }
          ]
        }
      ]
    })
    const v = verifierControlesCodex({ fichierHooks: f, script: NPM, cwd: dossier })
    expect(v.contourner).toBe(false)
    expect(v.avertissement).toMatch(/ailleurs/)
  })

  it('la garde d’écriture seule ne suffit pas : la garde npm reste exigée', () => {
    const f = ecrire({
      PreToolUse: [
        { matcher: 'Bash|apply_patch', hooks: [{ type: 'command', command: `node "${ECRITURE}"` }] }
      ]
    })
    const v = verifierControlesCodex({ fichierHooks: f, script: NPM, cwd: dossier })
    expect(v.contourner).toBe(false)
    expect(v.avertissement).toMatch(/garde npm manque/)
  })
})
