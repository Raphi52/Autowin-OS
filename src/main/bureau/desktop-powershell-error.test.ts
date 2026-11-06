import { describe, expect, it } from 'vitest'
import { describePowerShellFailure } from './desktop-control'

/**
 * LE BLOB CLIXML MASQUAIT LA VRAIE ERREUR.
 *
 * MESURE sur les journaux : sur 46 echecs de desktop_act, 16 — la premiere famille — ont pour
 * message un blob commencant par '#< CLIXML'. PowerShell y serialise son flux de progression sur
 * stderr ; l'agent recevait des kilo-octets de XML au lieu du motif, et rejouait le meme geste.
 */
describe('message d erreur PowerShell', () => {
  const clixml =
    '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN></Obj></Objs>'

  it('ne rend pas le CLIXML quand stderr n en contient que', () => {
    const message = describePowerShellFailure({ message: 'Command failed' }, clixml)
    expect(message).not.toContain('CLIXML')
    expect(message).not.toContain('<Objs')
    expect(message).toBe('Command failed')
  })

  it('nomme le depassement du delai de 20 s', () => {
    const message = describePowerShellFailure(
      { message: 'Command failed', killed: true },
      clixml
    )
    expect(message).toContain('20 s')
  })

  it('garde la vraie erreur PowerShell melangee au CLIXML', () => {
    const message = describePowerShellFailure(
      { message: 'Command failed' },
      `${clixml}\r\nGeometrie Windows invalide`
    )
    expect(message).toBe('Geometrie Windows invalide')
  })
})
