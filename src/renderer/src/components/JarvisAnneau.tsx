/**
 * L'ANNEAU JARVIS — la signature visuelle du poste de commande vocal.
 *
 * Pourquoi en SVG et pas en degrade conique masque : un `conic-gradient` masque par un
 * `mask: radial-gradient(...)` s'est revele faux a l'usage (les segments debordaient, le motif se
 * repetait hors de l'arc). Ici chaque arc est un vrai cercle mesure en DEGRES grace a
 * `pathLength="360"` : `stroke-dasharray="24 336"` se lit « 24 degres traces, 336 vides » — plus
 * aucune arithmetique de perimetre, donc plus aucune faute de raccord.
 *
 * REGLE DE VERITE (identique au reste du widget) : la rotation des couronnes est du DECOR, elle
 * tourne toujours ; l'arc d'ETAT (`.jarvis__anneau-etat`) ne s'allume et ne pulse que sous
 * `[data-ecoute='true']` sur `.jarvis`. Un micro coupe ne doit jamais ressembler a un micro ouvert.
 * Verrouille par jarvis-anneau.css.test.ts.
 */
export function JarvisAnneau({
  nom,
  etat
}: {
  nom: string
  /** Le texte court affiche sous le nom : l'etat en UN mot, lisible de loin. */
  etat: string
}): React.JSX.Element {
  return (
    <div className="jarvis__anneau" data-testid="jarvis-anneau" aria-hidden="true">
      <svg viewBox="0 0 100 100" className="jarvis__anneau-svg">
        {/* Couronne de graduations : 60 traits, un par degre-de-six. Tourne lentement. */}
        <circle
          className="jarvis__anneau-graduations"
          cx="50"
          cy="50"
          r="46"
          pathLength="360"
          strokeDasharray="1 5"
        />
        {/* Couronne segmentee externe : quatre arcs inegaux, sens horaire. */}
        <circle
          className="jarvis__anneau-arcs"
          cx="50"
          cy="50"
          r="39"
          pathLength="360"
          strokeDasharray="84 26 52 26 38 26 62 46"
        />
        {/* L'arc ambre isole : un seul segment, sens ANTI-horaire — le contrepoint. */}
        <circle
          className="jarvis__anneau-ambre"
          cx="50"
          cy="50"
          r="32"
          pathLength="360"
          strokeDasharray="46 314"
        />
        {/* L'arc d'ETAT : eteint micro coupe, cyan vif et pulsant micro ouvert. */}
        <circle
          className="jarvis__anneau-etat"
          cx="50"
          cy="50"
          r="25"
          pathLength="360"
          strokeDasharray="240 120"
        />
        <circle className="jarvis__anneau-coeur" cx="50" cy="50" r="19" />
      </svg>
      <div className="jarvis__anneau-texte">
        <strong>{nom.toUpperCase()}</strong>
        <span>{etat}</span>
      </div>
    </div>
  )
}
