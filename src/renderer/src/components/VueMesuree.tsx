import { Profiler, type ReactElement, type ReactNode } from 'react'
import { noterRendu, signalerRenduLong } from './rendu-long'

/** Enveloppe une vue et NOMME son rendu quand il tient le fil d'affichage trop longtemps. */
/**
 * `bloc` : sous-bloc mesure A L'INTERIEUR d'une vue deja mesuree (harnais de ChatView). Il nourrit
 * seulement le registre recent ; c'est la vue englobante qui ecrit le gel, sous le nom du sous-bloc
 * dominant — sinon un meme rendu long serait journalise deux fois.
 */
export function VueMesuree({
  id,
  bloc = false,
  children
}: {
  id: string
  bloc?: boolean
  children: ReactNode
}): ReactElement {
  return (
    <Profiler
      id={id}
      onRender={(_id, _phase, actualDuration) => {
        noterRendu(id, actualDuration)
        if (!bloc) signalerRenduLong(id, actualDuration)
      }}
    >
      {children}
    </Profiler>
  )
}
