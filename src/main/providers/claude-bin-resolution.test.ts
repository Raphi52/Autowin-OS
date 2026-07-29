import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { findClaudeExecutable, resolveClaudeBin } from './claude'

/**
 * RÉSOLUTION DU BINAIRE `claude` — le repli était mort sur Windows.
 *
 * REPRODUIT le 2026-07-29 : sur cette machine le PATH n'expose QUE des shims (`claude.cmd`,
 * `claude.ps1`, `claude` sans extension). Le repli `spawn('claude', …, { shell: false })` échoue en
 * `spawn claude ENOENT` — CreateProcess n'ajoute que `.exe` et n'exécute pas un `.cmd`. Le résolveur
 * ne connaissait qu'UN chemin en dur (`%APPDATA%\npm\…`) : tout poste dont le préfixe npm diffère
 * (npm prefix configuré, pnpm, volta, install machine) tombait dans ce repli mort.
 *
 * `shell: true` est EXCLU comme correctif : `shell: false` est ce qui garantit l'absence d'injection
 * d'arguments et un `--system-prompt` à espaces/accents intact. On résout donc le VRAI `.exe`.
 */
const PKG = join('node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')

const lookup = (
  present: readonly string[],
  env: NodeJS.ProcessEnv
): string | undefined =>
  findClaudeExecutable({
    platform: 'win32',
    env,
    exists: (p) => present.includes(p)
  })

