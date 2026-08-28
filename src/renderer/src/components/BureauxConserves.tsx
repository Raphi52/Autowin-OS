import { useCallback, useEffect, useState, type JSX } from 'react'
import { Spinner } from './Spinner'

/**
 * LES BUREAUX CONSERVÉS, ET LA PRISE QUI LEUR MANQUAIT.
 *
 * DÉFAUT MESURÉ le 2026-08-25 : 16 bureaux agents enregistrés, 527 Mo, jamais nettoyés — dont 10
 * portant la MÊME édition non compilable (un tour qui a échoué dix fois), et un portant deux tests
 * neufs jamais publiés. Le mécanisme de secours faisait exactement son travail : conserver le
 * bureau, poser la ref, ne rien perdre. Mais PERSONNE ne pouvait rien en faire — la vue Worktrees
 * n'exposait que « choisir un dépôt » et « rafraîchir ». Un secours dont personne ne vient chercher
 * le rescapé n'est pas un secours, c'est un entrepôt.
 *
 * CE COMPOSANT NE CRÉE AUCUNE CAPACITÉ. `discardHeldWorktree`, `retryWorktreeRecovery` et
 * `getPatchTravailNonPublie` existaient déjà côté IPC — seulement câblées dans le panneau bench des
 * workflows, jamais là où l'utilisateur cherche ses bureaux. On branche l'existant au bon endroit
 * (piège du doublon : la capacité manquante était une capacité NON BRANCHÉE).
 *
 * ET ÇA RÉPARE UN MENSONGE : deux messages de refus poussés le même jour (`f80cc4e9`) annoncent
 * « Reprends-le depuis le panneau Worktrees » et « bouton de nettoyage ». Ces gestes n'existaient
 * pas. Un message qui oriente vers l'impossible coûte plus qu'un refus nu.
 *
 * LA CONTRAINTE QUI GOUVERNE LE RENDU : aucune suppression de travail non trié. La purge passe donc
 * par une confirmation explicite, et le nombre de fichiers est affiché AVANT toute action — c'est
 * le seul indice qui permet de deviner qu'un bureau contient du travail sans l'ouvrir.
 */

type VerdictBureau = 'a-reprendre' | 'trie' | 'sans-valeur' | 'inconnu'

/**
 * Le verdict est DERIVE cote principal (`verdict-bureau.ts`), jamais stocke : un etat ecrit a cote
 * du reel s'en desynchronise, un etat derive ne peut pas mentir plus longtemps que sa preuve.
 * Optionnel ici parce qu'un preload plus ancien ne le porte pas — la vue reste lisible sans.
 */
const LIBELLE_VERDICT: Record<VerdictBureau, string> = {
  'a-reprendre': 'À reprendre',
  trie: 'Trié',
  'sans-valeur': 'Sans valeur',
  // « On n'a pas pu lire » n'est pas « il n'y a rien » : le dire plutôt que de rassurer à tort.
  inconnu: 'Lecture impossible'
}

interface TravailNonPublie {
  agentId: string
  date: string
  fichiers: string[]
  verdict?: VerdictBureau
}

