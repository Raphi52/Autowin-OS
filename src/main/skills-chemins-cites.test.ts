import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Une skill qui cite un fichier ABSENT du dépôt envoie l'agent réparer un kit qui n'existe pas.
 * Mesuré le 2026-09-12 : kaizen pointait `sync-kit.ps1`, `hooks/*.ps1` et `CLAUDE.md`, tous
 * inexistants ici — sa dernière étape était donc inexécutable. Ce test ferme la porte : tout
 * chemin de DÉPÔT cité entre backticks (`src/...` ou `skills/...`, sans joker) doit exister.
 */
const RACINE = join(__dirname, '..', '..')
const CHEMIN = /`((?:src|skills)\/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)`/g

/**
 * Skills IGNORÉES par git : présentes sur ce disque, mais hors du dépôt. Exemple : `arenagame`, sortie
 * du dépôt par e889422f (« usage personnel », `.gitignore` : `skills/arenagame/`). Ses chemins
 * (`src/shared/Partie.luau`) désignent le projet Roblox de ses bras, pas ce dépôt : le test était
 * rouge sur ce poste et vert sur une copie propre. Seules les skills IGNORÉES sortent du contrôle ;
 * une skill neuve pas encore commitée reste contrôlée. Sans git (code 128), rien n'est filtré.
 */
function skillsIgnoreesParGit(chemins: string[]): Set<string> {
  if (!chemins.length) return new Set()
  const r = spawnSync('git', ['check-ignore', '--stdin'], {
    cwd: RACINE,
    input: chemins.join('\n'),
    encoding: 'utf8'
  })
  // 0 = au moins un chemin ignoré ; 1 = aucun ; autre = pas de dépôt ou git absent.
  if (r.status !== 0) return new Set()
  return new Set(r.stdout.split(/\r?\n/).filter(Boolean))
}

describe('chemins de dépôt cités par les skills', () => {
  const surLeDisque = readdirSync(join(RACINE, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  const ignorees = skillsIgnoreesParGit(surLeDisque.map((nom) => `skills/${nom}/SKILL.md`))
  const skills = surLeDisque.filter((nom) => !ignorees.has(`skills/${nom}/SKILL.md`))

  it('écarte les skills ignorées par git, et elles seules', () => {
    for (const chemin of ignorees) {
      const r = spawnSync('git', ['ls-files', '--error-unmatch', chemin], { cwd: RACINE })
      expect(r.status, `${chemin} est suivie par git : elle doit rester contrôlée`).not.toBe(0)
    }
    expect(skills).not.toContain('arenagame')
  })

  it('scanne bien le kit (sinon l’assertion suivante ne prouve rien)', () => {
    expect(skills).toEqual(expect.arrayContaining(['kaizen', 'frame', 'scout', 'remake']))
  })

  it('ne cite jamais un fichier qui n’existe pas', () => {
    const morts: string[] = []
    for (const nom of skills) {
      const fichier = join(RACINE, 'skills', nom, 'SKILL.md')
      if (!existsSync(fichier)) continue
      const texte = readFileSync(fichier, 'utf8')
      for (const m of texte.matchAll(CHEMIN)) {
        const cible = m[1]
        if (cible.includes('*') || cible.includes('<')) continue
        if (!existsSync(join(RACINE, cible))) morts.push(`${nom}: ${cible}`)
      }
    }
    expect(morts).toEqual([])
  })
})
