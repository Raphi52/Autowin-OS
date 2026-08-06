import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  classifyProviderFailure,
  describeFanoutFailure,
  diagnoseProviderFailure,
  describeExitCode,
  explainRoleFailure,
  uncoveredSendSites
} from './provider-failure-diagnosis'

/**
 * DIRE POURQUOI un rôle a échoué.
 *
 * Constaté le 2026-07-29 sur un orchestrate réel : « Fan-out scout : aucun modèle n'a produit de sortie
 * (1 échec(s)) ». La cause — le rôle `scout` bindé sur codex, sans session OAuth — était DÉJÀ capturée
 * dans le journal de phase, puis jetée en remontant. Même patron que le coût jeté et la carte jetée :
 * l'information existait, elle n'arrivait pas à l'utilisateur.
 */
describe('classifyProviderFailure — sur les chaînes RÉELLEMENT jetées', () => {
  it('« codex non authentifié — lance npm run codex:login » → auth', () => {
    // Chaine exacte de codex.ts.
    expect(classifyProviderFailure('codex non authentifié — lance npm run codex:login')).toBe('auth')
  })

  it('« spawn claude ENOENT » → binaire introuvable', () => {
    expect(classifyProviderFailure('spawn claude ENOENT')).toBe('cli-missing')
  })

  it('« Codex CLI introuvable : … » → binaire introuvable', () => {
    expect(classifyProviderFailure('Codex CLI introuvable : ni sous le dossier npm…')).toBe(
      'cli-missing'
    )
  })

  it('un 401 ou un « not logged in » anglais comptent aussi comme auth', () => {
    expect(classifyProviderFailure('HTTP 401 Unauthorized')).toBe('auth')
    expect(classifyProviderFailure('Error: not logged in')).toBe('auth')
  })

  it('ce qu’on ne sait pas classer reste « other » — on n’invente pas de diagnostic', () => {
    expect(classifyProviderFailure('codex exec figé (aucune sortie) — tué par le watchdog')).toBe(
      'other'
    )
    expect(classifyProviderFailure('')).toBe('other')
  })

  it('une panne « other » ne propose AUCUN geste (mieux que conseiller au hasard)', () => {
    expect(diagnoseProviderFailure({ provider: 'claude', message: 'tué par le watchdog' }).hint).toBeUndefined()
  })
})

describe('describeFanoutFailure — le message qui manquait', () => {
  it('LE CAS RÉEL : nomme le rôle, le provider, la cause ET le geste', () => {
    const message = describeFanoutFailure('scout', 'subagent', [
      {
        provider: 'codex',
        model: 'gpt-5.6-terra',
        message: 'codex non authentifié — lance npm run codex:login'
      }
    ])
    expect(message).toContain('scout')
    expect(message).toContain('codex')
    expect(message).toContain('gpt-5.6-terra')
    expect(message).toContain('non authentifié')
    expect(message).toContain('Se connecter')
  })

  it('des causes de types DIFFÉRENTS → aucun geste commun (il serait trompeur)', () => {
    const message = describeFanoutFailure('build', 'subagent', [
      { provider: 'codex', message: 'codex non authentifié' },
      { provider: 'claude', message: 'tué par le watchdog' }
    ])
    expect(message).toContain('codex')
    expect(message).toContain('claude')
    expect(message).not.toContain('→')
  })

  it('plusieurs membres avec la MÊME cause → le geste est donné une seule fois', () => {
    const message = describeFanoutFailure('scout', 'subagent', [
      { provider: 'codex', message: 'codex non authentifié' },
      { provider: 'codex', message: 'codex non authentifié' }
    ])
    expect(message.match(/→/g)).toHaveLength(1)
  })

  it('sans aucune cause collectée, on ne prétend rien (le décompte reste vrai)', () => {
    expect(describeFanoutFailure('scout', 'subagent', [])).toBe(
      "Fan-out scout : aucun modèle n'a produit de sortie"
    )
  })

  it('un échec sans message n’efface pas la ligne du provider', () => {
    const message = describeFanoutFailure('scout', 'subagent', [
      { provider: 'codex', message: 'échec sans message' }
    ])
    expect(message).toContain('codex')
  })
})

describe('explainRoleFailure — hors fan-out, le binding est nommé', () => {
  it('préfixe la cause par la phase, le rôle et son binding, sans écraser le message', () => {
    const message = explainRoleFailure('Phase build', 'subagent', {
      provider: 'codex',
      model: 'gpt-5.6-terra',
      message: 'codex non authentifié — lance npm run codex:login'
    })
    expect(message).toContain('Phase build')
    expect(message).toContain('rôle subagent')
    expect(message).toContain('codex (gpt-5.6-terra)')
    // Le message d'origine reste LISIBLE tel quel.
    expect(message).toContain('lance npm run codex:login')
    expect(message).toContain('Se connecter')
  })

  it('le libellé n’est PAS re-préfixé : « Phase sous-tâche X » se lisait mal', () => {
    const message = explainRoleFailure('sous-tâche scout', 'subagent', {
      provider: 'codex',
      message: 'spawn codex ENOENT'
    })
    expect(message.startsWith('sous-tâche scout — le rôle subagent')).toBe(true)
    expect(message).not.toContain('Phase sous-tâche')
  })

  it('cause non classable → pas de geste inventé, juste le contexte', () => {
    const message = explainRoleFailure('Phase clean', 'subagent', {
      provider: 'claude',
      message: 'tué par le watchdog'
    })
    expect(message).toContain('Phase clean')
    expect(message).not.toContain('→')
  })
})

