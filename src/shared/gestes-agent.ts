/**
 * LES GESTES PROPRES DE L'AGENT — lectures, commandes, éditions faites par le modèle lui-même.
 *
 * Ni la trace causale ni les messages enregistrés ne les gardent (seulement les commandes d'Autowin).
 * Le journal de la demande (`turn-journals/<conversation>/<demande>.jsonl`) porte en revanche une
 * ligne d'état par geste terminé : `{"kind":"provider-status","text":"Read terminé - 3 s"}`.
 * Mesuré le 2026-10-12 sur conv-904, conv-906 et conv-903 : « Bash terminé » 312 fois, « Read
 * terminé » 186, « Edit terminé » 79, « Bash échoué » 6. Une ligne « Read · chemin » marque le DÉBUT
 * d'un geste et n'est pas comptée : seul un geste fini a une issue et une durée.
 *
 * Partagé par l'app (qui résume tous les journaux d'une conversation en un appel) et par l'écran.
 */

/** « Read terminé - 3 s », « Bash échoué - 12,5 s ». Les commandes d'Autowin (`mcp__…`) sont exclues. */
const LIGNE_DE_GESTE = /^([A-Za-z][\w-]*) (terminé|échoué) - (\d+(?:[.,]\d+)?) s$/

export interface GesteAgent {
  nom: string
  ok: boolean
  dureeMs: number
}

/** Compte des gestes d'un nom : `Read` → 4 lectures, dont 0 en échec, 2,1 s au total. */
export interface CompteDeGeste {
  nombre: number
  echecs: number
  dureeMs: number
}

/** Gestes d'une demande, par nom d'outil. */
export type GestesDuTour = Record<string, CompteDeGeste>

/** Gestes de chaque demande d'une conversation, par identifiant de demande. */
export type GestesDesTours = Record<string, GestesDuTour>

/** Le geste fini qu'annonce une ligne d'état, ou rien si la ligne n'en annonce pas. */
export function gesteDeLaLigne(texte: unknown): GesteAgent | undefined {
  if (typeof texte !== 'string') return undefined
  const ligne = LIGNE_DE_GESTE.exec(texte.trim())
  if (!ligne || ligne[1].startsWith('mcp__')) return undefined
  return {
    nom: ligne[1],
    ok: ligne[2] === 'terminé',
    dureeMs: Math.round(Number(ligne[3].replace(',', '.')) * 1000)
  }
}

/** Ajoute un geste au compte d'une demande (mute `gestes`, rend le même objet). */
export function compterGeste(gestes: GestesDuTour, geste: GesteAgent): GestesDuTour {
  const compte = gestes[geste.nom] ?? { nombre: 0, echecs: 0, dureeMs: 0 }
  compte.nombre += 1
  if (!geste.ok) compte.echecs += 1
  compte.dureeMs += geste.dureeMs
  gestes[geste.nom] = compte
  return gestes
}

/** Gestes d'une suite d'événements de journal déjà lus. */
export function gestesDesEvenements(
  evenements: ReadonlyArray<Record<string, unknown>>
): GestesDuTour {
  const gestes: GestesDuTour = {}
  for (const evenement of evenements) {
    if (evenement.kind !== 'provider-status') continue
    const geste = gesteDeLaLigne(evenement.text)
    if (geste) compterGeste(gestes, geste)
  }
  return gestes
}

/**
 * Gestes d'un journal BRUT (texte JSONL). Seules les lignes qui portent `provider-status` sont
 * décodées : un journal de 300 Ko est fait à 95 % de fragments de pensée qu'il est inutile de parser.
 */
export function gestesDuTexte(texte: string): GestesDuTour {
  const gestes: GestesDuTour = {}
  for (const ligne of texte.split('\n')) {
    if (!ligne.includes('"provider-status"')) continue
    try {
      const evenement = JSON.parse(ligne) as Record<string, unknown>
      if (evenement?.kind !== 'provider-status') continue
      const geste = gesteDeLaLigne(evenement.text)
      if (geste) compterGeste(gestes, geste)
    } catch {
      // ligne tronquée par un crash : on saute, le reste du journal reste exploitable
    }
  }
  return gestes
}

/** Somme de deux comptes de demande, sans muter les entrées. */
export function fusionnerGestes(a: GestesDuTour, b: GestesDuTour): GestesDuTour {
  const somme: GestesDuTour = {}
  for (const source of [a, b])
    for (const [nom, compte] of Object.entries(source)) {
      const cumul = somme[nom] ?? { nombre: 0, echecs: 0, dureeMs: 0 }
      somme[nom] = {
        nombre: cumul.nombre + compte.nombre,
        echecs: cumul.echecs + compte.echecs,
        dureeMs: cumul.dureeMs + compte.dureeMs
      }
    }
  return somme
}
