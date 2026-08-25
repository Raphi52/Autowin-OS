import { describe, expect, it } from 'vitest'
import { etatDuMoteur, messageMoteurPerime } from './moteur-perime'

/**
 * LE DÉFAUT, mesuré le 2026-08-25, deux fois dans la même journée.
 *
 * En développement, `electron-vite dev` construit le processus PRINCIPAL une seule fois : une
 * correction dans `src/main/**` reste invisible dans l'application qui tourne. Mesure directe : un
 * fichier de `src/main` touché, `out/main/index.js` JAMAIS reconstruit après 75 s. Le rechargement à
 * chaud du RENDERER, lui, marche — d'où le piège : l'interface bouge, le moteur non, rien ne le dit.
 *
 * Deux conclusions fausses ont été tirées ce jour-là d'un binaire périmé avant que la mesure ne
 * rétablisse les faits. Le correctif n'est PAS de redémarrer tout seul (`--watch` a déjà été essayé
 * et tuait l'app pendant le travail — `dev-sans-watch.test.ts`), mais de rendre l'état VISIBLE.
 */

const MINUTE = 60_000

describe('le moteur qui tourne est-il encore celui des sources', () => {
  it('signale une source écrite APRÈS le démarrage — le cas mesuré', () => {
    const demarrage = 1_000_000
    const etat = etatDuMoteur(demarrage, [
      { chemin: 'src/main/agent-pilot.ts', modifieeMs: demarrage + 10 * MINUTE }
    ])

    expect(etat.perime).toBe(true)
    expect(etat.fichier).toBe('src/main/agent-pilot.ts')
  })

  it('NOMME la source la plus récente, pas la première venue', () => {
    // Nommer, pas compter : « une source est plus récente » n'envoie chercher nulle part.
    const demarrage = 1_000_000
    const etat = etatDuMoteur(demarrage, [
      { chemin: 'src/main/vieux.ts', modifieeMs: demarrage + 3 * MINUTE },
      { chemin: 'src/main/recent.ts', modifieeMs: demarrage + 9 * MINUTE },
      { chemin: 'src/main/moyen.ts', modifieeMs: demarrage + 5 * MINUTE }
    ])

    expect(etat.fichier).toBe('src/main/recent.ts')
  })

  it('ne signale RIEN quand les sources sont antérieures au démarrage', () => {
    const demarrage = 1_000_000
    const etat = etatDuMoteur(demarrage, [
      { chemin: 'src/main/agent-pilot.ts', modifieeMs: demarrage - 5 * MINUTE }
    ])

    expect(etat.perime).toBe(false)
    expect(messageMoteurPerime(etat)).toBeUndefined()
  })

  it('tolère le délai de build — une source écrite JUSTE avant le démarrage EST dans le binaire', () => {
    // Le bord qui décide si l'avertissement reste crédible : entre l'écriture d'un fichier et le
    // démarrage du processus qui l'embarque, il s'écoule un temps de compilation. Sans cette marge,
    // CHAQUE relance signalerait une péremption imaginaire — et un avertissement qui crie à tort
    // cesse d'être lu.
    const demarrage = 1_000_000
    const etat = etatDuMoteur(
      demarrage,
      [{ chemin: 'src/main/index.ts', modifieeMs: demarrage + 1_500 }],
      2_000
    )

    expect(etat.perime).toBe(false)
  })

  it('s’abstient quand l’instant de démarrage est inconnu', () => {
    // On ne rend jamais « périmé » faute d'information : ce serait affirmer sans preuve.
    for (const inconnu of [undefined, 0, -1, Number.NaN]) {
      expect(etatDuMoteur(inconnu, [{ chemin: 'src/main/a.ts', modifieeMs: 9_999_999 }]).perime).toBe(
        false
      )
    }
  })

  it('s’abstient quand aucune source n’est observable', () => {
    // Cas réel : en PACKAGÉ il n'y a pas d'arborescence source à côté de l'exécutable.
    expect(etatDuMoteur(1_000_000, []).perime).toBe(false)
  })

  it('ignore les dates aberrantes au lieu de les croire', () => {
    const demarrage = 1_000_000
    const etat = etatDuMoteur(demarrage, [
      { chemin: 'src/main/casse.ts', modifieeMs: Number.NaN },
      { chemin: 'src/main/vide.ts', modifieeMs: 0 }
    ])

    expect(etat.perime).toBe(false)
  })

  it('le message NOMME le fichier et dit quoi faire', () => {
    const demarrage = 1_000_000
    const message = messageMoteurPerime(
      etatDuMoteur(demarrage, [
        { chemin: 'src/main/agent-pilot.ts', modifieeMs: demarrage + 12 * MINUTE }
      ])
    )

    expect(message).toContain('src/main/agent-pilot.ts')
    expect(message).toContain('12 min')
    expect(message).toMatch(/relance/i)
  })
})
