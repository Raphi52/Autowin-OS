import { ProdProtectionSettings } from './ProdProtectionSettings'

/**
 * ONGLET « RULES » DE SETTINGS — les règles d'Autowin OS.
 *
 * La protection de production avait son propre onglet « Production ». Demande conv-242 : l'onglet
 * devient « Rules » et Production y devient UNE règle d'Autowin OS. Chaque règle reste son propre
 * panneau (titre = nom de la règle) ; une nouvelle règle s'ajoute à cette liste.
 */
const REGLES_AUTOWIN_OS: ReadonlyArray<{ id: string; Panneau: () => React.JSX.Element }> = [
  { id: 'production', Panneau: ProdProtectionSettings }
]

export function RulesView(): React.JSX.Element {
  return (
    <div className="settings-rules" aria-label="Rules d’Autowin OS" data-testid="settings-rules">
      {REGLES_AUTOWIN_OS.map(({ id, Panneau }) => (
        <Panneau key={id} />
      ))}
    </div>
  )
}
