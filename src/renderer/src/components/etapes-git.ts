import { langueCourante } from '../langue'
import { traduireChatPanneaux } from '../textes-ecrans/chat-panneaux'

// Etapes git proposees par l'onglet Git. Hors de SourceControlPane.tsx : un fichier de composant
// ne doit exporter que des composants (react-refresh/only-export-components).
// `label` et `detail` suivent la langue de l'interface (conv-1170) : appelés pendant le rendu du
// panneau, qui lit la langue. `prompt` reste en français : c'est la consigne envoyée à l'agent.
export type EtapeGit = { label: string; detail: string; prompt: string }

export function etapesGit(state: { branch: string; ahead: number; behind: number; changes: unknown[] }): EtapeGit[] {
  const langue = langueCourante()
  const etapes: EtapeGit[] = []
  const n = state.changes.length
  const surMain = state.branch === 'main' || state.branch === 'master'
  if (state.behind > 0)
    etapes.push({
      label: traduireChatPanneaux('etapes.recuperer', langue),
      detail: traduireChatPanneaux(
        state.behind > 1 ? 'etapes.recuperer.detail.plusieurs' : 'etapes.recuperer.detail.un',
        langue,
        { n: state.behind }
      ),
      prompt: 'récupère les derniers commits du distant sur la branche courante, sans perdre mes changements en cours'
    })
  if (n > 0)
    etapes.push({
      label: traduireChatPanneaux('etapes.commiter', langue),
      detail: traduireChatPanneaux(
        n > 1 ? 'etapes.commiter.detail.plusieurs' : 'etapes.commiter.detail.un',
        langue,
        { n }
      ),
      prompt: 'résume les changements non commités fichier par fichier, puis commite-les avec un message clair'
    })
  if (state.ahead > 0 || n > 0)
    etapes.push({
      // Terme Git, identique dans les deux langues.
      label: 'Push',
      detail:
        state.ahead > 0
          ? traduireChatPanneaux(
              state.ahead > 1 ? 'etapes.push.detail.plusieurs' : 'etapes.push.detail.un',
              langue,
              { n: state.ahead }
            )
          : traduireChatPanneaux('etapes.push.apresCommit', langue),
      prompt: 'push la branche courante'
    })
  if (!surMain && state.branch)
    etapes.push({
      label: traduireChatPanneaux('etapes.pr', langue),
      detail: `${state.branch} → main`,
      prompt: 'ouvre une pull request pour la branche courante avec une description claire'
    })
  return etapes
}
