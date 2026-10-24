import { VARIABLE_IDENTITE } from './identite-entreprise'

/**
 * Profil d'entreprise FICTIF pour les tests du secours par anciens noms. Les tests ne lisent jamais
 * le vrai profil (`entreprise/`) : la suite doit donner le meme resultat avec ou sans lui.
 */
export const PROFIL_ACME = JSON.stringify({
  application: { appId: 'com.acme.autowin-os', dossierEditeur: 'Acme' },
  brain: {
    service: 'acme-brain',
    dossierLocal: 'AcmeBrain',
    dossierMaison: '.acme-brain',
    variables: {
      AUTOWIN_BRAIN_ROOT: 'ACME_BRAIN_ROOT',
      AUTOWIN_BRAIN_CODE_ROOT: 'ACME_BRAIN_CODE_ROOT',
      AUTOWIN_BRAIN_PYTHON: 'ACME_BRAIN_PYTHON',
      AUTOWIN_BRAIN_TOKEN: 'ACME_BRAIN_TOKEN',
      AUTOWIN_BRAIN_ORIGIN: 'ACME_BRAIN_ORIGIN',
      AUTOWIN_BRAIN_PORT: 'ACME_BRAIN_PORT',
      AUTOWIN_WORKSPACES: 'AUTOWIN_ACME_WORKSPACES'
    }
  }
})

/** `env` augmente du profil fictif : ses anciens noms (`ACME_*`) y sont lus en secours. */
export function avecProfilAcme(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { [VARIABLE_IDENTITE]: PROFIL_ACME, ...env }
}
