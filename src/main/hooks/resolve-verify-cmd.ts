import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Résout la commande de vérification à REJOUER pour verify-replay, à partir de la commande de test
 * DÉCLARÉE par le projet (package.json → scripts.test) — une CONVENTION dérivée du workspace, jamais
 * devinée. Absente → undefined (verify-replay reste dormant, pas de faux-vert). Injectable (readPkg) → testable.
 */
export function resolveVerifyCmd(
  cwd: string,
  readPackageJson: (dir: string) => string | null = defaultReadPackageJson
): string | undefined {
  const raw = readPackageJson(cwd)
  if (!raw) return undefined
  try {
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    /**
     * On cherche le signal des TESTS, pas la porte de qualite complete.
     *
     * Constate en usage reel (2026-07-29) : ce projet a fait passer `test` a
     * `typecheck && vitest run && lint`. Le lint sortant en exit 1 sur 3219 warnings preexistants,
     * `verify` ne pouvait PLUS JAMAIS etre vert — l'agent, incapable de rien prouver, tournait en
     * rond puis revenait bredouille. Un outil de preuve qui ne peut pas conclure est pire qu'aucun.
     *
     * `verify` doit repondre a UNE question : « mon changement casse-t-il quelque chose ? ». C'est le
     * lanceur de tests qui y repond. On prefere donc un script de tests PUR quand le projet en declare
     * un, et on ne retombe sur `test` que s'il n'en existe pas.
     */
    for (const candidate of ['test:unit', 'test:run', 'tests']) {
      const declared = scripts[candidate]
      if (declared && declared.trim()) return `npm run ${candidate}`
    }
    const test = scripts.test
    if (!test || !test.trim()) return undefined
    // On lance le script déclaré via npm (pas le contenu brut) → respecte l'intention du projet.
    return 'npm test'
  } catch {
    return undefined
  }
}

function defaultReadPackageJson(dir: string): string | null {
  const p = join(dir, 'package.json')
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}
