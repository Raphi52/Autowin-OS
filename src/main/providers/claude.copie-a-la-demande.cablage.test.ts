import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * LE GUET DE LA COPIE À LA DEMANDE, posé par chaque lancement du CLI Claude. L'effet est joué pour de
 * vrai dans copies/copie-a-la-demande.hook.test.ts (vrai script du contrôle, vrai guet) ; ici, seul le
 * branchement dans `claude.ts`, qu'aucune exécution de test n'atteint sans lancer le CLI.
 */
const source = readFileSync(join(__dirname, 'claude.ts'), 'utf8')

describe('claude.ts — la copie du fil à sa première écriture', () => {
  it('arme le guet à côté du script du contrôle, avec le dossier de travail du lancement', () => {
    const armement = source.indexOf('arreterCopieALaDemande = await armerCopieALaDemande({')
    expect(armement).toBeGreaterThan(source.indexOf("join(settingsDir, 'reservation.json')"))
    const bloc = source.slice(armement, armement + 200)
    expect(bloc).toContain('dossier: settingsDir')
    expect(bloc).toContain('conversationId: opts.conversationId')
    expect(bloc).toContain('cwd: execution?.cwd ?? readOnlyCwd')
  })

  it('arrête le guet à la fin du lancement, et quand la préparation échoue', () => {
    const fin = source.indexOf('const nettoyerFinDAppel = async (): Promise<void> => {')
    expect(source.slice(fin, fin + 200)).toContain('arreterCopieALaDemande()')
    expect(source).toMatch(
      /\} catch \(error\) \{\n\s+arreterCopieALaDemande\(\)\n\s+if \(journal && fdJournalOuvert\)/
    )
  })
})
