import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skillRoots } from './native-registry'
import { invokedSkillId, skillInstruction } from './skill-pipeline'

/**
 * `/arena` EST-ELLE RÉELLEMENT DÉCLENCHABLE DEPUIS L'APP ?
 *
 * Le contrôle du 2026-09-03 a validé la skill sur le fond mais n'a pas pu confirmer par lecture que
 * `/arena` est branché : aucun endroit de `src/` ne nomme `arena` autrement qu'en commentaire. C'est
 * NORMAL — le routage est générique (`invokedSkillId` + `skillInstruction` sur `skillRoots()`), donc
 * un grep sur le nom ne peut rien prouver. Ce test remplace le grep par la sonde : il joue le vrai
 * chemin d'invocation et exige un corps non vide, provenance comprise.
 */
describe('/arena est atteignable par le routage réel', () => {
  it('reconnaît la commande en tête de message', () => {
    expect(invokedSkillId('/arena la skill /judge')).toBe('arena')
    expect(invokedSkillId('regarde /arena quand tu peux')).toBeUndefined()
  })

  it('charge le corps de arena depuis les racines réelles', () => {
    const corps = skillInstruction('arena', skillRoots())
    expect(corps).toContain('=== SKILL ARENA (kit) ===')
    // Le corps injecté est bien celui du mode d'emploi, pas un fichier homonyme.
    expect(corps).toContain('A/B/C/X')
    // La frontmatter (sélecteur) est retirée : on n'injecte que les instructions.
    expect(corps).not.toContain('description:')
  })

  it('a des dents : sans racine contenant arena, rien n’est injecté', () => {
    expect(skillInstruction('arena', [mkdtempSync(join(tmpdir(), 'arena-vide-'))])).toBe('')
  })
})
