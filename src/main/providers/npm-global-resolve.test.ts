import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { findNpmGlobalFile, npmPrefixCandidates } from './npm-global-resolve'
import { CODEX_PACKAGE_ENTRY, codexExecSpec } from './codex'
import { KIMI_PACKAGE_ENTRY, resolveKimiCommand } from './kimi'

/**
 * RÉSOLUTION PARTAGÉE des CLI installés par `npm -g`.
 *
 * Les trois adaptateurs connaissaient chacun UN chemin en dur sous `%APPDATA%\npm`. Hors de ce cas :
 * `spawn claude ENOENT` (repli mort, REPRODUIT le 2026-07-29) ou « Codex CLI introuvable » — l'échec
 * exact du fan-out scout observé le même jour, alors que le CLI était installé.
 *
 * `shell: true` n'est pas une option : les trois spawnent en `shell: false`, ce qui interdit d'exécuter
 * un shim `.cmd` et garantit l'absence d'injection d'arguments. On résout donc le VRAI fichier.
 */
describe('npmPrefixCandidates — ordre stable, sans doublon', () => {
  it('le dossier npm de %APPDATA% passe AVANT le PATH', () => {
    const candidates = npmPrefixCandidates({
      APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
      PATH: 'C:\\windows;D:\\npm'
    })
    expect(candidates[0]).toBe(join('C:\\Users\\x\\AppData\\Roaming', 'npm'))
    expect(candidates).toContain('D:\\npm')
  })

  it('un dossier répété n’est proposé qu’une fois', () => {
    const candidates = npmPrefixCandidates({ PATH: 'D:\\npm;D:\\npm;  D:\\npm  ' })
    expect(candidates.filter((c) => c === 'D:\\npm')).toHaveLength(1)
  })

  it('guillemets nettoyés, entrées vides ignorées, `Path` accepté', () => {
    expect(npmPrefixCandidates({ PATH: '"D:\\mes outils";;' })).toEqual(['D:\\mes outils'])
    expect(npmPrefixCandidates({ Path: 'D:\\alt' })).toEqual(['D:\\alt'])
    expect(npmPrefixCandidates({})).toEqual([])
  })

  /**
   * SÉCURITÉ — le PATH est HÉRITÉ (un CLI enfant, un script, ont pu le modifier) et le fichier élu
   * sous ces préfixes est spawné AVEC le prompt système et la conversation. Toute entrée dont le
   * contenu ne dépend pas du seul utilisateur est donc écartée avant même de regarder les fichiers.
   */
  it('une entrée NON ABSOLUE est refusée (`.`, `bin`, un %VAR% non expansé)', () => {
    expect(npmPrefixCandidates({ PATH: '.;bin;..\\outils;%NPM_HOME%\\bin' })).toEqual([])
  })

  it('une RACINE de volume est refusée (créer un fichier y est ouvert par défaut)', () => {
    expect(npmPrefixCandidates({ PATH: 'C:\\;D:\\;C:\\ok' })).toEqual(['C:\\ok'])
  })

  it('le cwd et %TEMP% (et leurs sous-dossiers) sont refusés', () => {
    const temp = 'C:\\Users\\x\\AppData\\Local\\Temp'
    expect(
      npmPrefixCandidates({ TEMP: temp, PATH: `${temp};${temp}\\npm-x;D:\\ok` })
    ).toEqual(['D:\\ok'])
    expect(npmPrefixCandidates({ PATH: `${process.cwd()};D:\\ok` })).toEqual(['D:\\ok'])
  })
})

