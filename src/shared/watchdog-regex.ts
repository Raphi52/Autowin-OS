const MAX_PATTERN_LENGTH = 500

/**
 * The watchdog matcher runs in Electron's main process, where a backtracking expression can freeze
 * the whole application. Keep the accepted language deliberately small: alternation, anchors,
 * character classes and anchors cover log matching without admitting any repetition. JavaScript's
 * backtracking engine has pathological cases even with one quantifier plus a long suffix, so a
 * quantifier is never executed in Electron's main process.
 */
export function watchdogRegexProblem(pattern: string): string | undefined {
  if (!pattern.trim()) return 'Expression vide.'
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `Expression trop longue (${MAX_PATTERN_LENGTH} caractères max).`
  }
  try {
    new RegExp(pattern)
  } catch {
    return 'Expression régulière invalide.'
  }

  let escaped = false
  let inClass = false
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (escaped) {
      if (!inClass && /[1-9]/.test(char)) return 'Les références arrière sont interdites.'
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '[') {
      inClass = true
      continue
    }
    if (char === ']' && inClass) {
      inClass = false
      continue
    }
    if (inClass) continue
    if (char === '(' || char === ')') return 'Les groupes sont interdits dans une règle watchdog.'
    if (char === '*' || char === '+' || char === '?' || char === '{') {
      return 'Les répétitions sont interdites dans une règle watchdog.'
    }
  }
  return undefined
}

export function isSafeWatchdogRegex(pattern: string): boolean {
  return watchdogRegexProblem(pattern) === undefined
}
