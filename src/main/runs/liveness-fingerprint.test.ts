import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { agentVerdict, resumeActionFor } from './run-reattach'
import { defaultProcessIdentity } from '../store/worktree-manager'

/**
 * Ce que ces tests protègent : qu'un run interrompu puisse être RELANCÉ.
 *
 * La garde de vivacité distingue « notre agent travaille encore » de « ce pid a été recyclé » en
 * comparant une EMPREINTE capturée au lancement. Sans empreinte, `agentVerdict` tombe dans son repli
 * « on penche vers vivant » — un repli raisonnable tant qu'il reste un cas limite.
 *
 * Il ne l'était pas. Le côté LECTURE était armé (`index.ts` passe `defaultProcessIdentity`), mais
 * l'orchestrateur était construit SANS `processIdentity` : l'empreinte n'était JAMAIS persistée, donc
 * le repli était l'UNIQUE chemin. Tout run dont le pid existait encore était jugé vivant, rattaché,
 * jamais relancé ni clos — le chat attendait indéfiniment.
 */
describe('la garde de vivacité a besoin de l’empreinte pour garder quoi que ce soit', () => {
  const pidVivant = 4242
  // Le pid existe, mais ce n'est plus notre agent : le système a recyclé le numéro.
  const sondeRecyclee = (pid: number): string | undefined =>
    pid === pidVivant ? 'un-autre-processus' : undefined

  it('sans empreinte, un pid recyclé est pris pour un agent vivant — le run reste épinglé', () => {
    const action = resumeActionFor(
      { agents: [{ token: 'a', pid: pidVivant }], phaseOutputs: [] },
      sondeRecyclee
    )
    // C'est le comportement OBSERVÉ en production tant que l'empreinte n'est pas capturée.
    expect(action).toBe('rattacher')
  })

  it('AVEC empreinte, le pid recyclé est démasqué mais reste bloqué sans preuve terminale', () => {
    const action = resumeActionFor(
      { agents: [{ token: 'a', pid: pidVivant, identity: 'notre-agent' }], phaseOutputs: [] },
      sondeRecyclee
    )
    expect(action).toBe('bloquer')
  })

  it('AVEC empreinte, un agent réellement vivant reste protégé d’une double relance', () => {
    // La correction ne doit pas ouvrir la porte inverse : relancer par-dessus un agent qui travaille
    // mettrait deux agents sur la même copie, à s'écraser l'un l'autre.
    const action = resumeActionFor(
      { agents: [{ token: 'a', pid: pidVivant, identity: 'notre-agent' }], phaseOutputs: [] },
      () => 'notre-agent'
    )
    expect(action).toBe('rattacher')
  })

  it('un pid éteint sans preuve terminale est bloqué, avec ou sans empreinte', () => {
    for (const agent of [
      { token: 'a', pid: 999 },
      { token: 'a', pid: 999, identity: 'notre-agent' }
    ]) {
      expect(resumeActionFor({ agents: [agent], phaseOutputs: [] }, () => undefined)).toBe('bloquer')
    }
  })

  it.runIf(process.platform === 'win32')(
    'une panne de la sonde PowerShell reste inconnue, jamais confondue avec un PID mort',
    () => {
      const identity = defaultProcessIdentity(process.pid)
      expect(identity).toEqual(expect.any(String))
      const previousPath = process.env.PATH
      process.env.PATH = ''
      try {
        expect(
          agentVerdict(
            { token: 'agent-vivant', pid: process.pid, identity: identity as string },
            defaultProcessIdentity
          ).state
        ).toBe('inconnu')
      } finally {
        if (previousPath === undefined) delete process.env.PATH
        else process.env.PATH = previousPath
      }
    }
  )
})

/**
 * Garde de CÂBLAGE, distincte des tests ci-dessus.
 *
 * Les quatre tests précédents décrivent ce que fait `resumeActionFor` selon que l'empreinte est là ou
 * non — ils passent AVEC OU SANS la correction, car ils fournissent l'empreinte eux-mêmes. Le défaut
 * réel n'était pas dans cette fonction : il était dans la DÉPENDANCE NON BRANCHÉE qui l'empêchait de
 * recevoir une empreinte en production.
 *
 * C'est donc le branchement qu'il faut garder. Assertion sur la source, faute d'oracle plus proche :
 * instancier un `AutowinOS` complet ferait entrer registre, rôles et worktrees dans un test unitaire.
 * Elle est volontairement étroite — elle échoue si la dépendance disparaît, et rien d'autre.
 */
describe('câblage — l’orchestrateur capture bien l’empreinte au lancement', () => {
  const source = readFileSync('src/main/os.ts', 'utf8')

  it('les dépendances de l’orchestrateur incluent `processIdentity`', () => {
    expect(source).toMatch(/processIdentity:\s*defaultProcessIdentity/)
  })

  it('et la sonde est bien importée, pas seulement nommée', () => {
    expect(source).toMatch(/import\s*\{[^}]*defaultProcessIdentity[^}]*\}\s*from\s*'\.\/store\/worktree-manager'/)
  })
})
