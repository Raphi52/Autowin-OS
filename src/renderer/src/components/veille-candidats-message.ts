/**
 * CANDIDATS DANS UN MESSAGE DE SCOUT → panneau de sélection natif.
 *
 * Demande utilisateur du 2026-08-14 : le rendu du scout doit être « accompagné de checkbox et d'un
 * bouton qui frame les lignes sélectionnées ». Le HTML du modèle ne peut pas porter ces contrôles
 * (le sanitizeur refuse volontairement input/button — anti-hameçonnage) : c'est donc l'APP qui les
 * rend, en détectant la charge utile JSON que le scout termine toujours par (bloc ```json).
 *
 * Module PUR : détection + rédaction du prompt, testables sans React.
 */

export interface CandidatAffiche {
  titre: string
  /** Ancrage interne `src/...:ligne` ou URL web — affiché tel quel, jamais réécrit. */
  url: string
  citation?: string
  pertinence?: number
  type?: string
  dateSource?: string
  langue?: string
  what?: string
  why?: string
  how?: string
}

/**
 * Extrait les candidats d'un texte de message. On ne détecte QUE la forme émise par les scouts :
 * un tableau JSON d'objets portant au moins `titre` et `url`. Un JSON cassé ou d'une autre forme
 * rend `undefined` — ce panneau est un bonus, jamais une raison d'échouer un rendu.
 */
export function extraireCandidatsAffiches(texte: string): CandidatAffiche[] | undefined {
  const debut = texte.indexOf('[')
  const fin = texte.lastIndexOf(']')
  if (debut < 0 || fin <= debut) return undefined
  let valeur: unknown
  try {
    valeur = JSON.parse(texte.slice(debut, fin + 1))
  } catch {
    return undefined
  }
  if (!Array.isArray(valeur) || valeur.length === 0) return undefined
  const candidats: CandidatAffiche[] = []
  for (const brut of valeur) {
    if (!brut || typeof brut !== 'object') return undefined
    const objet = brut as Record<string, unknown>
    if (typeof objet.titre !== 'string' || !objet.titre.trim()) return undefined
    if (typeof objet.url !== 'string' || !objet.url.trim()) return undefined
    candidats.push({
      titre: objet.titre.trim(),
      url: objet.url.trim(),
      ...(typeof objet.citation === 'string' && objet.citation.trim()
        ? { citation: objet.citation.trim() }
        : {}),
      ...(typeof objet.pertinence === 'number' && Number.isFinite(objet.pertinence)
        ? { pertinence: objet.pertinence }
        : {}),
      ...(typeof objet.type === 'string' && objet.type.trim() ? { type: objet.type.trim() } : {}),
      ...(typeof objet.dateSource === 'string' && objet.dateSource.trim()
        ? { dateSource: objet.dateSource.trim() }
        : {}),
      ...(typeof objet.langue === 'string' && objet.langue.trim()
        ? { langue: objet.langue.trim() }
        : {}),
      ...(typeof objet.what === 'string' && objet.what.trim() ? { what: objet.what.trim() } : {}),
      ...(typeof objet.why === 'string' && objet.why.trim() ? { why: objet.why.trim() } : {}),
      ...(typeof objet.how === 'string' && objet.how.trim() ? { how: objet.how.trim() } : {})
    })
  }
  return candidats
}

/**
 * Le prompt « parfait » pour enchaîner : /frame sur LA SÉLECTION, avec les ancrages et preuves,
 * et la consigne d'aller jusqu'au commit publié — le même contrat que les campagnes.
 */
export function redigerPromptFrameSelection(selection: readonly CandidatAffiche[]): string {
  const lignes = selection.map((candidat, index) => {
    const morceaux = [`${index + 1}. ${candidat.titre} — ancrage ${candidat.url}`]
    if (candidat.citation) morceaux.push(`preuve : « ${candidat.citation} »`)
    if (candidat.pertinence !== undefined) morceaux.push(`pertinence ${candidat.pertinence}/100`)
    return morceaux.join(' — ')
  })
  return [
    selection.length > 1
      ? `/frame Traite ENSEMBLE ces ${selection.length} candidats issus du scout interne d'Autowin :`
      : `/frame Traite ce candidat issu du scout interne d'Autowin :`,
    '',
    ...lignes,
    '',
    'Commence par relire chaque ancrage et vérifier que le besoin tient toujours. Puis enchaîne le',
    'workflow complet (frame → terrain → build → clean → judge) jusqu’au COMMIT PUBLIÉ, ou rends un',
    'échec franc — pas de demi-mesure.'
  ].join('\n')
}

/**
 * Le même texte SANS la charge utile JSON (et sa clôture de fence) : une fois le panneau de
 * sélection affiché, le pavé brut ferait doublon — c'est une charge machine, pas une lecture.
 */
export function texteSansChargeJson(texte: string): string {
  const debut = texte.indexOf('[')
  const fin = texte.lastIndexOf(']')
  if (debut < 0 || fin <= debut) return texte
  const avant = texte.slice(0, debut).replace(/```(?:json)?\s*$/i, '')
  const apres = texte.slice(fin + 1).replace(/^\s*```/, '')
  return `${avant.trimEnd()}
${apres.trimStart()}`.trim()
}

/** L'emoji de nature, affiché dans la barre du candidat sans avoir à déplier. */
export function emojiType(type: string | undefined): string {
  if (type === 'correction') return '🔧'
  if (type === 'ajout') return '🆕'
  return '❔'
}
