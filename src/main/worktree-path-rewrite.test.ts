import { describe, expect, it } from 'vitest'
import {
  alignReportWithDisk,
  isolatedWorkNotice,
  rewriteWorktreePaths
} from './worktree-path-rewrite'

/**
 * UN RAPPORT NE DOIT PAS POINTER VERS UN DOSSIER QUI N'EXISTE PLUS.
 *
 * Constaté le 2026-07-29, dit par l'agent lui-même : « Le rapport pointe vers un worktree qui n'existe
 * plus — je vérifie si le résultat a été rapatrié dans le workspace. » Le run écrit dans une copie
 * isolée, rédige son rapport avec ces chemins, puis la fin de run fusionne et SUPPRIME la copie.
 */
const WT = 'C:\\Amitel\\Autowin OS\\Audit\\worktrees\\agent__run-4c7fb67f6eee-1'
const BASE = 'C:\\Amitel\\Autowin OS'

describe('rewriteWorktreePaths — les chemins pointent là où les fichiers SONT', () => {
  it('réécrit un chemin Windows vers le workspace de base', () => {
    const text = `Créé ${WT}\\src\\shared\\duree.ts et son test.`
    expect(rewriteWorktreePaths(text, WT, BASE)).toBe(
      `Créé ${BASE}\\src\\shared\\duree.ts et son test.`
    )
  })

  it('réécrit aussi l’écriture à slashs (les rapports mélangent les deux)', () => {
    const slashed = WT.replace(/\\/g, '/')
    const text = `voir ${slashed}/src/shared/duree.ts`
    expect(rewriteWorktreePaths(text, WT, BASE)).toBe(`voir ${BASE.replace(/\\/g, '/')}/src/shared/duree.ts`)
  })

  it('un chemin JSON (antislashs DOUBLÉS) reste du JSON valide après réécriture', () => {
    const json = JSON.stringify({ path: `${WT}\\src\\a.ts` })
    const rewritten = rewriteWorktreePaths(json, WT, BASE)
    // Le test qui compte : ca doit encore se parser, et pointer vers la base.
    expect(JSON.parse(rewritten).path).toBe(`${BASE}\\src\\a.ts`)
  })

  it('insensible à la casse (Windows ne la distingue pas)', () => {
    const text = `fichier ${WT.toUpperCase()}\\src\\a.ts`
    expect(rewriteWorktreePaths(text, WT, BASE)).toContain(BASE)
    expect(rewriteWorktreePaths(text, WT, BASE)).not.toMatch(/worktrees/i)
  })

  it('plusieurs occurrences sont TOUTES réécrites', () => {
    const text = `${WT}\\a.ts puis ${WT}\\b.ts`
    const out = rewriteWorktreePaths(text, WT, BASE)
    expect(out).not.toMatch(/worktrees/i)
    expect(out.match(/Autowin OS\\a\.ts|Autowin OS\\b\.ts/g)).toHaveLength(2)
  })

  it('un texte SANS chemin de worktree est rendu intact (aucun effet de bord)', () => {
    const text = 'Tout va bien, 3 tests verts.'
    expect(rewriteWorktreePaths(text, WT, BASE)).toBe(text)
  })

  it('worktree ÉGAL au workspace (run non isolé) → rien à réécrire', () => {
    expect(rewriteWorktreePaths(`voir ${BASE}\\a.ts`, BASE, BASE)).toBe(`voir ${BASE}\\a.ts`)
  })

  it('entrées vides : on ne touche à rien plutôt que de produire un chemin bancal', () => {
    expect(rewriteWorktreePaths('', WT, BASE)).toBe('')
    expect(rewriteWorktreePaths('x', '', BASE)).toBe('x')
    expect(rewriteWorktreePaths('x', WT, '')).toBe('x')
  })

  it('un slash final sur les chemins ne duplique pas le séparateur', () => {
    const text = `${WT}\\src\\a.ts`
    expect(rewriteWorktreePaths(text, `${WT}\\`, `${BASE}\\`)).toBe(`${BASE}\\src\\a.ts`)
  })
})

