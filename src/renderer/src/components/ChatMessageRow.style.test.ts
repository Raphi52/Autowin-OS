import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Defaut vecu le 2026-08-13, signale par l'utilisateur sur une capture : la fin de tour NON NOMINALE
 * (« Réponse annulée » + ses deux relances) s'affichait en LIGNE BRUTE — boutons au style par defaut
 * du navigateur, colles au texte, sans cadre. Cause : les quatre classes existaient dans le JSX et
 * AUCUNE n'avait de regle CSS. Rien ne pouvait le detecter : le composant se rendait, ses tests de
 * comportement passaient, et un bouton sans regle retombe silencieusement sur le style du navigateur.
 *
 * Ce test ferme cette classe de defaut pour le bloc concerne : toute classe que le JSX ecrit ici doit
 * exister dans la feuille de la vue. Il ne juge pas le GOUT — il refuse l'absence.
 */
describe('ChatMessageRow — fin de tour non nominale', () => {
  const jsx = readFileSync(new URL('./ChatMessageRow.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

  const CLASSES = [
    'msg-terminal',
    'msg-terminal-text',
    'msg-terminal-action',
    'msg-terminal-refine'
  ]

  it.each(CLASSES)('la classe %s est écrite par le JSX ET stylée par la feuille', (classe) => {
    expect(jsx).toContain(classe)
    // `.classe` suivi d'un separateur de selecteur : evite qu'un prefixe (`.msg-terminal`) soit
    // credite par une regle qui ne concerne qu'un autre nom (`.msg-terminal-text`).
    expect(css).toMatch(new RegExp(`\\.${classe}(?=[\\s,:{[])`))
  })

  it('distingue visuellement un échec d’une annulation, au bord et non par un fond criard', () => {
    // Le statut est porte par `data-status` dans le JSX ; la feuille doit s'en servir, sinon les deux
    // fins de tour se ressemblent alors qu'elles n'appellent pas la meme action.
    expect(jsx).toContain('data-status={message.status}')
    expect(css).toMatch(/\.msg-terminal\[data-status='failed'\]/)
    const regle = css.match(/\.msg-terminal\s*\{[^}]*\}/s)?.[0]
    expect(regle).toMatch(/border-left-color/)
    // Direction Lineaire, contrainte de gout explicite de l'utilisateur : aucun halo, aucun flou.
    expect(regle).not.toMatch(/box-shadow\s*:\s*(?!none)/)
    expect(regle).not.toMatch(/filter\s*:|blur\(/)
  })

  it('donne aux relances la forme des autres actions de l’app, et un focus visible', () => {
    const bouton = css.match(/\.msg-terminal-action\s*\{[^}]*\}/s)?.[0]
    // Pastille, comme les onglets de section : meme vocabulaire de forme dans toute l'app.
    expect(bouton).toMatch(/border-radius:\s*999px/)
    expect(bouton).toMatch(/cursor:\s*pointer/)
    // Un bouton atteignable au clavier doit se VOIR quand il a le focus.
    expect(css).toMatch(/\.msg-terminal-action:focus-visible\s*\{[^}]*outline/s)
  })
})