/**
 * CÂBLAGE : le défaut n'était pas l'absence de diagnostic, c'était que l'orchestrateur JETAIT les
 * causes qu'il avait déjà. Ces tests échouent si elles redeviennent perdues.
 */
describe('câblage — l’orchestrateur remonte les causes au lieu de les jeter', () => {
  const source = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')

  it('chaque membre en échec conserve sa cause', () => {
    expect(source).toContain('cause: error instanceof Error ? error.message : String(error)')
  })

  it('l’échec de fan-out est décrit, et c’est CE message qui est jeté', () => {
    expect(source).toContain('describeFanoutFailure(phase, ')
    expect(source).toContain('throw new Error(explained)')
    // L'ancien message opaque ne doit plus etre la seule information remontee.
    expect(source).not.toMatch(/throw new Error\(\s*`Fan-out \$\{phase\} : aucun modèle/)
  })

  it('le chemin mono-modèle nomme aussi le rôle et son binding', () => {
    expect(source).toContain("explainRoleFailure(`Phase ${phase}`, 'subagent'")
  })

  /**
   * GARDE STRUCTURELLE : le defaut n'etait pas un site oublie, c'etait qu'un site puisse laisser
   * passer une erreur NUE. Constate a l'ecran le 2026-07-29 : le site de sous-tache greedy n'avait
   * aucun `catch`, et l'utilisateur voyait `spawn … ENOENT` sans savoir quel role pointait ou. Ce test
   * echoue si un NOUVEL appel de provider est ajoute sans contexte de role.
   */
  it('CHAQUE appel de provider porte un contexte de rôle', () => {
    const uncovered = uncoveredSendSites(source)
    expect(uncovered, `sites sans contexte de rôle (lignes) : ${uncovered.join(', ')}`).toEqual([])
  })

  it('la garde SAIT échouer — sinon elle ne prouve rien', () => {
    // Source synthetique : un appel sans aucune gestion d'erreur autour.
    const fautif = ['const a = 1', 'await registry.send(provider, msgs, opts)', 'return a'].join(String.fromCharCode(10))
    expect(uncoveredSendSites(fautif)).toEqual([2])
    // Et le meme appel, enveloppe : plus de signalement.
    const correct = [
      'try {',
      '  await registry.send(provider, msgs, opts)',
      '} catch (error) {',
      '  throw new Error(explainRoleFailure(phase, role, f))',
      '}'
    ].join(String.fromCharCode(10))
    expect(uncoveredSendSites(correct)).toEqual([])
  })

  it('il y a bien plusieurs appels de provider audités (le test ne passe pas à vide)', () => {
    const count = source.split(/\r?\n/).filter((l) => l.includes('registry.send(')).length
    expect(count).toBeGreaterThanOrEqual(6)
  })
})

/**
 * Incident Auto-Kaizen ak-820d7029b0c5e76d : « Phase build — le rôle subagent est bindé sur claude
 * (opus) : claude CLI exit 1073807364 ». Un code NTSTATUS Windows brut ne dit rien : ni que le
 * process a été TUÉ (0x40010004 = DBG_TERMINATE_PROCESS), ni qu'un relancement est le geste utile.
 * La cause était dans le code de sortie ; elle n'arrivait pas à l'utilisateur.
 */
describe('sortie anormale d’un CLI (codes NTSTATUS Windows)', () => {
  it('nomme un process terminé et un crash', () => {
    expect(describeExitCode(1073807364)).toBe('0x40010004 arrêt du process demandé par l’hôte')
    expect(describeExitCode(3221226091)).toBe('0xc000026b échec d’initialisation d’une DLL (arrêt de session Windows)')
    expect(describeExitCode(3221225477)).toBe('0xc0000005 violation d’accès (crash du CLI)')
    expect(describeExitCode(1)).toBeUndefined()
  })

  it('classe la sortie anormale en « crashed » avec un geste concret', () => {
    expect(classifyProviderFailure('claude CLI exit 1073807364 (0x40010004 arrêt du process demandé par l’hôte)')).toBe('crashed')
    expect(classifyProviderFailure('claude CLI exit 3221226091 (0xc000026b échec d’initialisation d’une DLL (arrêt de session Windows))')).toBe('crashed')
    expect(diagnoseProviderFailure({ provider: 'claude', model: 'opus', message: 'claude CLI exit 3221225477 (0xc0000005 violation d’accès (crash du CLI))' }).hint).toMatch(/relanc/i)
  })

  it('ne confond pas un exit 1 ordinaire avec un crash', () => {
    expect(classifyProviderFailure('claude CLI exit 1')).toBe('other')
  })
})
