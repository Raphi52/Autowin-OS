import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * L'atome 5A est un empilement de TROIS arcs de 1,3-1,6 px, aplati a 55 % en
 * hauteur par ses keyframes. En dessous d'un certain diametre, les trois orbites
 * se recouvrent dans moins de 9 px de hauteur utile : l'indicateur ne se lit plus
 * comme un atome qui tourne mais comme une eraflure sombre. Constate le 2026-08-28
 * sur la pastille des conversations « en cours » (--aw-spin-size: 12px → boite
 * rendue 12x7 px, mesuree par scripts/ui-capture.mjs --motion).
 *
 * Toute taille declaree passe donc par un PLANCHER de lisibilite. Un lieu qui
 * veut plus petit doit changer la geometrie de l'atome, pas seulement le rapetisser.
 */
const MIN_SPIN_SIZE_PX = 16

const CSS_FILES = [
  join(__dirname, 'theme.css'),
  join(__dirname, '..', 'components', 'ChatView.css')
]

type Offender = { fichier: string; taille: number; contexte: string }

function spinSizeDeclarations(css: string, fichier: string): Offender[] {
  const out: Offender[] = []
  const re = /--aw-spin-size:\s*([\d.]+)px/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    const taille = Number(m[1])
    if (taille >= MIN_SPIN_SIZE_PX) continue
    // Selecteur porteur : dernier bloc ouvert avant la declaration.
    const avant = css.slice(0, m.index)
    const ouverture = avant.lastIndexOf('{')
    const debutSelecteur = Math.max(
      avant.lastIndexOf('}', ouverture),
      avant.lastIndexOf('*/', ouverture)
    )
    out.push({
      fichier,
      taille,
      contexte: avant.slice(debutSelecteur + 1, ouverture).trim().replace(/\s+/g, ' ')
    })
  }
  return out
}

describe('atome 5A — plancher de lisibilite', () => {
  it(`aucune surface ne rapetisse le spinner sous ${MIN_SPIN_SIZE_PX}px`, () => {
    const offenders = CSS_FILES.flatMap((f) =>
      spinSizeDeclarations(readFileSync(f, 'utf8'), f.split(/[\/]/).pop() as string)
    )
    expect(offenders).toEqual([])
  })
})
