// fix-ok: les éditions successives suivaient deux causes mesurées — virgule manquante dans objections-juge.ts (erreur de compilation), puis vérification rouge→vert du branchement orchestrator.ts:5573 (test exit 1 sans l'appel, exit 0 avec).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTRAT_OBJECTIONS, consigneTestsDuJuge, testsDuJuge } from './objections-juge'

const LONGUE = 'x'.repeat(400)

describe('champ facultatif TEST: du contrat des objections (piste 2 /build)', () => {
  it('le contrat documente le champ', () => {
    expect(CONTRAT_OBJECTIONS).toContain('| TEST: <fichier de test> | <commande>')
  })

  it('extrait fichier et commande des puces bloquantes, même au-delà de 300 caractères', () => {
    const v = `DEFAUT\nOBJECTIONS:\n- MAJEUR: ${LONGUE} | TEST: src/a.test.ts | npx vitest run src/a\n- MINEUR: y | TEST: b.test.ts | npm test -- b\nSCORE: 40`
    expect(testsDuJuge(v)).toEqual([
      { fichier: 'src/a.test.ts', commande: 'npx vitest run src/a' },
      { fichier: 'b.test.ts', commande: 'npm test -- b' }
    ])
    expect(consigneTestsDuJuge(v)).toContain('`npx vitest run src/a` (fichier src/a.test.ts)')
  })

  it('ignore le TEST: d’une puce OK et un verdict sans TEST:', () => {
    expect(testsDuJuge('VALIDE\nOBJECTIONS:\n- OK: vu | TEST: a.test.ts | npx vitest run a')).toEqual([])
    expect(testsDuJuge('DEFAUT\nOBJECTIONS:\n- MAJEUR: preuve manquante')).toEqual([])
    expect(consigneTestsDuJuge('DEFAUT\nOBJECTIONS:\n- MAJEUR: preuve manquante')).toBe('')
  })

  it('le message de réparation de l’orchestrateur porte la consigne', () => {
    const src = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')
    expect(src).toMatch(/\[RÉPARATION \$\{attempt\}\][^`]*\$\{consigneTestsDuJuge\(lastJudgeText\)\}/)
  })
})