describe('findClaudeExecutable — trouver le vrai .exe, pas un shim', () => {
  it('préfixe npm par défaut (%APPDATA%\\npm) : comportement historique préservé', () => {
    const appdata = 'C:\\Users\\x\\AppData\\Roaming'
    const target = join(appdata, 'npm', PKG)
    expect(lookup([target], { APPDATA: appdata })).toBe(target)
  })

  it('LE CAS REPRODUIT : préfixe npm AILLEURS, trouvé via le PATH', () => {
    const prefix = 'D:\\outils\\npm-global'
    const target = join(prefix, PKG)
    expect(
      lookup([target], { APPDATA: 'C:\\ailleurs', PATH: `C:\\windows;${prefix};C:\\autre` })
    ).toBe(target)
  })

  /**
   * RÉÉCRIT (audit adverse) : la version précédente exigeait qu'un `claude.exe` posé à plat dans
   * N'IMPORTE QUEL dossier du PATH soit élu. Elle figeait le défaut — ce chemin est spawné avec le
   * prompt système et la conversation, donc quiconque écrit dans un dossier du PATH (`C:\tools`, un
   * partage réseau d'entreprise) se faisait livrer tous les prompts. Le contrat corrigé : un exe à
   * plat n'est élu que si le dossier est vraiment un préfixe npm (il porte un `node_modules/`).
   */
  it('un claude.exe à plat gagne sur le paquet — mais SEULEMENT dans un vrai préfixe npm', () => {
    const dir = 'C:\\outils'
    const exe = join(dir, 'claude.exe')
    expect(lookup([exe, join(dir, 'node_modules'), join(dir, PKG)], { PATH: dir })).toBe(exe)
  })

  it('DÉTOURNEMENT : un claude.exe seul dans un dossier du PATH n’est PAS élu', () => {
    // `C:\tools` écrivable par un tiers, aucun node_modules : ce n'est pas une install npm.
    const exe = 'C:\\tools\\claude.exe'
    expect(lookup([exe], { PATH: 'C:\\tools' })).toBeUndefined()
  })

  it('DÉTOURNEMENT : une entrée `.` dans le PATH ne rend RIEN (cwd = dépôt cloné)', () => {
    // `join('.', 'claude.exe')` s'évaluerait depuis le cwd du process : un dépôt cloné suffirait.
    expect(lookup(['claude.exe', join('.', 'claude.exe'), 'node_modules'], { PATH: '.' })).toBeUndefined()
    expect(lookup([join('bin', 'claude.exe'), join('bin', PKG)], { PATH: 'bin' })).toBeUndefined()
  })

  it('DÉTOURNEMENT : la racine d’un volume n’est pas un préfixe (ACL laxistes par défaut)', () => {
    expect(
      lookup(['C:\\claude.exe', 'C:\\node_modules', join('C:\\', PKG)], { PATH: 'C:\\' })
    ).toBeUndefined()
  })

  it('DÉTOURNEMENT : %TEMP% et le cwd sont refusés comme préfixes', () => {
    const temp = 'C:\\Users\\x\\AppData\\Local\\Temp'
    expect(
      lookup([join(temp, 'claude.exe'), join(temp, 'node_modules'), join(temp, PKG)], {
        TEMP: temp,
        PATH: `${temp};${join(temp, 'sous')}`
      })
    ).toBeUndefined()
    const cwd = process.cwd()
    expect(lookup([join(cwd, 'claude.exe'), join(cwd, 'node_modules')], { PATH: cwd })).toBeUndefined()
  })

  it('le préfixe par défaut PRIME sur le PATH (ordre stable, aucune surprise)', () => {
    const appdata = 'C:\\Users\\x\\AppData\\Roaming'
    const preferred = join(appdata, 'npm', PKG)
    const other = join('D:\\autre', PKG)
    expect(lookup([preferred, other], { APPDATA: appdata, PATH: 'D:\\autre' })).toBe(preferred)
  })

  it('QUE des shims dans le PATH → undefined (on ne rend JAMAIS un .cmd)', () => {
    const dir = 'C:\\Users\\x\\AppData\\Roaming\\npm'
    // Exactement l'etat de cette machine : .cmd, .ps1 et un fichier sans extension, aucun .exe.
    const shims = [join(dir, 'claude.cmd'), join(dir, 'claude.ps1'), join(dir, 'claude')]
    expect(lookup(shims, { PATH: dir })).toBeUndefined()
  })

  it('PATH vide ou absent → undefined, sans jeter', () => {
    expect(lookup([], {})).toBeUndefined()
    expect(lookup([], { PATH: '' })).toBeUndefined()
    expect(lookup([], { PATH: ';;  ;' })).toBeUndefined()
  })

  it('accepte `Path` (casse Windows) autant que `PATH`', () => {
    const prefix = 'D:\\npm'
    const target = join(prefix, PKG)
    expect(lookup([target], { Path: prefix })).toBe(target)
  })

  it('un dossier du PATH entre guillemets est nettoyé', () => {
    const prefix = 'D:\\mes outils'
    const target = join(prefix, PKG)
    expect(lookup([target], { PATH: `"${prefix}"` })).toBe(target)
  })

  it('un dossier ILLISIBLE n’interrompt pas la recherche', () => {
    const good = join('D:\\bon', PKG)
    const found = findClaudeExecutable({
      platform: 'win32',
      env: { PATH: 'Z:\\interdit;D:\\bon' },
      exists: (p) => {
        if (p.startsWith('Z:')) throw new Error('accès refusé')
        return p === good
      }
    })
    expect(found).toBe(good)
  })

  it('hors Windows, aucune résolution spéciale (le PATH y exécute les scripts)', () => {
    expect(
      findClaudeExecutable({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => true })
    ).toBeUndefined()
  })
})

describe('resolveClaudeBin — priorité des sources', () => {
  it('un binaire EXPLICITE gagne sur tout', () => {
    expect(resolveClaudeBin('C:\\perso\\claude.exe')).toBe('C:\\perso\\claude.exe')
  })

  it('CLAUDE_BIN gagne sur la recherche (échappatoire opérateur)', () => {
    const previous = process.env.CLAUDE_BIN
    process.env.CLAUDE_BIN = 'C:\\via-env\\claude.exe'
    try {
      expect(resolveClaudeBin()).toBe('C:\\via-env\\claude.exe')
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_BIN
      else process.env.CLAUDE_BIN = previous
    }
  })

  it('sur CETTE machine, la résolution rend un chemin ABSOLU vers un .exe existant', () => {
    // Garde anti-regression reel : si ce test rend 'claude', le spawn shell:false echouera en ENOENT.
    const previous = process.env.CLAUDE_BIN
    delete process.env.CLAUDE_BIN
    try {
      const resolved = resolveClaudeBin()
      if (process.platform !== 'win32') return
      expect(resolved).not.toBe('claude')
      expect(resolved.toLowerCase().endsWith('.exe')).toBe(true)
    } finally {
      if (previous !== undefined) process.env.CLAUDE_BIN = previous
    }
  })
})
