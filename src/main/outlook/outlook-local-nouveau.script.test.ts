import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Gardes de NON-REGRESSION sur le script qui envoie un message NEUF.
 *
 * Ce script ne peut pas être exercé depuis un test unitaire : son cœur est un dialogue COM avec
 * Outlook, et le seul moyen de le prouver serait d'envoyer un vrai courrier à quelqu'un. La
 * passerelle injecte justement un `redacteur` pour ne pas en dépendre. Restent donc deux propriétés
 * du FICHIER, et ce sont exactement celles qui ont déjà cassé cette intégration sur ce poste :
 *
 *  - l'ENCODAGE : Windows PowerShell 5.1 relit un `.ps1` sans BOM en ANSI, et un accent y devient un
 *    jeton invalide. Les quatre scripts Outlook sont donc en ASCII + BOM, sans exception ;
 *  - la CONNEXION : mesure du 2026-08-31, `New-Object -ComObject Outlook.Application` réussit sur ce
 *    poste puis échoue au PREMIER accès membre en 0x80040155 (l'interface `_Application` n'est pas
 *    enregistrée). Voir `outlook-local.liage-tardif.test.ts`, qui garde la même propriété sur le
 *    script de lecture.
 *
 * Sans ces deux gardes, un « `New-Object` est plus lisible » ou un accent ajouté dans un commentaire
 * remettent la panne en place, et rien ne le signale avant l'écran de l'utilisateur.
 */
describe('script d envoi d un message neuf', () => {
  const chemin = join(__dirname, '..', '..', '..', 'scripts', 'outlook-local-nouveau.ps1')
  const octets = readFileSync(chemin)
  const script = octets.toString('utf8')
  /** Les commentaires PORTENT la raison, `New-Object` y est cité : ne pas les confondre avec du code. */
  const code = script
    .split(/\r?\n/)
    .filter((ligne) => !/^\s*#/.test(ligne))
    .join('\n')

  it('commence par un BOM UTF-8 et ne contient AUCUN caractere non ASCII', () => {
    expect([octets[0], octets[1], octets[2]]).toEqual([0xef, 0xbb, 0xbf])
    const horsAscii = [...octets.subarray(3)].filter((octet) => octet > 0x7f)
    expect(horsAscii).toEqual([])
  })

  it('cree la connexion par le type du ProgID, pas par New-Object -ComObject', () => {
    expect(code).toMatch(/\[Type\]::GetTypeFromProgID\(\s*'Outlook\.Application'\s*\)/)
    expect(code).toMatch(/\[Activator\]::CreateInstance\(/)
    expect(code).not.toMatch(/New-Object\s+-ComObject\s+Outlook/i)
  })

  it('valide l adresse AVANT de parler a Outlook', () => {
    // La validation cote main ne suffit pas : ce script est aussi lancable a la main, et une
    // frontiere de confiance ne se garde pas d'un seul cote.
    const validation = code.indexOf('-notmatch')
    const connexion = code.indexOf('GetTypeFromProgID')
    expect(validation).toBeGreaterThan(-1)
    expect(validation).toBeLessThan(connexion)
  })

  it('refuse d envoyer quand Outlook ne resout pas le destinataire', () => {
    // Un message adresse a personne serait envoye « avec succes » et n'arriverait nulle part.
    expect(code).toMatch(/\.Resolve\(\)/)
    expect(code).toMatch(/exit 6/)
    expect(code.indexOf('exit 6')).toBeLessThan(code.indexOf('.Send()'))
  })
})
