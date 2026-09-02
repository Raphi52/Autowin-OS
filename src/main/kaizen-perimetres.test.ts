import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bundledSkillsRoot } from './native-registry'

/**
 * KAIZEN — les trois périmètres d'audit ajoutés (axes 2-3-4) doivent VIVRE dans le SKILL.md
 * embarqué, et la copie LIVE (`~/.claude/skills`) ne doit pas diverger de celle du dépôt.
 *
 * Défaut vécu : les axes étaient écrits dans une copie seulement, donc l'app chargeait un kaizen
 * qui ignorait les conversations Autowin, les injections runtime et les lentilles workflow.
 * Contrôle négatif NOMMÉ : le SKILL.md d'avant les 4 éditions (commit `74501455`), figé en
 * fixture pour ne pas dépendre d'un historique git complet — s'il passait ces assertions, le
 * test ne prouverait rien.
 */
const AXES: Array<[string, RegExp]> = [
  ['axe 2 — conversations Autowin', /conversation_read|conversation_search/],
  ['axe 3 — injections runtime', /INJECTED instruction/],
  ['axe 4 — lentilles workflow', /WORKFLOW\/TOPOLOGY lenses/],
  // Demande utilisateur du 2026-09-02 : kaizen invoqué PENDANT un travail doit d'abord FINIR
  // la tâche, puis faire l'amélioration comportementale — l'audit ne remplace pas le livrable.
  ['axe 5 — finir la tâche avant l’audit', /FINISH THE TASK FIRST/],
  // Demande utilisateur du 2026-09-02 : kaizen doit connaître SES LEVIERS — skills, outils, code
  // Autowin, .md, Brain — sinon il corrige toujours dans `skills/` faute de savoir où d'autre agir.
  ['axe 6 — la liste des leviers éditables', /## Tes leviers/]
]

/* Les sept leviers, chacun ancré sur une cible RÉELLE du dépôt (pas une catégorie en prose). */
const LEVIERS: Array<[string, RegExp]> = [
  ['skills', /skills\/_engine\/ENGINE\.md/],
  ['prompts injectés (code)', /src\/main\/chat-pilotage-prompt\.ts/],
  ['consignes de phase', /src\/main\/phase-briefs\.ts/],
  ['outils de l’agent', /src\/main\/commands\.ts/],
  ['garde-fous déterministes', /src\/main\/gates\/\*\.ts/],
  ['fichiers de comportement hors dépôt', /behaviour-files\.ts/],
  ['docs .md du dépôt', /ONBOARDING\.md/],
  ['Brain', /brain-remember\.ts/]
]

const SHA_AVANT = '74501455'

function repoRoot(): string {
  return bundledSkillsRoot()!.replace(/[\/]skills$/, '')
}

function normalise(t: string): string {
  return t.replace(/\r\n/g, '\n').trimEnd()
}

function fixtureAvant(): string {
  return readFileSync(join(__dirname, '__fixtures__', 'kaizen-skill-avant.md'), 'utf8')
}

function kaizenPackage(): string {
  const root = bundledSkillsRoot()
  expect(root).toBeTruthy()
  return readFileSync(join(root!, 'kaizen', 'SKILL.md'), 'utf8')
}

describe('kaizen — périmètres d’audit et propagation package→live', () => {
  const texte = kaizenPackage()

  for (const [nom, motif] of AXES) {
    it(`le SKILL.md embarqué porte ${nom}`, () => {
      expect(motif.test(texte)).toBe(true)
    })
  }

  it('les axes sont ANNONCÉS dans le frontmatter (ce que l’app charge comme déclencheur)', () => {
    const front = texte.split('---')[1] ?? ''
    expect(front).toMatch(/AUTOWIN conversation/)
    expect(front).toMatch(/INJECTED instruction/)
    expect(front).toMatch(/FINISH THE TASK FIRST/)
  })

  it('l’ordre est IMPOSÉ : la tâche est finie AVANT l’audit, dans la même passe', () => {
    // La règle doit être une étape de la procédure (donc jouée), pas une phrase d'intention.
    expect(texte).toMatch(/0\. \*\*FINISH THE TASK FIRST/)
    expect(texte).toMatch(/Abandonner la tâche pour faire l'audit/)
    // Et l'étape 0 vient AVANT l'étape 1 « LOCATE the target ».
    expect(texte.indexOf('FINISH THE TASK FIRST')).toBeLessThan(
      texte.indexOf('1. **LOCATE the target.**')
    )
  })

  for (const [nom, motif] of LEVIERS) {
    it(`le levier « ${nom} » est NOMMÉ avec sa cible réelle`, () => {
      expect(motif.test(texte)).toBe(true)
    })
  }

  it('les leviers sont balayés AVANT le choix du fichier (renvoi depuis l’étape INTEGRATE)', () => {
    expect(texte).toMatch(/§ « Tes leviers »/)
    // La section vient AVANT la procédure : elle se lit avant de choisir une cible.
    expect(texte.indexOf('## Tes leviers')).toBeLessThan(texte.indexOf('## Procedure'))
  })

  it('l’ordre d’enforcement est écrit (une règle qui échoue MONTE d’un niveau)', () => {
    expect(texte).toMatch(/Ordre d'enforcement/)
    expect(texte).toMatch(/garde-fou déterministe/)
  })

  it('contrôle négatif : la version d’avant les éditions ÉCHOUE ces axes', () => {
    const portes = AXES.filter(([, motif]) => motif.test(fixtureAvant()))
    expect(portes).toHaveLength(0)
  })

  it('la fixture du contrôle négatif EST le SKILL.md du commit 74501455 (si le git est complet)', () => {
    let reel: string
    try {
      reel = execFileSync('git', ['show', `${SHA_AVANT}:skills/kaizen/SKILL.md`], {
        encoding: 'utf8',
        cwd: repoRoot()
      })
    } catch {
      return // clone superficiel : la fixture reste l’entrée nommée, le contrôle négatif tient sans git
    }
    expect(normalise(reel)).toBe(normalise(fixtureAvant()))
  })

  const live = join(homedir(), '.claude', 'skills', 'kaizen', 'SKILL.md')
  // skipIf, PAS un `return` silencieux : sans copie live le runner AFFICHE le test sauté au
  // lieu de faire passer une parité qui n’a jamais été vérifiée.
  it.skipIf(!existsSync(live))('la copie live ~/.claude/skills/kaizen est identique au dépôt', () => {
    expect(readFileSync(live, 'utf8')).toBe(texte)
  })
})