describe('alignReportWithDisk — dire la vérité correspondant au verdict', () => {
  const report = {
    result: `Module créé : ${WT}\\src\\shared\\duree.ts`,
    phaseOutputs: [{ phase: 'build', text: `écrit ${WT}\\src\\shared\\duree.ts` }]
  }

  it('FUSIONNÉ : rapport ET sorties de phase pointent vers la base', () => {
    const aligned = alignReportWithDisk(report, WT, BASE, 'merged')
    expect(aligned.result).toContain(`${BASE}\\src\\shared\\duree.ts`)
    expect(aligned.result).not.toMatch(/worktrees/i)
    expect(aligned.phaseOutputs[0].text).not.toMatch(/worktrees/i)
  })

  it('CONSERVÉ : les chemins ne sont PAS touchés (ils existent) et on dit où', () => {
    const aligned = alignReportWithDisk(report, WT, BASE, 'kept')
    // Reecrire ici serait un MENSONGE : les fichiers sont dans la copie, pas dans la base.
    expect(aligned.result).toContain(WT)
    expect(aligned.result).toContain('NON fusionné')
    expect(aligned.result).toContain(WT)
  })

  it('la note « conservé » n’est pas ajoutée deux fois', () => {
    const once = alignReportWithDisk(report, WT, BASE, 'kept')
    const twice = alignReportWithDisk(once, WT, BASE, 'kept')
    expect(twice.result.match(/NON fusionné/g)).toHaveLength(1)
  })

  it('sans copie isolée (run de lecture), le rapport est rendu tel quel', () => {
    const aligned = alignReportWithDisk(report, undefined, BASE, 'merged')
    expect(aligned).toBe(report)
  })

  it('l’objet d’origine n’est JAMAIS muté (un autre lecteur peut l’avoir)', () => {
    const original = { result: `x ${WT}\\a.ts`, phaseOutputs: [{ phase: 'build', text: `y ${WT}\\a.ts` }] }
    const snapshot = JSON.stringify(original)
    alignReportWithDisk(original, WT, BASE, 'merged')
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  it('la note nomme le chemin exact où le travail attend', () => {
    expect(isolatedWorkNotice(WT)).toContain(WT)
  })
})

/**
 * CÂBLAGE — le module ne sert à rien s'il n'est pas appelé au bon MOMENT : après que la fin de run a
 * fusionné (ou non) la copie isolée. Ces tests échouent s'il redevient un module mort ou mal placé.
 */
describe('câblage — l’alignement a lieu APRÈS le verdict de fusion', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  const source = fs.readFileSync(path.join(__dirname, 'orchestrator.ts'), 'utf8')

  it('l’orchestrateur appelle bien l’alignement', () => {
    expect(source).toContain('alignReportWithDisk(')
  })

  it('il l’appelle APRÈS end() — sinon le verdict de fusion est encore inconnu', () => {
    const endIndex = source.indexOf('worktrees?.end(runId')
    const alignIndex = source.indexOf('alignReportWithDisk(')
    expect(endIndex).toBeGreaterThan(0)
    expect(alignIndex).toBeGreaterThan(endIndex)
  })

  it('le verdict vient du RETOUR de end(), pas d’une supposition sur `green`', () => {
    // Un run vert dont la fusion CONFLICTE ne doit pas voir ses chemins reecrits vers la base.
    expect(source).toContain("=== 'merged'")
    expect(source).toMatch(
      /const finalized = this\.deps\.worktrees\?\.endAsync[\s\S]{0,240}: this\.deps\.worktrees\?\.end\(runId, finalizeOptions\)/
    )
  })

  it('le rapport rendu est MUTÉ (réassigner la variable ne changerait pas la valeur retournée)', () => {
    expect(source).toContain('produced.result = aligned.result')
    expect(source).toContain('produced = result')
  })

  it('aucun alignement quand le run n’a pas de copie isolée', () => {
    expect(source).toContain('workCwd !== this.deps.executionWorkspace')
  })
})

/**
 * UNE INTÉGRATION DIFFÉRÉE N'EST PAS UNE INTÉGRATION RATÉE.
 *
 * Signalé par l'utilisateur le 2026-08-18 (« ça me met toujours ça quand je bosse dans Autowin OS »).
 * Mesuré sur son dépôt : les 24 copies isolées présentes sous `worktrees/` portaient TOUTES un commit
 * déjà ancêtre du HEAD de la base — 0 orpheline. L'avertissement « rien n'est publié » était donc faux
 * dans 100 % des cas observés. Cause : `blocked/base-in-progress` est RÉESSAYABLE (jusqu'à 6 reprises
 * côté coordinateur), mais l'orchestrateur le rangeait avec `kept` et écrivait un verdict définitif,
 * une seule fois, à la clôture. La reprise fusionnait ensuite sans que personne ne réécrive la phrase.
 */
describe('intégration différée ≠ intégration ratée', () => {
  const WT = 'C:\repo\.autowin-data\autowin-os\worktrees\h\agent__run-5ee1ad825286-1'
  const BASE = 'C:\repo'
  const report = { result: `Rapport. Fichier ${WT}\src\a.ts modifié.` }

  it('n’affirme PAS « rien n’est publié » quand une reprise est programmée', () => {
    const aligned = alignReportWithDisk(report, WT, BASE, 'pending')
    // La phrase exacte qui a menti 24 fois sur 24 ne doit plus pouvoir sortir sur ce cas.
    expect(aligned.result).not.toContain('NON fusionné')
    expect(aligned.result).not.toContain("rien n'est publié")
  })

  it('dit la vérité de l’instant : différée, reprise programmée, chemin nommé', () => {
    const aligned = alignReportWithDisk(report, WT, BASE, 'pending')
    expect(aligned.result).toMatch(/DIFFÉRÉE/)
    expect(aligned.result).toMatch(/reprise/i)
    expect(aligned.result).toContain(WT)
  })

  it('les chemins de la copie restent VALIDES : on ne les réécrit pas', () => {
    const aligned = alignReportWithDisk(report, WT, BASE, 'pending')
    expect(aligned.result).toContain(`${WT}\src\a.ts`)
  })

  it('la note différée n’est pas ajoutée deux fois', () => {
    const once = alignReportWithDisk(report, WT, BASE, 'pending')
    const twice = alignReportWithDisk(once, WT, BASE, 'pending')
    expect(twice.result.match(/DIFFÉRÉE/g)).toHaveLength(1)
  })

  it('un blocage DÉFINITIF garde bien l’avertissement dur — la nuance ne déborde pas', () => {
    const aligned = alignReportWithDisk(report, WT, BASE, 'kept')
    expect(aligned.result).toContain('NON fusionné')
    expect(aligned.result).not.toMatch(/DIFFÉRÉE/)
  })

  /** CÂBLAGE : le libellé ne sert à rien si l'orchestrateur ne distingue pas le cas. */
  it('l’orchestrateur mappe base-in-progress sur « pending », pas sur « kept »', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    const source = fs.readFileSync(path.join(__dirname, 'orchestrator.ts'), 'utf8')
    expect(source).toMatch(/'base-in-progress'/)
    expect(source).toMatch(/integrationDifferee \? 'pending' : 'kept'/)
    // L'ancien mapping binaire ne doit plus exister.
    expect(source).not.toMatch(/integrated \? 'merged' : 'kept'/)
  })
})
