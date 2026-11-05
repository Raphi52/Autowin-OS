import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as apprentissage from './apprentissage'
import * as editionIsolee from './edition-isolee'
import * as fichiers from './fichiers'
import * as instantanes from './instantanes'
import * as outilsBureauNavigateur from './outils-bureau-navigateur'
import * as verification from './verification'
import * as verificationAvantPublication from './verification-avant-publication'

/**
 * Les grosses méthodes de `AppCommandBus` vivent dans `commands/<famille>.ts` (conv-1580, lot 6) :
 * des fonctions qui prennent le bus. La classe garde une méthode mince du même nom, que ses
 * appelants et les tests continuent d'appeler — certains la REMPLACENT sur l'instance
 * (`edit-file-portee.test.ts` substitue `baselineAvantEdition`) : les fonctions déplacées passent
 * donc par `bus.<méthode>()`, jamais directement par la fonction voisine.
 *
 * Défaut qu'un typage vert ne voit pas : une méthode de la classe qui garde (ou retrouve) son corps
 * au lieu de déléguer — deux copies, la suivante corrigée d'un seul côté. Entrée qui fait échouer ce
 * test : `runVerifyAt` de `commands.ts` avec son corps de 116 lignes au lieu de
 * `return verificationDuBus.runVerifyAt(this, …)`, ou une fonction absente de son module.
 */
const FAMILLES: Array<[string, Record<string, unknown>, string[]]> = [
  ['apprentissage', apprentissage, ['observeOutcomeLearning']],
  [
    'fichiers',
    fichiers,
    ['runTracedFileCommand', 'runCreateFile', 'runMoveFile', 'runDeleteFile', 'runWorktreeStatus']
  ],
  ['instantanes', instantanes, ['snapshot', 'jalonne', 'travauxNonAnnonces', 'snapshotForPrompt']],
  [
    'outils-bureau-navigateur',
    outilsBureauNavigateur,
    ['outilBureauCache', 'outilNavigateur', 'outilTerminalLire', 'actionNavigateur']
  ],
  [
    'edition-isolee',
    editionIsolee,
    ['identiteDeBureau', 'withIsolatedMutation', 'runEditFile', 'runTracedEditFile']
  ],
  [
    'verification',
    verification,
    [
      'runVerify',
      'bureauDeVerification',
      'runVerifyAt',
      'fichiersNonCommites',
      'runRelatedVerifyAt',
      'spawnVerify'
    ]
  ],
  [
    'verification-avant-publication',
    verificationAvantPublication,
    ['verifierAvantPublication', 'mesurerParLots', 'mesurerAvecRapport', 'baselineAvantEdition']
  ]
]

const source = readFileSync(join(__dirname, '..', 'commands.ts'), 'utf8')
const fichier = ts.createSourceFile('commands.ts', source, ts.ScriptTarget.Latest, true)
const classe = fichier.statements.find(
  (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'AppCommandBus'
)

/** Nom sous lequel `commands.ts` importe le module entier (`import * as <alias>`). */
function aliasDuModule(module: string): string | undefined {
  for (const s of fichier.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue
    if (s.moduleSpecifier.text !== `./commands/${module}`) continue
    const liaisons = s.importClause?.namedBindings
    if (liaisons && ts.isNamespaceImport(liaisons)) return liaisons.name.text
  }
  return undefined
}

describe('méthodes de AppCommandBus déplacées par famille (conv-1580, lot 6)', () => {
  it.each(FAMILLES)('%s : chaque méthode du bus délègue à son module', (module, exports, noms) => {
    const alias = aliasDuModule(module)
    expect(alias, `commands.ts doit importer ./commands/${module} en entier`).toBeDefined()
    for (const nom of noms) {
      expect(typeof exports[nom], `${nom} absent de commands/${module}.ts`).toBe('function')
      const methode = classe?.members.find(
        (m): m is ts.MethodDeclaration =>
          ts.isMethodDeclaration(m) && m.name.getText(fichier) === nom
      )
      expect(methode, `AppCommandBus.${nom} doit rester (appelants et tests)`).toBeDefined()
      const corps = methode?.body?.statements ?? []
      expect(corps, `AppCommandBus.${nom} : une seule instruction, la délégation`).toHaveLength(1)
      expect(corps[0]?.getText(fichier)).toMatch(
        new RegExp(`^return ${alias}\\.${nom}(<[^>]*>)?\\(`, 'u')
      )
    }
  })
})
