import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PHASE_BRIEFS } from './phase-briefs'
import { bundledSkillsRoot } from './native-registry'

/**
 * KAIZEN DOIT CONNAITRE SES LEVIERS — dans le texte qui lui est REELLEMENT envoye.
 *
 * Defaut mesure le 2026-09-03 (conv-9). La liste des sept leviers vit dans
 * `skills/kaizen/SKILL.md` et `kaizen-perimetres.test.ts` la garde bien... dans CE fichier. Mais
 * kaizen est un workflow NATIF : `skill-pipeline.ts` rend '' pour la phase kaizen, donc aucun
 * corps de skill n'est charge. Le seul texte qui arrive au modele est `PHASE_BRIEFS.kaizen`, et il
 * ne nommait AUCUN levier — pire, sa premiere ligne interdisait mot pour mot les skills, les hooks
 * et CLAUDE.md/CONSTITUTION.md, soit trois des sept.
 *
 * Ce test garde le TEXTE INJECTE, pas le fichier de skill : c'est la seule couche que le modele lit.
 */
const LEVIERS: Array<[string, string]> = [
  ['1 — skills', 'skills/_engine/ENGINE.md'],
  ['2 — prompt du cockpit', 'src/main/chat-pilotage-prompt.ts'],
  ['2 — consignes de phase', 'src/main/phase-briefs.ts'],
  ['2 — constitution', 'src/main/constitution.ts'],
  ['2 — routage', 'src/main/intent-phase-routing.ts'],
  ['2 — composition du comportement', 'src/main/behaviour-composition.ts'],
  ['2 — ce que kaizen recoit', 'src/main/autowin-kaizen-context.ts'],
  ['3 — outils de l’agent', 'src/main/commands.ts'],
  ['5 — scanner des fichiers de comportement', 'src/main/behaviour-files.ts']
]

function repoRoot(): string {
  return dirname(bundledSkillsRoot()!)
}

describe('consigne KAIZEN injectée — les sept leviers arrivent au modèle', () => {
  const brief = PHASE_BRIEFS.kaizen

  it('la section des leviers existe dans le texte injecté', () => {
    expect(brief).toContain('TES LEVIERS')
    for (const numero of ['1.', '2.', '3.', '4.', '5.', '6.', '7.']) {
      expect(brief).toContain(`\n${numero} `)
    }
  })

  for (const [nom, chemin] of LEVIERS) {
    it(`le levier ${nom} est nommé par son chemin réel, et ce chemin EXISTE`, () => {
      expect(brief).toContain(chemin)
      expect(existsSync(join(repoRoot(), chemin))).toBe(true)
    })
  }

  it('les leviers 4 (garde-fous) et 7 (Brain) sont nommés par leur dossier réel', () => {
    expect(brief).toContain('src/main/gates/*.ts')
    expect(brief).toContain('src/main/brain-*.ts')
    expect(existsSync(join(repoRoot(), 'src/main/gates'))).toBe(true)
  })

  it("l'ordre d'enforcement est écrit : le niveau se choisit sur la CAUSE, dès la première passe", () => {
    expect(brief).toMatch(/Ordre d'enforcement/)
    expect(brief).toMatch(/garde-fou deterministe/)
    expect(brief).toMatch(/PREMIERE passe/)
  })

  /*
   * CONTROLE NEGATIF NOMME : la phrase d'avant, mot pour mot. Tant qu'elle etait la, trois leviers
   * etaient interdits par le texte meme qui aurait du les donner.
   */
  it("l'ancienne interdiction qui coupait trois leviers a disparu", () => {
    const INTERDICTION_DAVANT =
      "Tu n'utilises aucun transcript, hook, SESSION_ID, CLAUDE.md, CONSTITUTION.md ou fichier de skill Claude."
    expect(INTERDICTION_DAVANT).toContain('CLAUDE.md') // la sonde vise bien la bonne phrase
    expect(brief).not.toContain(INTERDICTION_DAVANT)
  })

  it('la restriction de SOURCE, elle, est conservée : aucun transcript inventé', () => {
    // Ce qu'elle protegeait vraiment reste protege — kaizen ne doit pas pretendre lire un
    // transcript Claude Code, qui n'existe pas dans Autowin.
    expect(brief).toMatch(/ne pretends jamais en avoir lu un/)
    expect(brief).toMatch(/transcript Claude Code/)
  })
})
