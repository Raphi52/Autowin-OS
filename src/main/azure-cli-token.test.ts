import { describe, expect, it, vi } from 'vitest'
import {
  AZURE_CLI_ABSENT,
  AZURE_CLI_DECONNECTE,
  loadAzureDevOpsCliToken
} from './azure-cli-token'

describe('credential Azure DevOps via Azure CLI', () => {
  it('demande le resource id Azure DevOps et ne retourne que le token', async () => {
    const run = vi.fn(async () => ({ stdout: 'token-secret\n', stderr: '' }))

    await expect(loadAzureDevOpsCliToken(run)).resolves.toBe('token-secret')
    expect(run).toHaveBeenCalledWith('az.cmd', [
      'account',
      'get-access-token',
      '--resource',
      '499b84ac-1321-427f-aa17-267ca6975798',
      '--query',
      'accessToken',
      '-o',
      'tsv'
    ])
  })

  /*
   * CE QUE CE TEST PROTEGE, et il ne faut pas le perdre de vue en le lisant : la sortie de l'outil
   * peut porter le JETON lui-meme. Le message d'erreur ne doit donc JAMAIS la recopier. L'assertion
   * porte volontairement sur un fragment STABLE du message, pas sur sa ponctuation finale : figer le
   * texte au point pres transforme toute amelioration de libelle en echec, sans rien prouver de plus.
   */
  it('échoue sans recopier une sortie CLI sensible', async () => {
    const run = vi.fn(async () => {
      throw new Error('token-secret')
    })

    await expect(loadAzureDevOpsCliToken(run)).rejects.toThrow(
      'Session Azure CLI indisponible'
    )
    // La garde qui compte VRAIMENT : le secret ne fuit pas dans le message rendu.
    await expect(loadAzureDevOpsCliToken(run)).rejects.not.toThrow('token-secret')
  })

  /*
   * LES DEUX PANNES NE SE SOIGNENT PAS PAREIL : l'une demande une INSTALLATION, l'autre une
   * RECONNEXION. Un message unique accusait toujours la session, et le 2026-09-08 il a envoye
   * chercher un `az login` sur un poste ou `az` n'existait pas. Ces trois cas figent la distinction.
   */
  it('dit d INSTALLER quand l executable est introuvable — code ENOENT', async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error('spawn az.cmd ENOENT'), { code: 'ENOENT' })
    })

    await expect(loadAzureDevOpsCliToken(run)).rejects.toThrow(AZURE_CLI_ABSENT)
  })

  /*
   * LE CAS WINDOWS REEL, et celui qu'`ENOENT` seul RATE : l'appel passe par `cmd /c`, donc
   * l'interpreteur existe bel et bien et rend un code de sortie ordinaire. L'absence ne se lit alors
   * que dans son refus ecrit — teste en francais, la langue du poste ou le defaut est apparu.
   */
  it('dit d INSTALLER quand l interpreteur Windows refuse la commande', async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error('Command failed'), {
        stderr: "'az.cmd' n'est pas reconnu comme commande interne ou externe"
      })
    })

    await expect(loadAzureDevOpsCliToken(run)).rejects.toThrow(AZURE_CLI_ABSENT)
  })

  it('dit de SE CONNECTER quand l outil repond mais sans session', async () => {
    const run = vi.fn(async () => {
      throw new Error('ERROR: Please run az login to setup account.')
    })

    await expect(loadAzureDevOpsCliToken(run)).rejects.toThrow(AZURE_CLI_DECONNECTE)
  })

})
