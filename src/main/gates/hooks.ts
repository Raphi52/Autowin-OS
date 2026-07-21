/**
 * Hooks déterministes reproduits IN-APP (inspirés du kit `~/.claude/hooks`), pour que
 * l'orchestration Autowin ait le MÊME garde-fou hors-modèle quel que soit le provider :
 * l'enforcement vit dans du CODE déterministe, jamais dans le prompt. Fonctions PURES →
 * testables + branchables autour de la boucle agent (multi-phase) sans dépendre d'un modèle.
 */

export interface HookViolation {
  hook: 'anti-flaky' | 'fix-gate' | 'done-without-proof'
  line?: number
  detail: string
}

/**
 * anti-flaky : un diff PRODUIT ne doit pas introduire de sleep brut (source de tests flaky).
 * Réplique la logique de `anti-flaky.ps1` : Start-Sleep -Seconds/-s/positionnel ≥2,
 * -Milliseconds ≥1000, Thread.Sleep / Task.Delay à ≥4 chiffres. Échappe : ligne portant `sleep-ok:`.
 */
export function detectRawSleep(diff: string): HookViolation[] {
  const out: HookViolation[] = []
  const added = diff.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++'))
  added.forEach((raw, i) => {
    const line = raw.slice(1)
    if (/sleep-ok:/i.test(line)) return
    const startSleepSecs = /Start-Sleep\s+(?:-Seconds|-s\b)?\s*(\d+)/i.exec(line)
    const startSleepMs = /Start-Sleep\s+-Milliseconds\s+(\d+)/i.exec(line)
    const threadSleep = /(?:Thread\.Sleep|Task\.Delay)\s*\(\s*(\d{4,})/i.exec(line)
    if (startSleepSecs && Number(startSleepSecs[1]) >= 2)
      out.push({ hook: 'anti-flaky', line: i + 1, detail: `Start-Sleep ${startSleepSecs[1]}s` })
    else if (startSleepMs && Number(startSleepMs[1]) >= 1000)
      out.push({ hook: 'anti-flaky', line: i + 1, detail: `Start-Sleep ${startSleepMs[1]}ms` })
    else if (threadSleep)
      out.push({ hook: 'anti-flaky', line: i + 1, detail: `Thread.Sleep/Task.Delay ${threadSleep[1]}` })
  })
  return out
}

/**
 * fix-gate : édits répétés (≥ seuil) du MÊME fichier sans jeton de cause vérifiée = boucle de
 * fix aveugle → block. Réplique `fix-gate.ps1`. `causeTokens` = jetons observés cette session
 * (CausalHypothesis / fix-ok / check:).
 */
export function detectBlindFixLoop(
  editsByFile: Record<string, number>,
  causeTokensByFile: Record<string, boolean> = {},
  threshold = 3
): HookViolation[] {
  return Object.entries(editsByFile)
    .filter(([file, count]) => count >= threshold && !causeTokensByFile[file])
    .map(([file, count]) => ({
      hook: 'fix-gate' as const,
      detail: `${count} édits de ${file} sans cause vérifiée (CausalHypothesis/fix-ok/check:)`
    }))
}

/**
 * done-without-proof : on ne passe pas « vert » sans preuve d'exécution hors-modèle observée
 * (au moins une evidence ok). Réplique l'esprit du stop-gate (le juge/gate exige une preuve).
 */
export function requireProofBeforeGreen(evidenceOkCount: number): HookViolation[] {
  return evidenceOkCount > 0
    ? []
    : [{ hook: 'done-without-proof', detail: 'aucune preuve d’exécution ok — green refusé' }]
}

/** Agrège tous les hooks ; retourne les violations (vide = laisser passer). */
export function runHooks(input: {
  producedDiff?: string
  editsByFile?: Record<string, number>
  causeTokensByFile?: Record<string, boolean>
  evidenceOkCount?: number
  requireProof?: boolean
}): HookViolation[] {
  const v: HookViolation[] = []
  if (input.producedDiff) v.push(...detectRawSleep(input.producedDiff))
  if (input.editsByFile)
    v.push(...detectBlindFixLoop(input.editsByFile, input.causeTokensByFile))
  if (input.requireProof) v.push(...requireProofBeforeGreen(input.evidenceOkCount ?? 0))
  return v
}
