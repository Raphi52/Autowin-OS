/*
 * LA PAGE ENTIERE NE DEFILE JAMAIS (conv-275, 2026-10-11).
 *
 * La regle existait seulement dans l'ecran d'attente de `index.html`, que React efface a son
 * premier rendu : apres le demarrage, un element pose dans <body> suffisait a faire apparaitre la
 * barre de la page et a retrecir toute l'app de sa largeur.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sansCommentaires = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('main.css — la page ne defile pas', () => {
  it('coupe le defilement de html ET body pour toute la session', () => {
    const css = sansCommentaires(readFileSync(new URL('./main.css', import.meta.url), 'utf8'))
    expect(css).toMatch(/(?:^|\n)html,\s*body\s*{[^}]*overflow:\s*hidden/)
  })

  it('#root reste a la hauteur de la fenetre et coupe ce qui depasse', () => {
    const css = sansCommentaires(readFileSync(new URL('./main.css', import.meta.url), 'utf8'))
    expect(css).toMatch(/#root\s*{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/)
  })
})
