import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GARDE SUR L'ORDRE DES BLOCS SYSTEME — le levier de cache le plus rentable du dépôt, et le plus
 * facile à défaire par accident lors d'un refactor.
 *
 * Le cache de préfixe d'un provider s'arrête au PREMIER octet qui diffère. Un bloc invariant placé
 * APRÈS un bloc variable n'est donc jamais réutilisé, même s'il est rigoureusement identique d'un
 * appel à l'autre. L'ordre de concaténation n'est pas du style : il décide combien de tokens sont
 * re-payés à chaque appel.
 *
 * LE DÉFAUT EXACT QUI EXISTAIT, mesuré le 2026-08-11 sur 688 appels réels (`prompt-observability`) :
 * `this.phasePrompt(phase)` — qui change à chaque phase — était écrit IMMÉDIATEMENT après
 * `{ name: 'constitution', text: CONSTITUTION }`, à quatre sites. Tout ce qui suivait (`discipline`,
 * `style`, `workflowTool`, `projectContext` — constants ou constants par workspace) tombait derrière
 * un bloc variable : le préfixe cachable se réduisait au seul `CONSTITUTION`. Résultat : acteur
 * `subagent` à 55,4 % de cache (243 431 485 tokens d'entrée NON cachés), acteur `judge` à 10,6 %.
 *
 * FORME DE LA GARDE, et pourquoi celle-ci : une première version tentait de découper les tableaux de
 * blocs pour vérifier l'ordre complet. Elle produisait des échecs impossibles à distinguer d'artefacts
 * de découpage — une garde dont on ne sait pas si elle dit vrai est pire que pas de garde. Celle-ci
 * n'affirme qu'UNE chose, mais elle l'affirme sans ambiguïté : la consigne de phase ne revient jamais
 * coller la constitution. C'est précisément la régression à empêcher.
 *
 * LIMITE ASSUMÉE : ceci vérifie l'ORDRE ÉCRIT, pas le taux de cache obtenu. Le taux se mesure sur un
 * run réel avec `measure-cache.ps1` (épinglé `provider=claude, model=claude-opus-5`, seul chemin où
 * `cacheReadTokens` est peuplé) et n'est PAS prouvé par ce test.
 */
describe('ordre des blocs système — préfixe cachable', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'main', 'orchestrator.ts'), 'utf8')
  const ANCRE = 'text: CONSTITUTION }'

  const positions: number[] = []
  for (let i = source.indexOf(ANCRE); i !== -1; i = source.indexOf(ANCRE, i + 1)) {
    positions.push(i)
  }

  it('trouve les sites à garder — une garde qui ne trouve plus sa cible doit CRIER', () => {
    // Si un refactor renomme ou déplace ces assemblages, ce test tombe AVANT les suivants, au lieu
    // de passer au vert en silence sur un fichier qu'il ne surveille plus.
    expect(positions.length).toBeGreaterThanOrEqual(3)
  })

  for (const [index, position] of positions.entries()) {
    it(`site ${index + 1} : la consigne de phase ne colle PAS la constitution`, () => {
      // Fenêtre volontairement courte : on ne juge que le voisinage immédiat, donc aucune dépendance
      // à un découpage d'expression. `phasePrompt` a le droit d'être plus loin — pas juste après.
      const voisinage = source.slice(position, position + 260)
      const phase = voisinage.indexOf('this.phasePrompt(')
      if (phase === -1) return // ce site ne porte pas de consigne de phase : rien à garder ici

      const constantsAvant = [
        'PIPELINE_DISCIPLINE_INSTRUCTION',
        'STYLE_TON'
      ].filter((nom) => {
        const p = voisinage.indexOf(nom)
        return p !== -1 && p < phase
      })

      expect(
        constantsAvant.length,
        `this.phasePrompt() est écrit juste après CONSTITUTION sans qu'aucun bloc constant ne s'intercale. Les blocs constants qui suivent ne seront jamais réutilisés par le cache de préfixe, puisque la consigne de phase change à chaque phase. Ordre attendu : constitution -> discipline -> style -> workflowTool -> projectContext -> phasePrompt -> workspaceIsolation.`
      ).toBeGreaterThanOrEqual(1)
    })
  }

  it('le chemin session-resume place aussi le bloc constant avant la consigne de phase', () => {
    const debut = source.indexOf('const parts = resuming')
    expect(debut).toBeGreaterThan(-1)
    // Branche `resuming` uniquement : elle s'arrête au `: [` qui ouvre la branche complète.
    const branche = source.slice(debut, source.indexOf(': [', debut))
    const phase = branche.indexOf('this.phasePrompt(')
    const style = branche.indexOf('STYLE_TON')
    expect(phase).toBeGreaterThan(-1)
    expect(style).toBeGreaterThan(-1)
    expect(
      style,
      'En session-resume, seuls le style et la consigne de phase sont renvoyés : mettre le style constant DEVANT la phase variable est la seule façon de conserver un préfixe réutilisable.'
    ).toBeLessThan(phase)
  })
})
