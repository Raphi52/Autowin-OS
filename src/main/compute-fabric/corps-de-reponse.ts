/**
 * Libère le corps d'une réponse refusée. Module à part du client HTTP : ses tests remplacent le
 * transport par une imitation, et cette aide n'en fait pas partie.
 */
export async function cancelBody(response: Response, reason: string): Promise<void> {
  try {
    await response.body?.cancel(reason)
  } catch {
    // L'erreur d'origine (validation ou protocole) reste celle qui fait foi.
  }
}
