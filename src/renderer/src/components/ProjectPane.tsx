import { useCallback, useEffect, useState } from 'react'
import type { ProjectEntry } from '../../../main/project-files'
import './ProjectPane.css'

/**
 * L'onglet « Projet » : l'arborescence du projet, et l'éditeur du fichier ouvert INSÉRÉ DANS
 * L'ARBRE, juste sous la ligne sélectionnée (demande de l'utilisateur du 2026-09-12), refermable
 * par une croix. L'éditeur n'est plus un bloc fixe en bas : on édite là où on a cliqué.
 *
 * L'arbre se charge DOSSIER PAR DOSSIER au dépliage — charger tout d'un coup fige l'interface sur
 * un dépôt réel. L'écriture ne passe que par le canal `project:write`, borné à la racine côté
 * principal : ici on n'ajoute aucune garde de chemin, on ne la duplique pas.
 */
export function ProjectPane(): React.JSX.Element {
  const [racines, setRacines] = useState<ProjectEntry[]>([])
  const [ouverts, setOuverts] = useState<Record<string, ProjectEntry[]>>({})
  const [deplies, setDeplies] = useState<Record<string, boolean>>({})
  const [fichier, setFichier] = useState<string | null>(null)
  const [texte, setTexte] = useState('')
  const [initial, setInitial] = useState('')
  const [etat, setEtat] = useState<string>('')
  const [erreur, setErreur] = useState<string>('')
  const [vscodeEnCours, setVscodeEnCours] = useState(false)

  const lister = useCallback(async (chemin: string): Promise<ProjectEntry[]> => {
    const r = await window.api.listProjectDir(chemin)
    if (!r.ok) {
      setErreur(`Dossier illisible : ${r.reason}`)
      return []
    }
    return r.entries
  }, [])

  useEffect(() => {
    let vivant = true
    void (async () => {
      const entries = await lister('')
      if (vivant) setRacines(entries)
    })()
    return () => {
      vivant = false
    }
  }, [lister])

  const basculer = async (entry: ProjectEntry): Promise<void> => {
    const estDeplie = !!deplies[entry.path]
    setDeplies((d) => ({ ...d, [entry.path]: !estDeplie }))
    if (!estDeplie && !ouverts[entry.path]) {
      const entries = await lister(entry.path)
      setOuverts((o) => ({ ...o, [entry.path]: entries }))
    }
  }

  const ouvrir = async (entry: ProjectEntry): Promise<void> => {
    setErreur('')
    setEtat('')
    const r = await window.api.readProjectFile(entry.path)
    if (!r.ok) {
      setErreur(`Fichier illisible : ${r.reason}`)
      return
    }
    setFichier(r.path)
    setTexte(r.content)
    setInitial(r.content)
  }

  const enregistrer = async (): Promise<void> => {
    if (!fichier) return
    setEtat('Enregistrement…')
    const r = await window.api.writeProjectFile(fichier, texte)
    if (!r.ok) {
      setEtat('')
      setErreur(`Écriture refusée : ${r.reason}`)
      return
    }
    setInitial(texte)
    setEtat('Enregistré')
  }

  const modifie = fichier !== null && texte !== initial

  const fermer = (): void => {
    setFichier(null)
    setTexte('')
    setInitial('')
    setEtat('')
    setErreur('')
  }

  const rendreEditeur = (niveau: number): React.JSX.Element => (
    <div className="pp-editeur" data-testid="pp-editeur" style={{ marginLeft: 6 + niveau * 12 }}>
      <div className="pp-editeur-head">
        <span className="pp-chemin" title={fichier ?? ''}>
          {fichier}
          {modifie ? ' •' : ''}
        </span>
        <button
          type="button"
          className="pp-enregistrer"
          data-testid="pp-enregistrer"
          disabled={!modifie}
          onClick={() => void enregistrer()}
        >
          Enregistrer
        </button>
        <button
          type="button"
          className="pp-fermer"
          data-testid="pp-fermer"
          title="Fermer l’éditeur"
          aria-label="Fermer l’éditeur"
          onClick={fermer}
        >
          ×
        </button>
      </div>
      <textarea
        className="pp-zone"
        data-testid="pp-zone"
        spellCheck={false}
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value)
          setEtat('')
        }}
      />
      {etat && <div className="pp-etat">{etat}</div>}
      {erreur && (
        <div className="pp-erreur" role="alert">
          {erreur}
        </div>
      )}
    </div>
  )

  const rendreNoeud = (entry: ProjectEntry, niveau: number): React.JSX.Element => (
    <div key={entry.path}>
      <button
        type="button"
        className={`pp-noeud${fichier === entry.path ? ' is-active' : ''}`}
        style={{ paddingLeft: 6 + niveau * 12 }}
        data-testid={`pp-noeud-${entry.path}`}
        onClick={() => void (entry.kind === 'dir' ? basculer(entry) : ouvrir(entry))}
      >
        <span className="pp-glyphe" aria-hidden="true">
          {entry.kind === 'dir' ? (deplies[entry.path] ? '▾' : '▸') : '·'}
        </span>
        <span className="pp-nom">{entry.name}</span>
      </button>
      {entry.kind !== 'dir' && fichier === entry.path && rendreEditeur(niveau)}
      {entry.kind === 'dir' &&
        deplies[entry.path] &&
        (ouverts[entry.path] ?? []).map((enfant) => rendreNoeud(enfant, niveau + 1))}
    </div>
  )

  return (
    <div className="project-pane" data-testid="project-pane">
      <div className="pp-barre">
        <button
          type="button"
          className="pp-vscode"
          data-testid="pp-vscode"
          title="Ouvrir tout le projet dans VS Code"
          disabled={vscodeEnCours}
          onClick={() => {
            setVscodeEnCours(true)
            setErreur('')
            void window.api
              .openProjectInVscode()
              .then((r) => {
                if (!r.ok) setErreur(`VS Code : ${r.raison}`)
              })
              .finally(() => setVscodeEnCours(false))
          }}
        >
          {vscodeEnCours ? 'Ouverture (installation si absent)…' : 'Ouvrir dans VS Code'}
        </button>
      </div>
      <div className="pp-arbre scroll-y" role="tree" aria-label="Arborescence du projet">
        {racines.length === 0 && <div className="c-faint pp-vide">Arborescence vide.</div>}
        {racines.map((e) => rendreNoeud(e, 0))}
      </div>
      {erreur && !fichier && (
        <div className="pp-erreur" role="alert">
          {erreur}
        </div>
      )}
    </div>
  )
}
