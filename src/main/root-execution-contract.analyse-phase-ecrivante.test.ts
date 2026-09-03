import { describe, expect, it } from 'vitest'
import { ROOT_DOD, etatDeCloture, rootRequirementChecks } from './root-execution-contract'
import { evaluateClosure } from './gates/stopgate'
import type { ExecutionEvidence } from './providers/types'

/**
 * Defaut MESURE le 2026-09-03 (run-90383ebef541-1, conv-21) : six reparations d'affilee bloquees par
 * « Promis mais pas fait : "Analyse demandee presente dans le livrable" », verdict de juge VIDE.
 *
 * Etat reel du run, lu dans `.autowin-data/autowin-os/run-state/run-90383ebef541-1.json` :
 *   phaseOutputs = build:6962c | build:9803c | build:6367c | build:4607c | build:6233c | build:5183c
 * Six phases `build`, aucune autre. Or `rootRequirementChecks` n'acceptait le texte QUE d'une phase
 * `noeudSansEcriture` (scout/frame/terrain ou noeud skill). `build` ecrit, donc la case etait
 * structurellement INCOCHABLE : aucune longueur, aucune qualite d'analyse ne pouvait la cocher.
 *
 * C'est exactement la pathologie deja documentee dans ce fichier pour la MUTATION (« exigence
 * structurellement insatisfaisable, donc rouge a chaque fois », 2026-08-18) — ici en miroir, et le
 * commentaire de `rootExecutionRequirements` l'annonce pourtant noir sur blanc : « L'ANALYSE, elle,
 * reste due : il peut la tenir. » Elle ne pouvait PAS la tenir.
 *
 * L'analyse vit dans le TEXTE du livrable ; quelle phase l'a produit ne change rien. Le gate ne juge
 * pas son CONTENU (c'est le travail du juge), il constate qu'un livrable textuel existe.
 */
const TACHE_REELLE =
  'Cherche toutes les variables CSS appelees mais jamais definies dans le projet, et corrige-les.'

function analyseCochee(phases: Array<{ phase: string; text?: string }>): boolean {
  const check = rootRequirementChecks(TACHE_REELLE, { phases }).find(
    (item) => item.label === ROOT_DOD.analysis
  )
  expect(check, 'la case Analyse doit etre semee par cette tache').toBeDefined()
  return check!.checked
}

describe('case « Analyse » — une phase qui ECRIT peut la porter', () => {
  it("la tache reelle seme bien l'obligation d'analyse", () => {
    expect(
      rootRequirementChecks(TACHE_REELLE, { phases: [] }).map((c) => c.label)
    ).toContain(ROOT_DOD.analysis)
  })

  // L'ENTREE QUI DOIT FAIRE ROUGIR : l'etat exact du run bloque six fois.
  it('ROUGE AVANT CORRECTION : six phases build porteuses de texte cochent la case', () => {
    const phasesDuRunBloque = [6962, 9803, 6367, 4607, 6233, 5183].map((taille) => ({
      phase: 'build',
      text: 'x'.repeat(taille)
    }))
    expect(analyseCochee(phasesDuRunBloque)).toBe(true)
  })

  it('une seule phase build avec un livrable textuel suffit', () => {
    expect(analyseCochee([{ phase: 'build', text: "l'analyse demandee, en clair" }])).toBe(true)
  })

  // FALSIFICATEUR n°1 — l'entree qui prend en faute une correction TROP PERMISSIVE (`checked: true`
  // en dur, ou un `some` qui ne regarde plus le texte). Sans elle, la case ne prouverait plus rien.
  it('une phase build SANS livrable textuel ne coche PAS', () => {
    expect(analyseCochee([{ phase: 'build', text: '   \n\t ' }])).toBe(false)
    expect(analyseCochee([{ phase: 'build' }])).toBe(false)
  })

  // FALSIFICATEUR n°2 — aucun run n'est blanchi par defaut : sans phase, rien n'est acquis.
  it('aucune phase jouee ne coche PAS', () => {
    expect(analyseCochee([])).toBe(false)
  })

  // NON-REGRESSION — l'acquis du 2026-08-18 (scout/frame/terrain et noeuds skill) reste vrai.
  it('les phases de lecture et les noeuds skill continuent de cocher', () => {
    for (const phase of ['scout', 'frame', 'terrain', 'think', 'learn']) {
      expect(analyseCochee([{ phase, text: 'livrable' }]), phase).toBe(true)
    }
  })

  // FALSIFICATEUR n°3 — le plus important, et celui qui a pris ma PREMIERE correction en faute.
  //
  // Un `some` sur tout texte, toutes phases confondues, cassait deux tests qui encodent une
  // intention DOCUMENTEE, pas un accident :
  //   - `conv-runs.dod-honnete.test.ts:122` « ne confond ni une phase scout vide ni un lint avec les
  //     livrables demandes » : `scout` joue mais MUET + `build` avec texte -> analyse NON cochee.
  //   - `root-execution-contract.lecture-seule.test.ts:142` « une phase de lecture MUETTE ne coche
  //     rien (pas de blanchiment par la forme) ».
  // Quand le run a JOUE une phase d'analyse, c'est ELLE qui doit rendre l'analyse : le texte d'une
  // phase d'ecriture ne la blanchit pas. Ce n'est que lorsque le run n'a joue AUCUNE phase d'analyse
  // que le livrable textuel d'une phase ecrivante la porte — sinon l'exigence est insatisfaisable.
  it('une phase de lecture JOUEE mais muette n’est PAS blanchie par le texte du build', () => {
    expect(analyseCochee([{ phase: 'scout', text: '   ' }, { phase: 'build', text: 'analyse' }])).toBe(
      false
    )
    expect(analyseCochee([{ phase: 'frame', text: '' }, { phase: 'build', text: 'analyse' }])).toBe(
      false
    )
  })

  it('une phase de lecture qui a PARLE coche, meme accompagnee d’un build', () => {
    expect(
      analyseCochee([{ phase: 'frame', text: 'le cadrage' }, { phase: 'build', text: 'le code' }])
    ).toBe(true)
  })
})

