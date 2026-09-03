import { Profiler, type ReactElement, type ReactNode } from 'react'
import { noterRendu, signalerRenduLong } from './rendu-long'

/** Enveloppe une vue et NOMME son rendu quand il tient le fil d'affichage trop longtemps. */
export function VueMesuree({ id, children }: { id: string; children: ReactNode }): ReactElement {
  return (
    <Profiler
      id={id}
      onRender={(_id, _phase, actualDuration) => {
        noterRendu(id, actualDuration)
        signalerRenduLong(id, actualDuration)
      }}
    >
      {children}
    </Profiler>
  )
}
