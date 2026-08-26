import { describe, expect, it } from 'vitest'
import { decisionDeReutilisation } from './bureau-reutilisable'

/**
 * LE CHEMIN QUI DÉTRUIT DU TRAVAIL SUR UNE PANNE PASSAGÈRE, trouvé au cycle 2 de l'audit.
 *
 * `apercuTravauxNonPublies` enveloppe son `git diff --name-only` dans un `catch` muet qui laisse
 * `fichiers = []` et rend quand même l'entrée. Deux sauts plus loin, `identiteDeBureau`
 * (`commands.ts`) passe ces fichiers ici, et la toute première ligne répondait `reinitialiser` —
 * ce qui déclenche `discardHeldAsync`. Un bureau porteur de travail était donc JETÉ parce que git
 * n'avait pas répondu : index verrouillé par une session concurrente, dépôt occupé, timeout.
 *
 * Le commentaire du code le dit lui-même à propos de ce recyclage : « sans qu'aucun humain ne voie
 * rien ». C'est le pire des deux mondes — une perte silencieuse causée par une panne transitoire.
 *
 * « AUCUN FICHIER » ET « ON N'A PAS PU LIRE » NE SONT PAS LA MÊME CHOSE. Le premier autorise à
 * réinitialiser, le second impose de préserver. Confondre les deux, c'est exactement le défaut que
 * ce chantier tout entier répare, appliqué à sa propre plomberie.
 */

describe('une lecture qui a échoué ne vaut pas un bureau vide', () => {
  it('PRÉSERVE quand la lecture des fichiers a échoué', () => {
    expect(decisionDeReutilisation([], ['src/a.ts'], { lectureEchouee: true })).toBe('preserver')
  })

  it('réinitialise toujours un bureau RÉELLEMENT vide', () => {
    // L'autre bord : préserver systématiquement ferait grossir le stock pour rien.
    expect(decisionDeReutilisation([], ['src/a.ts'])).toBe('reinitialiser')
    expect(decisionDeReutilisation([], ['src/a.ts'], { lectureEchouee: false })).toBe(
      'reinitialiser'
    )
  })

  it('ne change rien aux décisions qui portent de vrais fichiers', () => {
    expect(decisionDeReutilisation(['src/a.ts'], ['src/a.ts'])).toBe('reinitialiser')
    expect(decisionDeReutilisation(['src/autre.ts'], ['src/a.ts'])).toBe('preserver')
  })
})
