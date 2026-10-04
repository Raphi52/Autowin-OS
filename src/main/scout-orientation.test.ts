import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PHASE_BRIEFS } from './phase-briefs'
import { parseScoutTable } from '../shared/scout-table'
// fix-ok: ce test ne lisait que SKILL.md, que le pipeline in-app n'envoie jamais (`corpsSkill` vide
// pour une phase du pipeline, orchestrator.ts) : il restait vert sans rien garder de la consigne reelle.

const racine = resolve(__dirname, '..', '..')
const demande = resolve(racine, 'skills/scout/ORIENTER-UN-SCOUT.md')
const skill = resolve(racine, 'skills/scout/SKILL.md')

describe('demande d orientation d un scout', () => {
  it('existe', () => {
    expect(existsSync(demande)).toBe(true)
  })

  it('ne laisse aucun trou a remplir', () => {
    const t = readFileSync(demande, 'utf8')
    expect(t).not.toMatch(/<[^>\n]*a nommer[^>\n]*>|<module|TODO|\bXXX\b/i)
  })

  it('active des leviers reellement presents dans SKILL.md', () => {
    const t = readFileSync(demande, 'utf8').toLowerCase()
    const s = readFileSync(skill, 'utf8').toLowerCase()
    // levier 1 : bascule du quota de pistes ambitieuses
    expect(t).toContain('fresh vision')
    expect(s).toContain('demande « fresh vision » → bascule vers 🆕 (≥ 50 %)'.toLowerCase())
    // levier 2 : elargissement quand la moisson est tiede
    expect(t).toMatch(/refais un tour|elargis|élargis/)
    expect(s).toContain('élargis si la moisson est tiède')
    // levier 3 : lentille prior-art datee 30-90 jours
    expect(t).toMatch(/30[  ]?(a|à|-)[  ]?90 jours/)
    expect(s).toContain('derniers 30-90 jours')
    // levier 4 : plafond des pistes deduites
    expect(t).toMatch(/file:line|fichier:ligne/)
    expect(s).toContain('plafonné à 50')
    // levier 5 : la ligne finale lue par la machine
    expect(t).toContain('CIBLE:'.toLowerCase())
    expect(s).toContain('exactly one `cible:` line')
  })

  // SKILL.md renvoyait vers `file:///C:/Travail/Autowin%20OS/...scout-table.ts:143` : un dossier qui
  // n'existe plus, et une ligne 143 qui designe desormais la colonne Impact, pas la note.
  it('les liens de SKILL.md menent a des fichiers du depot, sans numero de ligne perime', () => {
    const s = readFileSync(skill, 'utf8')
    const liens = [...s.matchAll(/\]\(([^)\s]+)\)/gu)].map((m) => m[1]!)
    expect(liens.length).toBeGreaterThan(0)
    for (const lien of liens) {
      if (/^https?:/u.test(lien)) continue
      expect(lien, lien).not.toMatch(/^file:/u)
      expect(lien, lien).not.toMatch(/:\d+$/u)
      expect(existsSync(resolve(racine, 'skills/scout', decodeURI(lien))), lien).toBe(true)
    }
  })

  /*
   * SKILL.md n'est PAS ce que recoit un scout lance par l'app : le pipeline in-app ne lit que
   * `PHASE_BRIEFS.scout` (`orchestrator.ts`, `phasePrompt`). Le premier test restait vert alors
   * qu'aucune de ces formules n'agissait sur une regle dans l'app (conv-890). Les memes leviers
   * doivent donc exister dans la consigne reellement envoyee.
   */
  it('active les memes leviers dans la consigne que l app envoie reellement', () => {
    const b = PHASE_BRIEFS.scout.toLowerCase()
    // levier 1 : bascule du quota de pistes ambitieuses
    expect(b).toContain('« fresh vision » → ≥ 50 % de 🆕')
    // levier 2 : elargissement quand la moisson est tiede
    expect(b).toMatch(/refais un tour/)
    // levier 3 : recherche web datee 30-90 jours
    expect(b).toMatch(/30 [àa] 90 derniers jours/)
    // levier 4 : plafond des pistes deduites
    expect(b).toMatch(/plafonne a 50/)
    // levier 5 : la cible lue par la machine
    expect(b).toMatch(/## cible|cible:/)
  })

  // Candidats scout conv-41 : la skill se contredisait, et ne disait pas la meme chose que le brief.
  describe('SKILL.md coherente avec elle-meme et avec le brief de l app', () => {
    const brut = () => readFileSync(skill, 'utf8')
    it('n interdit plus la note /100 qu elle exige', () => {
      expect(brut().toLowerCase()).not.toMatch(/émettre un \*\*\/100/)
    })
    it('reste un sommaire : les longs blocs vivent dans references/', () => {
      expect(Buffer.byteLength(brut(), 'utf8')).toBeLessThan(17500)
      expect(brut()).toContain('](references/recherche-externe.md)')
      expect(brut()).toContain('](references/preuve-avant-inscription.md)')
    })
    it('meme tableau que le brief : # | Score | ... a 6 colonnes, lisible par scout-table', () => {
      const entete = (t: string) => t.match(/# \| Score \| Type \|[^`\n]*/)?.[0]
      const hSkill = entete(brut())
      const hBrief = entete(PHASE_BRIEFS.scout)
      expect(hSkill, 'en-tete skill').toBeTruthy()
      expect(hBrief, 'en-tete brief').toBeTruthy()
      const cellules = (h: string) => h.split('|').map((c) => c.trim()).filter(Boolean)
      expect(cellules(hSkill!)).toHaveLength(6)
      expect(cellules(hBrief!)).toHaveLength(6)
      for (const h of [hSkill!, hBrief!]) {
        const md = `| ${cellules(h).join(' | ')} |\n|---|---|---|---|---|---|\n| 1 | 82 | 🔧 fix | a | b | c |`
        expect(parseScoutTable(md)?.[0]?.score, h).toBe(82)
      }
    })
    it('connait ## Cible en tete, CIBLE: en fin et SUITE: fin', () => {
      const s = brut()
      expect(s).toContain('`## Cible` en tête')
      expect(s).toContain('`SUITE: fin`')
    })
    it('dit quoi faire sans sous-agents', () => {
      expect(brut()).toContain('sinon, joue les lentilles une par une')
    })
    it('ORIENTER-UN-SCOUT renvoie au nom actuel de la section', () => {
      expect(readFileSync(demande, 'utf8')).not.toContain('Coverage dial')
    })
  })
})
