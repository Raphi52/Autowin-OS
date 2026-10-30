import { Profiler, type ReactElement, type ReactNode } from 'react'
import { BarriereErreur } from './BarriereErreur'
import { noterRendu, signalerRenduLong } from './rendu-long'

/** Enveloppe une vue et NOMME son rendu quand il tient le fil d'affichage trop longtemps. */
/**
 * `bloc` : sous-bloc mesure A L'INTERIEUR d'une vue deja mesuree (harnais de ChatView). Il nourrit
 * seulement le registre recent ; c'est la vue englobante qui ecrit le gel, sous le nom du sous-bloc
 * dominant — sinon un meme rendu long serait journalise deux fois.
 *
 * LA ZONE MESUREE EST AUSSI LA ZONE PROTEGEE (conv-1327, 2026-10-30) : ce composant entoure deja chaque
 * ecran et les gros blocs du chat, les memes frontieres qu'une panne ne doit pas franchir. `cle` relance
 * le bloc en panne quand elle change (la conversation ouverte, le plus souvent).
 */
export function VueMesuree({
  id,
  bloc = false,
  cle,
  children
}: {
  id: string
  bloc?: boolean
  cle?: unknown
  children: ReactNode
}): ReactElement {
  return (
    <BarriereErreur zone={id} cle={cle}>
      <Profiler
        id={id}
        onRender={(_id, _phase, actualDuration) => {
          noterRendu(id, actualDuration)
          if (!bloc) signalerRenduLong(id, actualDuration)
        }}
      >
        {children}
      </Profiler>
    </BarriereErreur>
  )
}
