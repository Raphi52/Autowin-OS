import { useCallback, useEffect, useState } from 'react'
import type { ProjectEntry } from '../../../main/project-files'
import { langueCourante } from '../langue'
import { traduireChatPanneaux, useTextesChatPanneaux } from '../textes-ecrans/chat-panneaux'
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
export function ProjectPane({
  conversationId,
  racine,
  modifies = []
}: {
  /** Chemins relatifs modifiés par la conversation : surlignés dans l'arbre (et leurs dossiers). */
  modifies?: readonly string[]
  /** Conversation dont le CWD sert de racine (resolu cote principal). */
  conversationId?: string
  /** CWD courant : quand il CHANGE, l'arbre se recharge et l'editeur se referme. */
  racine?: string
} = {}): React.JSX.Element {
  const { t } = useTextesChatPanneaux()
  const [racines, setRacines] = useState<ProjectEntry[]>([])
  const [ouverts, setOuverts] = useState<Record<string, ProjectEntry[]>>({})
  const [deplies, setDeplies] = useState<Record<string, boolean>>({})
  const [fichier, setFichier] = useState<string | null>(null)
  const [texte, setTexte] = useState('')
  const [initial, setInitial] = useState('')
  // L'ÉTAT, pas son texte : il se traduit à l'affichage et suit un changement de langue (conv-1170).
  const [etat, setEtat] = useState<'' | 'enregistrement' | 'enregistre'>('')
  const [erreur, setErreur] = useState<string>('')
  const [vscodeEnCours, setVscodeEnCours] = useState(false)

  const fichiersModifies = new Set(modifies)
  const dossiersModifies = new Set<string>()
  for (const m of modifies) {
    const parts = m.split('/')
    for (let i = 1; i < parts.length; i++) dossiersModifies.add(parts.slice(0, i).join('/'))
  }
  const estModifie = (entry: ProjectEntry): boolean =>
    entry.kind === 'dir' ? dossiersModifies.has(entry.path) : fichiersModifies.has(entry.path)

  const lister = useCallback(async (chemin: string): Promise<ProjectEntry[]> => {
    const r = await window.api.listProjectDir(chemin, conversationId)
    if (!r.ok) {
      setErreur(
        traduireChatPanneaux('projet.dossierIllisible', langueCourante(), { raison: r.reason })
      )
      return []
    }
    return r.entries
  }, [conversationId])

  // Nouveau CWD ou nouvelle conversation : l'ancien arbre et le fichier ouvert n'y existent plus.
  // Remise a zero PENDANT le rendu (motif React « ajuster l'etat quand une prop change ») plutot
  // qu'un setState synchrone dans l'effet, qui rendait d'abord l'ancien arbre une fois de trop.
  const cleArbre = `${conversationId ?? ''}|${racine ?? ''}`
  const [cleVue, setCleVue] = useState(cleArbre)
  if (cleVue !== cleArbre) {
    setCleVue(cleArbre)
    setOuverts({})
    setDeplies({})
    setFichier(null)
    setErreur('')
    setEtat('')
  }

  useEffect(() => {
    let vivant = true
    void (async () => {
      const entries = await lister('')
      if (vivant) setRacines(entries)
    })()
    return () => {
      vivant = false
    }
  }, [lister, racine])

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
    const r = await window.api.readProjectFile(entry.path, conversationId)
    if (!r.ok) {
      setErreur(t('projet.fichierIllisible', { raison: r.reason }))
      return
    }
    setFichier(r.path)
    setTexte(r.content)
    setInitial(r.content)
  }

  const enregistrer = async (): Promise<void> => {
    if (!fichier) return
    setEtat('enregistrement')
    const r = await window.api.writeProjectFile(fichier, texte, conversationId)
    if (!r.ok) {
      setEtat('')
      setErreur(t('projet.ecritureRefusee', { raison: r.reason }))
      return
    }
    setInitial(texte)
    setEtat('enregistre')
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
          {t('projet.enregistrer')}
        </button>
        <button
          type="button"
          className="pp-fermer"
          data-testid="pp-fermer"
          title={t('projet.fermer')}
          aria-label={t('projet.fermer')}
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
      {etat && (
        <div className="pp-etat">
          {t(etat === 'enregistrement' ? 'projet.enregistrement' : 'projet.enregistre')}
        </div>
      )}
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
        className={`pp-noeud${fichier === entry.path ? ' is-active' : ''}${
          estModifie(entry) ? ' is-modifie' : ''
        }`}
        title={estModifie(entry) ? t('projet.modifie') : undefined}
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
          title={t('projet.vscode.titre')}
          disabled={vscodeEnCours}
          onClick={() => {
            setVscodeEnCours(true)
            setErreur('')
            void window.api
              .openProjectInVscode(conversationId)
              .then((r) => {
                if (!r.ok) setErreur(t('projet.vscode.erreur', { raison: r.raison }))
              })
              .finally(() => setVscodeEnCours(false))
          }}
        >
          {vscodeEnCours ? t('projet.vscode.ouverture') : t('projet.vscode')}
        </button>
      </div>
      <div className="pp-arbre scroll-y" role="tree" aria-label={t('projet.arborescence')}>
        {racines.length === 0 && <div className="c-faint pp-vide">{t('projet.vide')}</div>}
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
