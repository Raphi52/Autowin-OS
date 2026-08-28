/**
 * Hooks déterministes reproduits IN-APP (inspirés du kit `~/.claude/hooks`), pour que
 * l'orchestration Autowin ait le MÊME garde-fou hors-modèle quel que soit le provider :
 * l'enforcement vit dans du CODE déterministe, jamais dans le prompt. Fonctions PURES →
 * testables + branchables autour de la boucle agent (multi-phase) sans dépendre d'un modèle.
 */

export interface HookViolation {
  hook:
    | 'anti-flaky'
    | 'fix-gate'
    | 'done-without-proof'
    | 'visual-proof-missing'
    | 'motion-proof-missing'
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
  // L'index d'ORIGINE est capturé AVANT le filtrage : sinon le numéro rapporté est celui du tableau
  // filtré, qui ne désigne aucune ligne du diff dès qu'il contient du contexte, des suppressions ou
  // un en-tête — c'est-à-dire tout diff unifié réel. Un pointeur de violation qui envoie au mauvais
  // endroit est pire qu'une absence de pointeur.
  const added = diff
    .split(/\r?\n/)
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.startsWith('+') && !text.startsWith('+++'))
  added.forEach(({ text: raw, index }) => {
    const i = index
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
      out.push({
        hook: 'anti-flaky',
        line: i + 1,
        detail: `Thread.Sleep/Task.Delay ${threadSleep[1]}`
      })
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

/**
 * visual-proof : un diff qui touche le RENDU (fichiers de vue/composant/style du renderer) ne se
 * valide PAS par un exit-code de test unitaire — il exige une preuve VISUELLE observée (capture
 * réellement lue, cf. `scripts/ui-capture.mjs`). Kaizen du 2026-08-21 : le run « fond d'écran de
 * l'Accueil » est passé vert sur un test unitaire puis s'est fermé `degraded`, l'utilisateur ayant
 * dû constater lui-même le rendu. Fonction PURE ; opt-in via `requireVisualProof` (zéro régression
 * sur les runs qui ne touchent pas au rendu).
 */
const FRONT_RENDER_FILE = /^src\/renderer\/.*\.(?:tsx?|css|html)$/
export function requireVisualProofForFrontDiff(
  diff: string,
  visualProofOkCount: number
): HookViolation[] {
  const touched = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+++ '))
    .map((line) => line.replace(/^\+\+\+\s+(?:b\/)?/, '').trim())
    // Un fichier de TEST n'est pas du rendu : l'exiger rendrait le hook trop large et bloquerait
    // des diffs qui n'affichent rien.
    .filter((file) => !/\.(?:test|spec)\.[tj]sx?$/.test(file) && FRONT_RENDER_FILE.test(file))
  if (!touched.length || visualProofOkCount > 0) return []
  return [
    {
      hook: 'visual-proof-missing',
      detail: `rendu modifié sans preuve visuelle lue (${touched.join(', ')}) — capture attendue via scripts/ui-capture.mjs`
    }
  ]
}

/**
 * motion-proof : une capture FIXE satisfait `visual-proof` tout en etant aveugle a la seule chose
 * qu'un diff d'animation modifie — le mouvement. Mesure du 2026-08-28 (chantier « spinner »,
 * conv-1507 puis conv-1498) : l'animation a ete livree comme correcte sur un `tsc` vert et un PNG
 * immobile ; c'est l'utilisateur qui a du signaler « c'est cense bouger, la il est static », puis
 * refuter l'hypothese de cause qui a suivi. Le fil s'est arrete sans verdict.
 *
 * Un diff qui AJOUTE de l'animation exige donc une preuve d'un autre genre : `ui-capture --motion`,
 * qui mesure la fraction de pixels changeant entre frames, a la taille de rendu reelle.
 *
 * Deux bornes deliberees. Les lignes SUPPRIMEES sont ignorees — retirer une animation ne demande
 * pas de prouver qu'elle bouge. Les fichiers de TEST aussi : ils n'affichent rien. Fonction PURE ;
 * opt-in via `requireMotionProof`, zero regression sur les runs qui n'animent rien.
 */
const ANIMATION_AJOUTEE =
  /^\+(?!\+\+).*(?:@keyframes|animation\s*:|animation-name\s*:|transition\s*:)/
export function requireMotionProofForAnimationDiff(
  diff: string,
  motionProofOkCount: number
): HookViolation[] {
  const lignes = diff.split(/\r?\n/)
  const touched = new Set<string>()
  let fichier: string | undefined
  for (const ligne of lignes) {
    if (ligne.startsWith('+++ ')) {
      const nom = ligne.replace(/^\+\+\+\s+(?:b\/)?/, '').trim()
      fichier = /\.(?:test|spec)\.[tj]sx?$/.test(nom) ? undefined : nom
      continue
    }
    if (fichier && ANIMATION_AJOUTEE.test(ligne)) touched.add(fichier)
  }
  if (touched.size === 0 || motionProofOkCount > 0) return []
  return [
    {
      hook: 'motion-proof-missing',
      detail:
        `animation modifiee sans preuve de MOUVEMENT (${[...touched].join(', ')}) — une capture ` +
        `fixe ne peut pas dire si ca tourne ; mesure attendue via ` +
        `node scripts/ui-capture.mjs --view <vue> --motion <selecteur CSS> --out <png>`
    }
  ]
}

/** Agrège tous les hooks ; retourne les violations (vide = laisser passer). */
export function runHooks(input: {
  producedDiff?: string
  editsByFile?: Record<string, number>
  causeTokensByFile?: Record<string, boolean>
  evidenceOkCount?: number
  requireProof?: boolean
  requireVisualProof?: boolean
  visualProofOkCount?: number
  requireMotionProof?: boolean
  motionProofOkCount?: number
}): HookViolation[] {
  const v: HookViolation[] = []
  if (input.producedDiff) v.push(...detectRawSleep(input.producedDiff))
  if (input.editsByFile) v.push(...detectBlindFixLoop(input.editsByFile, input.causeTokensByFile))
  if (input.requireProof) v.push(...requireProofBeforeGreen(input.evidenceOkCount ?? 0))
  if (input.requireVisualProof && input.producedDiff)
    v.push(...requireVisualProofForFrontDiff(input.producedDiff, input.visualProofOkCount ?? 0))
  if (input.requireMotionProof && input.producedDiff)
    v.push(...requireMotionProofForAnimationDiff(input.producedDiff, input.motionProofOkCount ?? 0))
  return v
}