describe('findNpmGlobalFile — le paquet est trouvé où qu’il soit installé', () => {
  const rel = join('node_modules', '@scope', 'pkg', 'bin', 'cli.js')

  it('sous le préfixe par défaut', () => {
    const target = join('C:\\AppData', 'npm', rel)
    expect(
      findNpmGlobalFile(rel, { env: { APPDATA: 'C:\\AppData' }, exists: (p) => p === target })
    ).toBe(target)
  })

  it('LE CAS RÉEL : préfixe npm ailleurs, trouvé via le PATH', () => {
    const target = join('D:\\npm-global', rel)
    expect(
      findNpmGlobalFile(rel, {
        env: { APPDATA: 'C:\\vide', PATH: 'C:\\windows;D:\\npm-global' },
        exists: (p) => p === target
      })
    ).toBe(target)
  })

  it('un exécutable posé À PLAT gagne sur le paquet, dans le MÊME dossier', () => {
    const dir = 'D:\\outils'
    const direct = join(dir, 'cli.exe')
    expect(
      findNpmGlobalFile(rel, {
        env: { PATH: dir },
        // `node_modules/` present : c'est bien un prefixe npm, l'exe a plat est legitime.
        exists: (p) => [direct, join(dir, 'node_modules'), join(dir, rel)].includes(p),
        directNames: ['cli.exe']
      })
    ).toBe(direct)
  })

  /**
   * RÉÉCRIT/AJOUTÉ (audit adverse) : élire n'importe quel exécutable posé à plat dans une entrée du
   * PATH offrait l'exécution — avec le prompt système et la conversation — à quiconque écrit dans un
   * dossier du PATH. Un exe à plat n'est légitime que dans un vrai préfixe `npm -g`, reconnaissable
   * à son `node_modules/`.
   */
  it('un exe SEUL dans un dossier sans node_modules n’est PAS élu', () => {
    const direct = 'C:\\tools\\cli.exe'
    expect(
      findNpmGlobalFile(rel, {
        env: { PATH: 'C:\\tools' },
        exists: (p) => p === direct,
        directNames: ['cli.exe']
      })
    ).toBeUndefined()
  })

  it('rien trouvé → undefined (l’appelant décide quoi dire)', () => {
    expect(findNpmGlobalFile(rel, { env: { PATH: 'D:\\rien' }, exists: () => false })).toBeUndefined()
  })

  it('un dossier ILLISIBLE n’interrompt pas la recherche', () => {
    const target = join('D:\\bon', rel)
    expect(
      findNpmGlobalFile(rel, {
        env: { PATH: 'Z:\\interdit;D:\\bon' },
        exists: (p) => {
          if (p.startsWith('Z:')) throw new Error('accès refusé')
          return p === target
        }
      })
    ).toBe(target)
  })
})

describe('codex — le fan-out scout ne doit plus échouer sur un préfixe npm différent', () => {
  const spec = (appData: string | undefined, exists: (p: string) => boolean): string[] =>
    codexExecSpec('C:\\repo', 'gpt-5.6-terra', 'read-only', undefined, appData, exists).args

  it('trouve l’entrypoint sous le préfixe par défaut (comportement historique)', () => {
    const target = join('C:\\AppData', 'npm', CODEX_PACKAGE_ENTRY)
    expect(spec('C:\\AppData', (p) => p === target)[0]).toBe(target)
  })

  it('LE CAS OBSERVÉ : %APPDATA% ne l’a pas, le PATH oui → plus d’échec', () => {
    const viaPath = join(process.env.PATH?.split(';')[0] ?? 'C:\\windows', CODEX_PACKAGE_ENTRY)
    const args = spec('C:\\Vide', (p) => p === viaPath)
    expect(args[0]).toBe(viaPath)
  })

  it('vraiment introuvable → l’erreur DIT où on a cherché et l’échappatoire', () => {
    let message = ''
    try {
      spec('C:\\Vide', () => false)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('Codex CLI introuvable')
    expect(message).toContain('PATH')
    expect(message).toContain('CODEX_BIN')
  })
})

describe('kimi — même correction, même repli mort évité', () => {
  it('le sous-chemin du paquet est celui du CLI officiel', () => {
    expect(KIMI_PACKAGE_ENTRY).toBe(
      join('node_modules', '@moonshot-ai', 'kimi-code', 'dist', 'main.mjs')
    )
  })

  it('KIMI_BIN explicite gagne, et un shim .cmd est REFUSÉ', () => {
    expect(resolveKimiCommand('C:\\perso\\kimi.exe', {})).toEqual({
      executable: 'C:\\perso\\kimi.exe',
      prefix: []
    })
    expect(() => resolveKimiCommand('C:\\npm\\kimi.cmd', {})).toThrow(/shim/)
  })

  it('sans rien de trouvé, le repli reste `kimi` — et il est SANS préfixe', () => {
    expect(resolveKimiCommand(undefined, { PATH: 'Z:\\rien', APPDATA: 'Z:\\rien' })).toEqual({
      executable: 'kimi',
      prefix: []
    })
  })
})

/**
 * GARDES RÉELLES sur cette machine : si une de ces résolutions rend le nom nu, le spawn `shell: false`
 * échouera en ENOENT — c'est le défaut d'origine, pas une hypothèse.
 */
describe('sur CETTE machine, les CLI se résolvent en chemins réels', () => {
  it('codex : un entrypoint .js existant, jamais un nom nu', () => {
    if (process.platform !== 'win32' || process.env.CODEX_BIN) return
    const args = codexExecSpec('C:\\repo', 'gpt-5.6-terra', 'read-only').args
    expect(args[0].toLowerCase().endsWith('codex.js')).toBe(true)
  })

  it('kimi : soit l’entrypoint .mjs via node, soit le repli ASSUMÉ', () => {
    if (process.platform !== 'win32' || process.env.KIMI_BIN) return
    const command = resolveKimiCommand()
    // Kimi peut legitimement ne PAS etre installe : on exige alors le repli explicite. Ce qui est
    // interdit, c'est un prefixe non vide pointant nulle part.
    if (command.executable === 'kimi') expect(command.prefix).toEqual([])
    else expect(command.prefix[0].toLowerCase().endsWith('main.mjs')).toBe(true)
  })
})
