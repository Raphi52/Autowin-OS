import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Garde de NON-REGRESSION sur la façon dont le script se connecte à Outlook.
 *
 * Vécu le 2026-08-31 : les deux tuiles de la vue Accueil affichaient un cast .NET raté à la place des
 * interlocuteurs et de l'agenda —
 *   « Impossible d'effectuer un cast […] en type d'interface 'Microsoft.Office.Interop.Outlook.
 *     _Application' […] Interface non enregistrée (HRESULT : 0x80040155) »
 * Mesuré sur ce poste : l'INTERFACE `_Application` ({00063001-0000-0000-C000-000000000046}) n'est pas
 * enregistrée, alors que la classe l'est, que le typelib 9.6 est présent et qu'Outlook tournait.
 * `New-Object -ComObject` réussit puis échoue au PREMIER accès membre ; `[Activator]::CreateInstance`
 * sur le type du ProgID passe, et lit 21986 messages.
 *
 * Ce test lit le TEXTE du script, ce qui est inhabituel mais assumé : la panne n'est pas atteignable
 * depuis un test unitaire — elle demande un poste dont l'enregistrement COM d'Office est incomplet, et
 * la passerelle injecte justement un `runner` pour ne pas dépendre d'un Outlook installé. Le seul point
 * de contrôle qui reste est donc la forme de la connexion. Sans lui, un « `New-Object` est plus lisible »
 * bien intentionné remet la panne en place, et rien ne la signale avant l'écran d'accueil d'un poste
 * affecté.
 */
describe('connexion à Outlook — liage tardif obligatoire', () => {
  const script = readFileSync(
    join(__dirname, '..', '..', '..', 'scripts', 'outlook-local-snapshot.ps1'),
    'utf8'
  )
  /** Les commentaires PORTENT la raison, `New-Object` y est cité : ne pas les confondre avec du code. */
  const code = script
    .split(/\r?\n/)
    .filter((ligne) => !/^\s*#/.test(ligne))
    .join('\n')

  it('crée la connexion par le type du ProgID, pas par New-Object -ComObject', () => {
    expect(code).toMatch(/\[Type\]::GetTypeFromProgID\(\s*'Outlook\.Application'\s*\)/)
    expect(code).toMatch(/\[Activator\]::CreateInstance\(/)
  })

  it("n'utilise PLUS New-Object -ComObject pour Outlook — c'est la panne 0x80040155", () => {
    expect(code).not.toMatch(/New-Object\s+-ComObject\s+Outlook/i)
  })

  it('nomme un Outlook absent au lieu de laisser un null se propager', () => {
    // GetTypeFromProgID rend $null quand le ProgID est inconnu ; sans ce garde, CreateInstance($null)
    // lèverait une erreur d'argument qui ne dit rien à l'utilisateur.
    expect(code).toMatch(/-eq\s+\$typeOutlook|\$typeOutlook\s+-eq/)
    expect(code).toMatch(/throw/)
  })

  it('garde la raison du choix dans le fichier, avec le code HRESULT', () => {
    // Le commentaire est le seul endroit où la mesure survit : un correctif dont la raison est perdue
    // se fait annuler au premier refactor.
    expect(script).toMatch(/0x80040155/)
  })
})
