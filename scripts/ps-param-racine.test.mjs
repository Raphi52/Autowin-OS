import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * PIEGE MESURE LE 2026-09-06 : dans un bloc `param()` qui contient un parametre `Mandatory`,
 * PowerShell evalue les valeurs par defaut AVANT de lier `$PSScriptRoot` — la variable est donc
 * VIDE et `Split-Path -Parent $PSScriptRoot` leve. `scripts/autowin-headless.ps1` etait ainsi
 * inlancable (« Impossible de lier l'argument au parametre Path ») : plus aucune instance isolee.
 * La racine se resout donc APRES le bloc param, jamais dedans.
 */
const racineScripts = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

export const blocParam = (source) => {
  const debut = source.search(/^param\s*\(/m)
  if (debut === -1) return ''
  let profondeur = 0
  for (let i = source.indexOf('(', debut); i < source.length; i += 1) {
    if (source[i] === '(') profondeur += 1
    else if (source[i] === ')') {
      profondeur -= 1
      if (profondeur === 0) return source.slice(debut, i + 1)
    }
  }
  return source.slice(debut)
}

describe('scripts PowerShell — la racine ne se resout jamais DANS le bloc param', () => {
  const fichiers = readdirSync(racineScripts).filter((nom) => nom.endsWith('.ps1'))

  it('trouve bien des scripts a inspecter', () => {
    expect(fichiers.length).toBeGreaterThan(5)
  })

  it.each(fichiers)('%s : pas de $PSScriptRoot dans un param() avec Mandatory', (nom) => {
    const bloc = blocParam(readFileSync(join(racineScripts, nom), 'utf8'))
    if (!/Mandatory/.test(bloc)) return
    expect(bloc).not.toMatch(/\$PSScriptRoot/)
  })

  it('detecte le piege si on le reintroduit (cas limite)', () => {
    const fautif =
      'param(\n  [Parameter(Mandatory = $true)][string]$Id,\n  [string]$X = (Split-Path -Parent $PSScriptRoot)\n)\n'
    const bloc = blocParam(fautif)
    expect(bloc).toMatch(/Mandatory/)
    expect(bloc).toMatch(/\$PSScriptRoot/)
  })

  it('ne se laisse pas tromper par un Mandatory de fonction interne', () => {
    const sain =
      'param()\n\nfunction F {\n  param([Parameter(Mandatory = $true)][string]$L)\n}\n$racine = Split-Path -Parent $PSScriptRoot\n'
    expect(blocParam(sain)).toBe('param()')
  })
})