/**
 * PREUVE DE BOUT EN BOUT — on ne se contente pas du predicat, on rejoue le CONTROLE FINAL sur
 * l'etat exact du run bloque, tel qu'il est persiste sur disque.
 *
 * Chaine reelle : `orchestrator.ts:4657` appelle `etatDeCloture`, dont la `dod` alimente
 * `evaluateClosure` (`src/main/gates/stopgate.ts:242`), qui produit le message
 * « Promis mais pas fait : "…" » lu six fois par l'utilisateur.
 */
describe('controle final rejoue sur l’etat reel de run-90383ebef541-1', () => {
  const TEXTES = [6962, 9803, 6367, 4607, 6233, 5183]
  const preuveDeMutation: ExecutionEvidence[] = [
    {
      type: 'file_change',
      kind: 'mutation',
      status: 'completed',
      ok: true,
      summary: 'src/renderer/src/components/DomainShell.css'
    } as ExecutionEvidence
  ]

  function rejoue(textes: number[]) {
    const phases = textes.map((taille, index) => ({
      phase: 'build',
      text: 'x'.repeat(taille),
      ...(index === 0 ? { executionEvidence: preuveDeMutation } : {})
    }))
    const cloture = etatDeCloture(TACHE_REELLE, phases, true, true)
    // Raccord REEL, copie de `orchestrator.ts:4667` : le pre-gate marque chaque case `hasContent`.
    // Sans ce `map`, `evaluateClosure` ignore les cases (`hasContent` undefined) et ne bloque
    // JAMAIS — mon premier jet de ce test simulait donc une chaine qui n'existe pas, et son
    // falsificateur passait au vert pour la mauvaise raison.
    return {
      cloture,
      gate: evaluateClosure({
        status: cloture.status,
        dod: cloture.dod.map((check) => ({ ...check, hasContent: true }))
      })
    }
  }

  it('ne bloque PLUS : la case Analyse est cochee et le controle final passe', () => {
    const { cloture, gate } = rejoue(TEXTES)
    expect(cloture.dod.find((d) => d.label === ROOT_DOD.analysis)?.checked).toBe(true)
    expect(cloture.status).toBe('green')
    expect(gate.reasons).toEqual([])
    expect(gate.blocked).toBe(false)
  })

  // L'ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : les six memes phases,
  // mais SANS livrable. Le controle final doit alors reprendre son refus, avec son message exact.
  // Sans cette entree, « ne bloque plus » serait indistinguable d'un gate desarme.
  it('bloque TOUJOURS si les six phases n’ont rien rendu', () => {
    const { cloture, gate } = rejoue([0, 0, 0, 0, 0, 0])
    expect(cloture.dod.find((d) => d.label === ROOT_DOD.analysis)?.checked).toBe(false)
    expect(gate.blocked).toBe(true)
    expect(gate.reasons).toContain(`Promis mais pas fait : « ${ROOT_DOD.analysis} ».`)
  })
})