export function BureauxConserves(): JSX.Element {
  const [bureaux, setBureaux] = useState<TravailNonPublie[] | undefined>(undefined)
  const [patch, setPatch] = useState<{ agentId: string; texte: string } | undefined>(undefined)
  const [erreur, setErreur] = useState<Record<string, string>>({})

  const charger = useCallback(async (): Promise<void> => {
    try {
      // Appels OPTIONNELS : ces methodes peuvent manquer d'un double de test ou d'un preload plus
      // ancien. Une capacite absente rend une vue vide, jamais un crash.
      const liste = await window.api.getTravauxNonPublies?.()
      setBureaux(liste ?? [])
    } catch {
      // Une lecture en panne ne doit pas vider la vue : on distingue « pas encore lu » de « vide ».
      setBureaux([])
    }
  }, [])

  useEffect(() => {
    // L'appel est enveloppe dans une fonction async DECLAREE : `charger` n'atteint jamais un
    // `setState` avant son premier `await`, mais l'ecrire ainsi le rend visible au compilateur React
    // (sinon il suppose un `setState` synchrone dans l'effet, et des rendus en cascade).
    // Un `setTimeout(0)` avait ete essaye d'abord : il satisfaisait la regle et cassait SIX tests,
    // parce qu'il repoussait le chargement au-dela du rendu — la regle etait respectee, le
    // composant devenu moins bon. On ne plie pas le produit pour un linter.
    const amorcer = async (): Promise<void> => {
      await charger()
    }
    void amorcer()
  }, [charger])

  const nommerErreur = (agentId: string, cause: unknown): void =>
    setErreur((courant) => ({
      ...courant,
      [agentId]: cause instanceof Error ? cause.message : String(cause)
    }))

  const voirLeDiff = async (agentId: string): Promise<void> => {
    try {
      const resultat = await window.api.getPatchTravailNonPublie?.(agentId)
      setPatch({ agentId, texte: resultat?.patch ?? '' })
    } catch (cause) {
      nommerErreur(agentId, cause)
    }
  }

  const reprendre = async (agentId: string): Promise<void> => {
    try {
      await window.api.retryWorktreeRecovery?.(agentId)
      await charger()
    } catch (cause) {
      nommerErreur(agentId, cause)
    }
  }

  const purger = async (agentId: string, fichiers: number): Promise<void> => {
    // La confirmation NOMME ce qui est en jeu. « Supprimer ce bureau ? » sans le nombre de fichiers
    // laisserait l'utilisateur valider la destruction d'un travail qu'il ne sait pas être là.
    const question =
      fichiers > 0
        ? `Supprimer définitivement ce bureau ? Il contient ${fichiers} fichier(s) non publié(s).`
        : 'Supprimer définitivement ce bureau ?'
    if (!window.confirm(question)) return
    try {
      const supprime = await window.api.discardHeldWorktree?.(agentId)
      if (!supprime) throw new Error("Ce bureau n'est plus supprimable.")
      await charger()
    } catch (cause) {
      nommerErreur(agentId, cause)
    }
  }

  if (bureaux === undefined)
    return (
      <section className="bureaux-conserves">
        <Spinner /> Lecture…
      </section>
    )

  return (
    <section className="bureaux-conserves" data-testid="bureaux-conserves">
      <h3 className="bureaux-conserves-titre">Bureaux conservés</h3>
      {bureaux.length === 0 ? (
        <p className="bureaux-conserves-vide">Aucun bureau conservé — rien à trier.</p>
      ) : (
        <ul className="bureaux-conserves-liste">
          {bureaux.map((bureau) => (
            <li key={bureau.agentId} className="bureaux-conserves-item">
              <span className="bureaux-conserves-nom">{bureau.agentId}</span>
              {bureau.verdict && (
                <span
                  className={`bureaux-conserves-verdict is-${bureau.verdict}`}
                  data-testid={`verdict-${bureau.agentId}`}
                >
                  {LIBELLE_VERDICT[bureau.verdict]}
                </span>
              )}
              <span className="bureaux-conserves-meta">
                {bureau.date} · {bureau.fichiers.length} fichiers
              </span>
              <button type="button" onClick={() => void voirLeDiff(bureau.agentId)}>
                Voir le diff
              </button>
              <button type="button" onClick={() => void reprendre(bureau.agentId)}>
                Reprendre
              </button>
              <button
                type="button"
                className="bureaux-conserves-purger"
                onClick={() => void purger(bureau.agentId, bureau.fichiers.length)}
              >
                Purger
              </button>
              {erreur[bureau.agentId] && (
                <span className="bureaux-conserves-erreur">{erreur[bureau.agentId]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {patch && (
        <pre className="bureaux-conserves-patch" data-testid="bureaux-conserves-patch">
          {patch.texte}
        </pre>
      )}
    </section>
  )
}
