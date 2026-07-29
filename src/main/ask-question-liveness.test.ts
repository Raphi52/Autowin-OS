import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * QUESTION DU MODÈLE — ne doit JAMAIS suspendre un tour.
 *
 * Cause racine mesurée le 2026-07-29 (essai réel, instance isolée) : `askModelQuestion` s'appuyait
 * sur le WebContents CAPTURÉ au lancement du tour. Fenêtre fermée en cours de route ⇒
 * `BrowserWindow.fromWebContents(sender)` rend `null`, aucune fenêtre de question ne s'ouvre, et la
 * promesse ne se résout jamais. Observé : 7,4 Ko produits APRÈS la fermeture, puis 4 minutes de
 * silence total, aucun `done`. Le travail n'était pas perdu (journal + reprise auto) mais le tour ne
 * se clôturait pas — troisième propriété du finding tiers, non satisfaite par le premier correctif.
 *
 * Ce sont des assertions de SOURCE : l'ouverture d'une fenêtre Electron n'est pas testable ici, mais
 * l'invariant qui compte l'est — aucun chemin ne doit attendre sans destinataire.
 */
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const askFn = source.slice(
  source.indexOf('function askModelQuestion'),
  source.indexOf('function askModelQuestion') + 2_500
)

describe('askModelQuestion — aucune attente sans destinataire', () => {
  it('vérifie que le WebContents d’origine est encore VIVANT', () => {
    expect(askFn).toContain('sender.isDestroyed()')
  })

  it('se rabat sur une autre fenêtre vivante si l’origine a disparu', () => {
    expect(askFn).toContain('BrowserWindow.getAllWindows()')
    expect(askFn).toMatch(/!w\.isDestroyed\(\)/)
  })

  it('RÉSOUT immédiatement quand AUCUNE fenêtre n’est ouverte (au lieu de bloquer)', () => {
    const noHostBranch = askFn.slice(askFn.indexOf('if (!host)'))
    expect(noHostBranch).toContain('Promise.resolve(')
    // Un reject ferait remonter une exception et casserait le tour : ce n'est pas ce qu'on veut.
    expect(noHostBranch.slice(0, noHostBranch.indexOf('}'))).not.toContain('Promise.reject')
  })

  it('la réponse de repli invite à POURSUIVRE en autonomie', () => {
    const noHostBranch = askFn.slice(askFn.indexOf('if (!host)'))
    expect(noHostBranch).toContain('autonome')
  })

  it('n’ouvre plus de fenêtre à partir du sender capturé', () => {
    // Le patron fautif : openQuestionWindow(BrowserWindow.fromWebContents(sender), ...)
    expect(askFn).not.toContain('openQuestionWindow(BrowserWindow.fromWebContents(sender)')
    expect(askFn).toContain('openQuestionWindow(host,')
  })
})

describe('le pilote sait exploiter la réponse de repli', () => {
  it('injecte la réponse dans le fil et POURSUIT la boucle', () => {
    const pilot = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')
    const askBranch = pilot.slice(pilot.indexOf('if (question && ask)'))
    // La reponse est consommee puis la boucle continue : aucune sortie prematuree.
    // (On borne par POSITION, pas par la premiere accolade : `${answer}` en contient une.)
    const injected = askBranch.indexOf('UTILISATEUR: ${answer}')
    const resumed = askBranch.indexOf('continue')
    expect(injected).toBeGreaterThan(-1)
    expect(resumed).toBeGreaterThan(injected)
  })
})
