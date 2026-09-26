import { describe, it, expect } from 'vitest'
import {
  argumentsEnfantAvecPort,
  commandeLanceur,
  decouperArguments,
  pidVivant,
  restesAramasser
} from './avec-instance-headless.mjs'
import { argumentsInstanceDediee } from './ui-capture.mjs'

describe('enrobage d instance headless', () => {
  it('separe ses options de la commande enfant', () => {
    const lu = decouperArguments([
      '--instance-id',
      'preuve',
      '--port',
      '9300',
      '--',
      'node',
      'scripts/x.mjs',
      '--view',
      'chat'
    ])
    expect(lu.instanceId).toBe('preuve')
    expect(lu.portDemande).toBe(9300)
    expect(lu.enfant).toEqual(['node', 'scripts/x.mjs', '--view', 'chat'])
  })

  it('sans commande apres --, rien a lancer', () => {
    expect(decouperArguments(['--instance-id', 'x']).enfant).toEqual([])
  })

  it('passe a l enfant le port reellement choisi', () => {
    expect(argumentsEnfantAvecPort(['scripts/x.mjs'], 9301)).toEqual([
      'scripts/x.mjs',
      '--port',
      '9301'
    ])
  })

  /* Un appelant qui vise une instance precise reste maitre : on n'ecrase pas son port. */
  it('n ecrase jamais un --port explicite', () => {
    expect(argumentsEnfantAvecPort(['scripts/x.mjs', '--port', '9231'], 9301)).toEqual([
      'scripts/x.mjs',
      '--port',
      '9231'
    ])
  })

  it('construit la commande du lanceur avec l action et le port', () => {
    const { commande, args } = commandeLanceur({
      racine: 'D:/depot',
      action: 'Stop',
      instanceId: 'preuve',
      port: 9301
    })
    expect(commande).toBe('powershell')
    expect(args).toContain('Stop')
    expect(args).toContain('preuve')
    expect(args).toContain('9301')
    expect(args.some((a) => a.includes('autowin-headless.ps1'))).toBe(true)
  })

  /*
   * LE NETTOYAGE NE DOIT PAS TUER L'INSTANCE EN COURS, ni toucher a une instance encore vivante :
   * c'est exactement ainsi qu'un ramasse-miettes ferme l'application d'un autre travail en cours.
   */
  it('ne ramasse que les fiches dont le processus est mort, jamais l instance en cours', () => {
    const fiches = [
      { instanceId: 'en-cours', fichier: 'a/instance.json', pid: 1 },
      { instanceId: 'vivante', fichier: 'b/instance.json', pid: 2 },
      { instanceId: 'morte', fichier: 'c/instance.json', pid: 3 }
    ]
    const restes = restesAramasser({
      fiches,
      exclure: 'en-cours',
      vivant: (pid) => pid === 2
    })
    expect(restes).toEqual(['c/instance.json'])
  })

  it('une fiche illisible (pid NaN) compte pour un reste', () => {
    expect(
      restesAramasser({
        fiches: [{ instanceId: 'x', fichier: 'x/instance.json', pid: Number.NaN }]
      })
    ).toEqual(['x/instance.json'])
  })

  it('un processus existant mais non possede (EPERM) est vivant', () => {
    expect(
      pidVivant(42, () => {
        const erreur = new Error('operation not permitted')
        erreur.code = 'EPERM'
        throw erreur
      })
    ).toBe(true)
    expect(
      pidVivant(42, () => {
        const erreur = new Error('no such process')
        erreur.code = 'ESRCH'
        throw erreur
      })
    ).toBe(false)
  })
})

describe('ui-capture sur instance dediee', () => {
  /* Sans retrait du drapeau, la relance se relancerait elle-meme a l'infini. */
  it('retire le drapeau et delegue a l enrobage', () => {
    const args = argumentsInstanceDediee(
      ['--view', 'chat', '--instance-dediee', '--out', 'a.png'],
      {
        enrobage: 'E/avec.mjs',
        script: 'E/ui-capture.mjs',
        instanceId: 'ui-capture'
      }
    )
    expect(args).toEqual([
      'E/avec.mjs',
      '--instance-id',
      'ui-capture',
      '--',
      'node',
      'E/ui-capture.mjs',
      '--view',
      'chat',
      '--out',
      'a.png'
    ])
    expect(args).not.toContain('--instance-dediee')
  })
})
