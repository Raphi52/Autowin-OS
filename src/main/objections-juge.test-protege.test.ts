import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { empreintesTestsDuJuge, motifsTestModifie } from './objections-juge'

const verdict = (f: string): string => `DEFAUT: x\nOBJECTIONS:\n- MAJEUR: casse | TEST: ${f} | npx vitest run a`

const crees: string[] = []
afterEach(() => {
  for (const r of crees.splice(0)) rmSync(r, { recursive: true, force: true })
})

function racine(): string {
  const r = mkdtempSync(join(tmpdir(), 'tp-'))
  crees.push(r)
  mkdirSync(join(r, 'src'))
  writeFileSync(join(r, 'src', 'a.test.ts'), 'expect(1).toBe(2)')
  return r
}

// fix-ok: le 4e édit ajoute le nettoyage des dossiers temporaires que chaque cas créait sans les effacer (mesuré au ménage) ; les autres édits réparaient un échappement \ mangé par le heredoc.
describe('le fichier TEST: du juge est protégé pendant la réparation', () => {
  it('refuse une réparation qui a modifié le test et nomme le fichier', () => {
    const r = racine()
    const avant = empreintesTestsDuJuge(verdict('src/a.test.ts'), r)
    writeFileSync(join(r, 'src', 'a.test.ts'), 'expect(1).toBe(1)')
    const motifs = motifsTestModifie(avant, empreintesTestsDuJuge(verdict('src/a.test.ts'), r))
    expect(motifs).toHaveLength(1)
    expect(motifs[0]).toContain('src/a.test.ts')
  })
  it('ne refuse rien quand le test est inchangé', () => {
    const r = racine()
    const avant = empreintesTestsDuJuge(verdict('src/a.test.ts'), r)
    expect(motifsTestModifie(avant, empreintesTestsDuJuge(verdict('src/a.test.ts'), r))).toEqual([])
  })
  it('ne refuse rien sans TEST: dans le verdict', () => {
    const r = racine()
    const v = 'DEFAUT: x\nOBJECTIONS:\n- MAJEUR: preuve manquante'
    expect(empreintesTestsDuJuge(v, r)).toEqual({})
    expect(motifsTestModifie(empreintesTestsDuJuge(v, r), empreintesTestsDuJuge(v, r))).toEqual([])
  })
  it('ne protège pas un fichier absent avant la réparation (le créer peut être le travail)', () => {
    const r = racine()
    const avant = empreintesTestsDuJuge(verdict('src/b.test.ts'), r)
    writeFileSync(join(r, 'src', 'b.test.ts'), 'nouveau')
    expect(motifsTestModifie(avant, empreintesTestsDuJuge(verdict('src/b.test.ts'), r))).toEqual([])
  })
  it('chemin relatif avec \\ et chemin absolu désignent le même fichier', () => {
    const r = racine()
    const avant = empreintesTestsDuJuge(verdict('src\\a.test.ts'), r)
    writeFileSync(join(r, 'src', 'a.test.ts'), 'affaibli')
    const abs = join(r, 'src', 'a.test.ts').replace(/\\/g, '/')
    expect(motifsTestModifie(avant, empreintesTestsDuJuge(verdict(abs), r))).toHaveLength(1)
  })
  it('est branché dans la boucle entre le verdict et la décision de clore en vert', () => {
    const src = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')
    // Le comportement sur plusieurs passages est prouvé de bout en bout par
    // orchestrator.test-protection-tout-le-run.test.ts ; ici, seulement la place du contrôle.
    expect(src).toMatch(/gate = r\.gate\s*\n[\s\S]{0,600}?motifsTestModifie\(empreintesProtegees, [\s\S]{0,600}?if \(!gate\.blocked\)/)
    expect(src).toMatch(/empreintesTestsDuJuge\(lastJudgeText, workCwd\)/)
  })
})
