import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadProjectContext,
  loadProjectContextStack,
  projectContextBlock,
  racineDuDepot
} from './context-files'

describe('context-files — souveraineté (chaîne de précédence)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctxfiles-'))
    // Le bac à sable EST la racine d'un dépôt : la remontée s'y arrête, quel que soit le dossier
    // temporaire de la machine (un TEMP rangé dans un dépôt aurait sinon ajouté ses propres fichiers).
    mkdirSync(join(dir, '.git'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rend null quand aucun fichier de contexte (cas courant)', () => {
    expect(loadProjectContext(dir)).toBeNull()
    expect(projectContextBlock(dir)).toBe('')
  })

  it('premier-trouvé-gagne DANS un dossier : AGENTS.md prime sur CLAUDE.md, jamais les deux', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'depuis agents')
    writeFileSync(join(dir, 'CLAUDE.md'), 'depuis claude')
    const ctx = loadProjectContext(dir)
    expect(ctx?.file).toBe('AGENTS.md')
    expect(ctx?.content).toBe('depuis agents')
    // le bloc ne contient QUE le gagnant, pas l'autre
    const block = projectContextBlock(dir)
    expect(block).toContain('AGENTS.md')
    expect(block).not.toContain('depuis claude')
  })

  it('AGENTS.md prime en tête de chaîne', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'agents')
    writeFileSync(join(dir, 'CLAUDE.md'), 'claude')
    expect(loadProjectContext(dir)?.file).toBe('AGENTS.md')
  })

  it('retombe sur CLAUDE.md si AGENTS.md absent', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'claude seul')
    expect(loadProjectContext(dir)?.file).toBe('CLAUDE.md')
  })

  it('ignore un fichier vide et passe au suivant', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '   \n  ')
    writeFileSync(join(dir, 'CLAUDE.md'), 'contenu réel')
    expect(loadProjectContext(dir)?.file).toBe('CLAUDE.md')
  })

  it('tronque au plafond (ASCII)', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'x'.repeat(100))
    const ctx = loadProjectContext(dir, undefined, 10)
    expect(ctx?.content.startsWith('xxxxxxxxxx')).toBe(true)
    expect(ctx?.content).toContain('tronqué')
    // conv-1067 : la coupe se DIT — ce qui manque, et où lire la suite. « …[tronqué] » seul laissait
    // l'agent croire qu'il avait toutes les consignes.
    expect(ctx?.content).toContain('90 octets sur 100 manquent')
    expect(ctx?.content).toContain(join(dir, 'AGENTS.md'))
  })

  it('C1 — mesure en BYTES : contenu accentué < plafond en chars mais > en bytes → tronque', () => {
    // 20 'é' = 20 chars UTF-16 mais 40 bytes UTF-8. Plafond 30 bytes : doit tronquer (l'ancien
    // code sur raw.length=20 < 30 n'aurait PAS tronqué → régression prouvée).
    writeFileSync(join(dir, 'AGENTS.md'), 'é'.repeat(20))
    const ctx = loadProjectContext(dir, undefined, 30)
    expect(ctx?.content).toContain('tronqué')
    // C2 — pas de caractère de remplacement isolé en fin (troncature propre sur frontière char)
    expect(ctx?.content).not.toContain('�')
  })

  it('le bloc étiquette le fichier gagnant pour la traçabilité', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'régles projet')
    expect(projectContextBlock(dir)).toBe('\n=== CONTEXTE PROJET (CLAUDE.md) ===\nrégles projet\n')
  })

  // conv-1067 (2026-10-22) : seul le dossier de travail était lu. Un fil rangé sur `App/front`
  // perdait les consignes de `App/AGENTS.md`, que Codex et Claude Code natifs chargent tous les deux.
  describe('empilement de la racine du dépôt au dossier de travail', () => {
    it('empile racine puis dossier, le plus proche en dernier, et dit lequel l’emporte', () => {
      writeFileSync(join(dir, 'AGENTS.md'), 'consigne racine')
      const front = join(dir, 'front')
      mkdirSync(front)
      writeFileSync(join(front, 'AGENTS.md'), 'consigne locale')
      const block = projectContextBlock(front)
      expect(block).toContain('=== CONTEXTE PROJET (AGENTS.md + front/AGENTS.md) ===')
      expect(block.indexOf('consigne racine')).toBeLessThan(block.indexOf('consigne locale'))
      expect(block).toContain(`--- ${join(dir, 'AGENTS.md')} ---`)
      expect(block).toContain(`--- ${join(front, 'AGENTS.md')} ---`)
      expect(block).toMatch(/le plus proche du dossier de travail l.emporte/)
      // Un seul bloc pour la trace (rag-trace-model.ts borne au prochain `\n=== `).
      expect(block.split('\n=== ').length).toBe(2)
    })

    it('un dossier sans fichier propre reçoit celui de la racine, étiqueté par son chemin', () => {
      writeFileSync(join(dir, 'CLAUDE.md'), 'consigne racine')
      const profond = join(dir, 'a', 'b')
      mkdirSync(profond, { recursive: true })
      const block = projectContextBlock(profond)
      expect(block).toContain('=== CONTEXTE PROJET (CLAUDE.md) ===')
      expect(block).toContain(`--- ${join(dir, 'CLAUDE.md')} ---`)
      expect(block).toContain('consigne racine')
    })

    it('la chaîne joue dans CHAQUE dossier : un CLAUDE.md voisin d’un AGENTS.md reste dehors', () => {
      writeFileSync(join(dir, 'AGENTS.md'), 'agents racine')
      writeFileSync(join(dir, 'CLAUDE.md'), 'claude racine')
      const front = join(dir, 'front')
      mkdirSync(front)
      writeFileSync(join(front, 'CLAUDE.md'), 'claude local')
      const pile = loadProjectContextStack(front)
      expect(pile.parts.map((part) => part.path)).toEqual([
        join(dir, 'AGENTS.md'),
        join(front, 'CLAUDE.md')
      ])
      expect(projectContextBlock(front)).not.toContain('claude racine')
    })

    it('une copie de travail git (`.git` FICHIER) borne aussi la remontée', () => {
      writeFileSync(join(dir, 'AGENTS.md'), 'consigne du dépôt principal')
      const copie = join(dir, 'copie')
      mkdirSync(copie)
      writeFileSync(join(copie, '.git'), 'gitdir: ailleurs')
      writeFileSync(join(copie, 'AGENTS.md'), 'consigne de la copie')
      expect(racineDuDepot(copie)).toBe(copie)
      expect(projectContextBlock(copie)).toBe(
        '\n=== CONTEXTE PROJET (AGENTS.md) ===\nconsigne de la copie\n'
      )
    })

    it('le plafond est PARTAGÉ et coupe d’abord le plus éloigné, en le disant', () => {
      writeFileSync(join(dir, 'AGENTS.md'), 'r'.repeat(30))
      const front = join(dir, 'front')
      mkdirSync(front)
      writeFileSync(join(front, 'AGENTS.md'), 'l'.repeat(15))
      const [racine, locale] = loadProjectContextStack(front, undefined, 20).parts
      expect(locale.content).toBe('l'.repeat(15))
      expect(racine.keptBytes).toBe(5)
      expect(racine.content.startsWith('rrrrr\n')).toBe(true)
      expect(racine.content).toContain('25 octets sur 30 manquent')
      expect(racine.content).toContain(join(dir, 'AGENTS.md'))
    })

    it('un fichier éloigné sans place est OMIS mais nommé, jamais tu', () => {
      writeFileSync(join(dir, 'AGENTS.md'), 'racine')
      const front = join(dir, 'front')
      mkdirSync(front)
      writeFileSync(join(front, 'AGENTS.md'), 'l'.repeat(10))
      const block = projectContextBlock(front, undefined, 10)
      expect(block).not.toContain('racine\n')
      expect(block).toContain('omis')
      expect(block).toContain(join(dir, 'AGENTS.md'))
    })

    it('un fichier local coupé ne laisse aucun reste aux fichiers plus éloignés', () => {
      writeFileSync(join(dir, 'AGENTS.md'), 'racine')
      const front = join(dir, 'front')
      mkdirSync(front)
      // 'é' = 2 octets : 11 octets de plafond gardent 5 'é' (10 octets) et laissent 1 octet « libre ».
      writeFileSync(join(front, 'AGENTS.md'), 'é'.repeat(20))
      const [racine] = loadProjectContextStack(front, undefined, 11).parts
      expect(racine.keptBytes).toBe(0)
    })
  })

  describe('hors dépôt git', () => {
    let horsDepot: string
    beforeEach(() => {
      horsDepot = mkdtempSync(join(tmpdir(), 'ctxfiles-hors-depot-'))
    })
    afterEach(() => {
      rmSync(horsDepot, { recursive: true, force: true })
    })

    // Sans `.git` au-dessus, on ne remonte pas : un AGENTS.md du disque ou du profil n'est pas un
    // fichier de ce projet. Sauté si le TEMP de la machine est lui-même dans un dépôt.
    it.skipIf(racineDuDepot(tmpdir()) !== undefined)(
      'ne lit que le dossier de travail, jamais ses parents',
      () => {
        writeFileSync(join(horsDepot, 'AGENTS.md'), 'consigne du parent')
        const enfant = join(horsDepot, 'enfant')
        mkdirSync(enfant)
        writeFileSync(join(enfant, 'AGENTS.md'), 'consigne enfant')
        expect(projectContextBlock(enfant)).toBe(
          '\n=== CONTEXTE PROJET (AGENTS.md) ===\nconsigne enfant\n'
        )
      }
    )
  })
})
