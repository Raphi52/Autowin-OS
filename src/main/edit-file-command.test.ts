import { describe, expect, it } from 'vitest'
import { applyEdit, decideEdit, editDiff } from './edit-file-command'

/**
 * TESTS DE REFUS D'ABORD — ce module est le seul de la journee qui donne le droit d'ECRIRE.
 *
 * Il n'existe que parce que l'agent sait desormais verifier son travail (`verify`). Les bornes ne
 * peuvent PAS etre deleguees a un outil du CLI : les patterns d'autorisation ont ete mesures
 * inoperants le meme jour (`--allowedTools "Bash(npm test)"` laissait passer `echo BONJOUR`). Donc
 * tout se joue ici.
 */
const WORKSPACE = 'C:/projet'
const file = (content: string) => (): string | null => content
const absent = (): string | null => null

describe('decideEdit — CONFINEMENT au workspace', () => {
  it('refuse une traversee de chemin', () => {
    for (const escape of [
      '../secret.txt',
      '../../Windows/System32/drivers/etc/hosts',
      'src/../../dehors.ts',
      'a/b/../../../evade.ts'
    ]) {
      const decision = decideEdit({ path: escape, oldText: 'a', newText: 'b' }, WORKSPACE, file('a'))
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) expect(decision.reason).toContain('hors du workspace')
    }
  })

  /*
   * MESURE conv-12 (2026-09-02) : l'edition d'un fichier d'un AUTRE depot (D:\GIT\RigApplication) a
   * ete refusee « chemin hors du workspace », alors que l'agent lisait ce depot depuis 20 tours.
   * Un chemin ABSOLU externe est donc recevable, et marque `externe`.
   */
  it('ACCEPTE un chemin absolu vers un autre depot, marque externe', () => {
    const decision = decideEdit(
      { path: 'D:/GIT/RigApplication/Source/ULT_TT_INPI.cs', oldText: 'a', newText: 'b' },
      WORKSPACE,
      file('a')
    )
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.externe).toBe(true)
      expect(decision.relativePath).toBe('D:/GIT/RigApplication/Source/ULT_TT_INPI.cs')
    }
  })

  it('un chemin INTERIEUR n’est pas marque externe', () => {
    const decision = decideEdit(
      { path: 'C:/projet/src/app.ts', oldText: 'a', newText: 'b' },
      WORKSPACE,
      file('a')
    )
    expect(decision.allowed).toBe(true)
    if (decision.allowed) expect(decision.externe).toBe(false)
  })

  it('refuse encore les RACINES SYSTEME (elles ne sont le travail de personne)', () => {
    for (const path of ['C:/Windows/system.ini', 'C:/Program Files/app/config.txt', '/etc/hosts']) {
      const decision = decideEdit({ path, oldText: 'a', newText: 'b' }, WORKSPACE, file('a'))
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) expect(decision.reason).toContain('racine système')
    }
  })

  it('refuse .git et les secrets AUSSI hors du workspace', () => {
    for (const path of ['D:/GIT/RigApplication/.git/config', 'D:/GIT/RigApplication/.env']) {
      const decision = decideEdit({ path, oldText: 'a', newText: 'b' }, WORKSPACE, file('a'))
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) expect(decision.reason).toMatch(/protégé|sensible/)
    }
  })

  it('accepte un chemin absolu INTERIEUR au workspace', () => {
    const decision = decideEdit(
      { path: 'C:/projet/src/app.ts', oldText: 'a', newText: 'b' },
      WORKSPACE,
      file('a')
    )
    expect(decision.allowed).toBe(true)
  })

  it('refuse sans workspace resolu', () => {
    expect(decideEdit({ path: 'a.ts', oldText: 'a', newText: 'b' }, undefined, file('a')).allowed).toBe(
      false
    )
  })
})

describe('decideEdit — ZONES INTERDITES', () => {
  it('refuse .git (corromprait le depot)', () => {
    const decision = decideEdit(
      { path: '.git/config', oldText: 'a', newText: 'b' },
      WORKSPACE,
      file('a')
    )
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toContain('protégé')
  })

  it('refuse node_modules, dist et out', () => {
    for (const path of ['node_modules/pkg/index.js', 'dist/bundle.js', 'out/main/index.js']) {
      expect(decideEdit({ path, oldText: 'a', newText: 'b' }, WORKSPACE, file('a')).allowed).toBe(false)
    }
  })

  it('refuse les fichiers de secrets', () => {
    for (const path of ['.env', 'config/.env', 'auth.json', 'settings.local.json', 'keys/id_rsa']) {
      const decision = decideEdit({ path, oldText: 'a', newText: 'b' }, WORKSPACE, file('a'))
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) expect(decision.reason).toMatch(/sensible|protégé/)
    }
  })
})

