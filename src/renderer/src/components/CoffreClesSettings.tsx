import { useCallback, useEffect, useState } from 'react'
import { useLangue } from '../langue'
import './CoffreClesSettings.css'

/**
 * Coffre à clés — section « Clés » des réglages.
 *
 * Pourquoi : les agents se servent d'une clé API par son NOM (variable posée dans leurs commandes),
 * sans voir ni afficher sa valeur. Ce panneau tient la liste : ajouter, retirer, réimporter les clés
 * déjà sur le poste. Il ne reçoit JAMAIS une valeur : le moteur ne rend que nom, origine, date et
 * longueur. La seule valeur qui passe ici est celle que l'utilisateur tape, dans un champ masqué,
 * vidé dès qu'elle est enregistrée.
 *
 * Textes : table locale FR/EN, comme `McpServersSettings` — les tables de `textes-ecrans/` sont
 * éditées en parallèle par d'autres fils.
 */

/*
 * Forme des réponses du coffre, recopiée de `CleListee`, `EtatCoffre`, `BilanImport` et
 * `ReponseGesteCoffre` du moteur (`coffre-cles.ts`). Elle vit ici tant que le pont du preload n'est
 * pas déclaré dans `src/preload/index.d.ts` ; une fois déclaré, ces types se tirent de
 * `Window['api']['coffreLister']`, comme le fait `McpServersSettings`.
 */
interface CleListee {
  nom: string
  origine: 'poste' | 'utilisateur'
  ajouteLe: string
  longueur: number
}

interface EtatCoffre {
  disponible: boolean
  raison?: string
  cles: CleListee[]
}

interface BilanImport {
  ajoutees: number
  misesAJour: number
  ignorees: number
  raison?: string
}

interface ReponseGesteCoffre {
  ok: boolean
  erreur?: string
  bilan?: BilanImport
  etat: EtatCoffre
}

interface PontCoffre {
  coffreLister: () => Promise<EtatCoffre>
  coffreAjouter: (nom: string, valeur: string) => Promise<ReponseGesteCoffre>
  coffreRetirer: (nom: string) => Promise<ReponseGesteCoffre>
  coffreReimporter: () => Promise<ReponseGesteCoffre>
}

/** Un pont absent (preload plus ancien) fait échouer l'appel ; l'échec est rendu en message lisible. */
const pont = (): PontCoffre => window.api as Window['api'] & PontCoffre

const TEXTES = {
  fr: {
    titre: 'Clés',
    eyebrow: 'Coffre à clés',
    description:
      'Les agents se servent de ces clés par leur nom, sans voir ni afficher leur valeur.',
    indisponible:
      'Le chiffrement de Windows n’est pas disponible : le coffre ne peut garder aucune clé, et rien n’est jamais écrit en clair.',
    aucune: 'Aucune clé dans le coffre.',
    poste: 'importée du poste',
    utilisateur: 'ajoutée par toi',
    caracteres: (n: number) => `${n} caractère${n > 1 ? 's' : ''}`,
    retirer: 'Retirer',
    nouvelle: 'Ajouter une clé',
    nom: 'Nom',
    valeur: 'Valeur',
    ajouter: 'Ajouter',
    reimporter: 'Réimporter depuis le poste',
    bilan: (b: BilanImport) =>
      `Réimport terminé : ${b.ajoutees} ajoutée${b.ajoutees > 1 ? 's' : ''}` +
      (b.misesAJour > 0 ? `, ${b.misesAJour} mise${b.misesAJour > 1 ? 's' : ''} à jour` : '') +
      '.',
    erreurLecture: 'Impossible de joindre le coffre à clés.',
    langueDate: 'fr-FR'
  },
  en: {
    titre: 'Keys',
    eyebrow: 'Key vault',
    description: 'Agents use these keys by their name, without seeing or showing their value.',
    indisponible:
      'Windows encryption is unavailable: the vault cannot keep any key, and nothing is ever written in clear text.',
    aucune: 'No key in the vault.',
    poste: 'imported from this computer',
    utilisateur: 'added by you',
    caracteres: (n: number) => `${n} character${n > 1 ? 's' : ''}`,
    retirer: 'Remove',
    nouvelle: 'Add a key',
    nom: 'Name',
    valeur: 'Value',
    ajouter: 'Add',
    reimporter: 'Re-import from this computer',
    bilan: (b: BilanImport) =>
      `Re-import done: ${b.ajoutees} added` +
      (b.misesAJour > 0 ? `, ${b.misesAJour} updated` : '') +
      '.',
    erreurLecture: 'Could not reach the key vault.',
    langueDate: 'en-GB'
  }
} as const

function dateLisible(iso: string, langue: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(langue)
}

