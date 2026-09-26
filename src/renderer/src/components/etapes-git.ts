// Etapes git proposees par l'onglet Git. Hors de SourceControlPane.tsx : un fichier de composant
// ne doit exporter que des composants (react-refresh/only-export-components).
export type EtapeGit = { label: string; detail: string; prompt: string }

const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`

export function etapesGit(state: { branch: string; ahead: number; behind: number; changes: unknown[] }): EtapeGit[] {
  const etapes: EtapeGit[] = []
  const n = state.changes.length
  const surMain = state.branch === 'main' || state.branch === 'master'
  if (state.behind > 0)
    etapes.push({
      label: 'Récupérer',
      detail: `${pluriel(state.behind, 'commit')} du distant à intégrer`,
      prompt: 'récupère les derniers commits du distant sur la branche courante, sans perdre mes changements en cours'
    })
  if (n > 0)
    etapes.push({
      label: 'Commiter',
      detail: `${pluriel(n, 'fichier')} modifié${n > 1 ? 's' : ''} — résumé puis commit`,
      prompt: 'résume les changements non commités fichier par fichier, puis commite-les avec un message clair'
    })
  if (state.ahead > 0 || n > 0)
    etapes.push({
      label: 'Push',
      detail: state.ahead > 0 ? `${pluriel(state.ahead, 'commit')} à envoyer` : 'après le commit',
      prompt: 'push la branche courante'
    })
  if (!surMain && state.branch)
    etapes.push({
      label: 'Ouvrir une PR',
      detail: `${state.branch} → main`,
      prompt: 'ouvre une pull request pour la branche courante avec une description claire'
    })
  return etapes
}