describe('decideEdit — REMPLACEMENT non ambigu', () => {
  it('refuse une chaine vide (elle correspondrait partout)', () => {
    expect(decideEdit({ path: 'a.ts', oldText: '', newText: 'x' }, WORKSPACE, file('abc')).allowed).toBe(
      false
    )
  })

  it('refuse un texte INTROUVABLE', () => {
    const decision = decideEdit(
      { path: 'a.ts', oldText: 'absent', newText: 'x' },
      WORKSPACE,
      file('contenu')
    )
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toContain('introuvable')
  })

  it('refuse un texte AMBIGU (present plusieurs fois)', () => {
    const decision = decideEdit(
      { path: 'a.ts', oldText: 'let x', newText: 'let y' },
      WORKSPACE,
      file('let x = 1\nlet x = 2')
    )
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toContain('2 fois')
  })

  it('refuse de CREER un fichier', () => {
    const decision = decideEdit({ path: 'nouveau.ts', oldText: 'a', newText: 'b' }, WORKSPACE, absent)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toContain('inexistant')
  })

  it('refuse un non-changement et des arguments invalides', () => {
    expect(decideEdit({ path: 'a.ts', oldText: 'a', newText: 'a' }, WORKSPACE, file('a')).allowed).toBe(
      false
    )
    expect(decideEdit({ path: 42, oldText: 'a', newText: 'b' }, WORKSPACE, file('a')).allowed).toBe(false)
    expect(decideEdit({ path: 'a.ts', oldText: 'a' }, WORKSPACE, file('a')).allowed).toBe(false)
  })

  it('autorise le cas legitime : une occurrence unique', () => {
    const decision = decideEdit(
      { path: 'src/app.ts', oldText: 'const a = 1', newText: 'const a = 2' },
      WORKSPACE,
      file('// entete\nconst a = 1\n')
    )
    expect(decision.allowed).toBe(true)
    if (decision.allowed) expect(decision.relativePath).toBe('src/app.ts')
  })
})

describe('applyEdit / editDiff', () => {
  it('remplace UNIQUEMENT la premiere occurrence validee', () => {
    expect(applyEdit('a X b', 'X', 'Y')).toBe('a Y b')
  })

  it('ne touche a rien si le texte a disparu entre-temps', () => {
    expect(applyEdit('contenu', 'absent', 'x')).toBe('contenu')
  })

  it('rend un diff lisible', () => {
    const diff = editDiff('const a = 1', 'const a = 2')
    expect(diff).toContain('- const a = 1')
    expect(diff).toContain('+ const a = 2')
  })
})

/**
 * Contrat de CABLAGE — ce point d'entree ECRIT sur disque : sa declaration doit dire la verite
 * (destructiveHint) et aucune ecriture ne doit pouvoir contourner la decision.
 */
describe('cablage de edit_file', () => {
  const commands = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(path.join(__dirname, 'commands.ts'), 'utf8')
  }

  it('est declaree DESTRUCTIVE (l’UI et l’agent doivent le savoir)', () => {
    const source = commands()
    const spec = source.slice(source.indexOf("name: 'edit_file'"), source.indexOf("name: 'edit_file'") + 800)
    expect(spec).toContain('destructiveHint: true')
    expect(spec).toContain('oldText')
  })

  it('AUCUNE ecriture avant la decision (un refus ne touche pas le disque)', () => {
    const source = commands()
    const impl = source.slice(source.indexOf('private runEditFile'))
    const body = impl.slice(0, impl.indexOf('return {\n      allowed: true'))
    const refusal = body.slice(0, body.indexOf('const content ='))
    expect(refusal).toContain('if (!decision.allowed) return')
    expect(refusal).not.toContain('writeFileSync(')
  })

  it('passe par la decision pure et le remplacement unique', () => {
    const source = commands()
    expect(source).toContain('decideEdit(')
    expect(source).toContain('applyEdit(')
    expect(source).toContain('editDiff(')
  })

  it('rend un DIFF (le changement est visible, pas silencieux)', () => {
    const impl = commands().slice(commands().indexOf('private runEditFile'))
    expect(impl).toContain('diff:')
  })
})

/**
 * UN REFUS DOIT ENSEIGNER. Constate en usage reel (2026-07-29) : « texte introuvable » a fait
 * enchainer QUATRE tentatives a l'aveugle — l'agent devinait l'extrait de memoire et n'apprenait rien
 * de son echec. Ici, l'echec doit rendre les lignes REELLES pour qu'il corrige au coup suivant.
 */
describe('refus INSTRUCTIF (ce qui evite les 4 tentatives a l’aveugle)', () => {
  const CONTENT = [
    'export interface ScoutRow {',
    "  impact: string",
    "  effort: string",
    '}'
  ].join('\n')

  it('un extrait presque juste rend la LIGNE REELLE avec son numero', () => {
    // L'agent croit se souvenir de « impact: number » alors que le fichier dit « string ».
    const decision = decideEdit(
      { path: 'a.ts', oldText: '  impact: number', newText: '  impact: string' },
      WORKSPACE,
      () => CONTENT
    )
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toContain('plus proches')
      expect(decision.reason).toContain('impact: string')
      expect(decision.reason).toMatch(/\d+:/) // un numero de ligne exploitable
    }
  })

  it('un extrait totalement etranger reste un refus SIMPLE (pas de bruit inutile)', () => {
    const decision = decideEdit(
      { path: 'a.ts', oldText: 'ZZZZ_totalement_absent', newText: 'x' },
      WORKSPACE,
      () => CONTENT
    )
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toContain('relis-le')
  })

  it('un extrait AMBIGU liste les occurrences avec leurs numeros', () => {
    const twice = 'let x = 1\nautre\nlet x = 1\n'
    const decision = decideEdit({ path: 'a.ts', oldText: 'let x = 1', newText: 'let y = 1' }, WORKSPACE, () => twice)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toContain('2 fois')
      expect(decision.reason).toContain('1: let x = 1')
      expect(decision.reason).toContain('3: let x = 1')
    }
  })
})