export function CoffreClesSettings(): React.JSX.Element {
  const langue = useLangue()
  const tx = TEXTES[langue === 'en' ? 'en' : 'fr']
  const [etat, setEtat] = useState<EtatCoffre | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [compteRendu, setCompteRendu] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nom, setNom] = useState('')
  const [valeur, setValeur] = useState('')

  const lire = useCallback(async (): Promise<void> => {
    try {
      setEtat(await pont().coffreLister())
      setErreur(null)
    } catch {
      setErreur(tx.erreurLecture)
    }
  }, [tx])

  useEffect(() => {
    queueMicrotask(() => void lire())
  }, [lire])

  const geste = async (
    action: () => Promise<ReponseGesteCoffre>
  ): Promise<ReponseGesteCoffre | null> => {
    setBusy(true)
    setCompteRendu(null)
    try {
      const r = await action()
      setEtat(r.etat)
      setErreur(r.ok ? null : (r.erreur ?? r.bilan?.raison ?? r.etat.raison ?? tx.erreurLecture))
      return r
    } catch {
      setErreur(tx.erreurLecture)
      return null
    } finally {
      setBusy(false)
    }
  }

  const ajouter = async (): Promise<void> => {
    const r = await geste(() => pont().coffreAjouter(nom.trim(), valeur))
    if (r?.ok) {
      setNom('')
      setValeur('')
    }
  }

  const reimporter = async (): Promise<void> => {
    const r = await geste(() => pont().coffreReimporter())
    if (r?.ok && r.bilan) setCompteRendu(tx.bilan(r.bilan))
  }

  const indisponible = etat !== null && !etat.disponible
  const fige = busy || etat === null || indisponible

  return (
    <section
      className="settings-execution-workspace surface-panel coffre-cles"
      aria-label={tx.titre}
      data-testid="coffre-cles"
    >
      <header>
        <div>
          <span className="domain-eyebrow">{tx.eyebrow}</span>
          <h2>{tx.titre}</h2>
        </div>
      </header>
      <p className="coffre-cles-phrase" data-testid="coffre-phrase">
        {tx.description}
      </p>
      {indisponible && (
        <p role="alert" className="coffre-cles-indisponible" data-testid="coffre-indisponible">
          {tx.indisponible}
          {etat?.raison && <span className="coffre-cles-raison"> {etat.raison}</span>}
        </p>
      )}
      {erreur && (
        <p role="alert" className="coffre-cles-erreur" data-testid="coffre-erreur">
          {erreur}
        </p>
      )}

      {etat && !indisponible && etat.cles.length === 0 && (
        <p className="coffre-cles-vide" data-testid="coffre-vide">
          {tx.aucune}
        </p>
      )}
      {etat && etat.cles.length > 0 && (
        <ul className="coffre-cles-liste" data-testid="coffre-liste">
          {etat.cles.map((c) => (
            <li key={c.nom} className="coffre-cles-ligne" data-testid={`coffre-cle-${c.nom}`}>
              <code className="coffre-cles-nom">{c.nom}</code>
              <span
                className={`coffre-cles-origine is-${c.origine}`}
                data-testid={`coffre-origine-${c.nom}`}
              >
                {c.origine === 'poste' ? tx.poste : tx.utilisateur}
              </span>
              <span className="coffre-cles-detail" data-testid={`coffre-detail-${c.nom}`}>
                {dateLisible(c.ajouteLe, tx.langueDate)} · {tx.caracteres(c.longueur)}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                data-testid={`coffre-retirer-${c.nom}`}
                disabled={busy}
                onClick={() => void geste(() => pont().coffreRetirer(c.nom))}
              >
                {tx.retirer}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="coffre-cles-actions">
        <button
          type="button"
          className="btn btn-sm"
          data-testid="coffre-reimporter"
          disabled={fige}
          onClick={() => void reimporter()}
        >
          {tx.reimporter}
        </button>
        {compteRendu && (
          <span className="coffre-cles-bilan" role="status" data-testid="coffre-bilan">
            {compteRendu}
          </span>
        )}
      </div>

      <h3>{tx.nouvelle}</h3>
      <div className="coffre-cles-formulaire">
        <label>
          {tx.nom}
          <input
            type="text"
            value={nom}
            placeholder="OPENAI_API_KEY"
            spellCheck={false}
            autoComplete="off"
            data-testid="coffre-champ-nom"
            disabled={indisponible}
            onChange={(e) => setNom(e.target.value)}
          />
        </label>
        <label>
          {tx.valeur}
          <input
            type="password"
            value={valeur}
            spellCheck={false}
            autoComplete="new-password"
            data-testid="coffre-champ-valeur"
            disabled={indisponible}
            onChange={(e) => setValeur(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          data-testid="coffre-ajouter"
          disabled={fige || !nom.trim() || !valeur}
          onClick={() => void ajouter()}
        >
          {tx.ajouter}
        </button>
      </div>
    </section>
  )
}
