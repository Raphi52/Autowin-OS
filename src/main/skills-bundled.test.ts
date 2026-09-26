import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledSkillsRoot, nativeSkills, skillRoots } from './native-registry'
import { phaseInstructionFromRoots, PIPELINE_PHASES } from './skill-pipeline'

/**
 * SKILLS EMBARQUÉES DANS LE DÉPÔT — le comportement de l'app ne doit plus dépendre d'un arbre externe.
 *
 * Constaté avant ce travail : `skillRoots()` ne rendait que des racines de `homedir()`, donc sur une
 * machine sans le kit, `phaseInstructionFromRoots` retournait '' et les phases s'injectaient VIDES —
 * l'app tournait sans rien dire. Le dépôt devient la source de vérité, avec une échappatoire nommée
 * pour continuer à développer le kit en live.
 */
const cleanups: string[] = []
afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

/** Une racine de skills jetable portant un corps RECONNAISSABLE, pour prouver la provenance. */
function rootWithSentinel(phase: string, sentinel: string): string {
  const root = mkdtempSync(join(tmpdir(), 'skills-bundled-'))
  cleanups.push(root)
  mkdirSync(join(root, phase), { recursive: true })
  writeFileSync(join(root, phase, 'SKILL.md'), `# ${phase}\n${sentinel}`)
  return root
}

describe('skills embarquées dans la code base', () => {
  it('le dépôt porte bien les skills, avec _engine', () => {
    const root = bundledSkillsRoot()
    expect(root).toBeTruthy()
    for (const phase of ['scout', 'frame', 'terrain', 'build', 'clean', 'judge', 'remake']) {
      expect(existsSync(join(root!, phase, 'SKILL.md'))).toBe(true)
    }
    expect(existsSync(join(root!, '_engine', 'ENGINE.md'))).toBe(true)
  })

  /**
   * Décision utilisateur du 2026-09-26 (conv-16) : « je garde que les skills d'autowin ». Les kits
   * externes `~/.claude/skills` et `~/.codex/skills` ne sont plus lus : c'est par là qu'entraient
   * `_engine`, `autowin-setup` et `capafy-publisher` dans la palette `/` et dans l'état du modèle.
   */
  it("seules les racines Autowin sont lues : le dépôt d'abord, puis la racine Autowin du poste", () => {
    const roots = skillRoots('C:\\LocalAppData', 'C:\\depot\\skills')
    expect(roots).toEqual(['C:\\depot\\skills', join('C:\\LocalAppData', 'autowin-os', 'skills')])
  })

  it('aucune racine par défaut ne pointe vers ~/.claude ni ~/.codex', () => {
    expect(skillRoots().filter((root) => /[/\\]\.(claude|codex)[/\\]/u.test(root))).toEqual([])
  })

  it("les skills d'un kit externe (_engine, autowin-setup, capafy-publisher) ne sont plus listées", () => {
    const base = mkdtempSync(join(tmpdir(), 'skills-autowin-seules-'))
    cleanups.push(base)
    const ids = nativeSkills(base).map((skill) => skill.id)
    expect(ids).toContain('build')
    expect(ids).not.toContain('_engine')
    expect(ids).not.toContain('autowin-setup')
    expect(ids).not.toContain('capafy-publisher')
  })

  /**
   * La preuve qui COMPTE : « le fichier existe » ne prouve pas « le corps injecté en vient ».
   * Un marqueur unique dans la racine dépôt doit ressortir dans l'instruction rendue.
   */
  it('le corps injecté PROVIENT de la racine du dépôt, pas du kit externe', () => {
    const bundled = rootWithSentinel('build', 'CORPS-VENU-DU-DEPOT')
    const externe = rootWithSentinel('build', 'CORPS-VENU-DU-KIT-EXTERNE')
    const roots = skillRoots(undefined, bundled)
    const rendered = phaseInstructionFromRoots('build', [bundled, externe])
    expect(rendered).toContain('CORPS-VENU-DU-DEPOT')
    expect(rendered).not.toContain('CORPS-VENU-DU-KIT-EXTERNE')
    expect(roots[0]).toBe(bundled)
  })

  /**
   * Le risque HAUTE sévérité du cadrage : `process.cwd()` vaut la racine du dépôt en dev, mais pas dans
   * une application packagée où le code vit sous `resources/app.asar`. On éprouve donc la RÉSOLUTION sur
   * un layout de type asar — logique testée, pas un build réel : à ne pas confondre.
   */
  it('résout la racine dans un layout de type application packagée', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'asar-like-'))
    cleanups.push(appRoot)
    const packaged = join(appRoot, 'resources', 'app.asar', 'skills')
    mkdirSync(join(packaged, '_engine'), { recursive: true })
    writeFileSync(join(packaged, '_engine', 'ENGINE.md'), '# ENGINE')

    // Le candidat dev (cwd) n'existe pas ici : seule la voie packagée peut répondre.
    expect(bundledSkillsRoot([join(appRoot, 'cwd-absent', 'skills'), packaged])).toBe(packaged)
  })

  it('ne devine JAMAIS un chemin : aucun candidat porteur → undefined', () => {
    expect(bundledSkillsRoot([join(tmpdir(), 'rien-ici-' + Math.random())])).toBeUndefined()
  })

  it('chaque répertoire de skills du dépôt porte bien son SKILL.md', () => {
    const root = bundledSkillsRoot()!
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '_engine')
      .map((e) => e.name)
    expect(dirs.length).toBeGreaterThanOrEqual(9)
    for (const dir of dirs) expect(existsSync(join(root, dir, 'SKILL.md'))).toBe(true)
  })

  // Décision utilisateur du 2026-08-05 : `remake` DEVIENT une phase composable. Sa SKILL.md était
  // déjà embarquée (test ci-dessus) mais l'enum l'excluait, donc on ne pouvait pas la poser sur un
  // graphe de workflow. Le test qui protégeait l'exclusion est remplacé par celui qui garde le
  // nouveau contrat : chaque phase déclarée doit avoir sa skill embarquée.
  it('PipelinePhase est une union de 8, et chaque phase a sa skill embarquée', () => {
    expect(PIPELINE_PHASES).toHaveLength(8)
    expect(PIPELINE_PHASES).toContain('remake')
    const root = bundledSkillsRoot()
    for (const phase of PIPELINE_PHASES) {
      if (phase === 'kaizen') continue // workflow natif Autowin, pas de SKILL.md embarquée
      expect(existsSync(join(root!, phase, 'SKILL.md'))).toBe(true)
    }
  })

  it("racine Autowin du poste ABSENTE → l'instruction reste NON VIDE (avant : chaîne vide, en silence)", () => {
    const roots = skillRoots(join(tmpdir(), 'localappdata-inexistant-' + Math.random()))
    const rendered = phaseInstructionFromRoots('build', roots)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered).toContain('SKILL BUILD')
  })
})
