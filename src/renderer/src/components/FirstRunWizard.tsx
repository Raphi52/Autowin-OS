import React, { useCallback, useEffect, useRef, useState } from 'react'
import './FirstRunWizard.css'
import { repairAffordance } from './preflight-repair-affordance'
import { Spinner } from './Spinner'

/**
 * #5 — Wizard first-run. L'installeur NSIS installe l'APP, mais ne peut pas tout automatiser (OAuth
 * codex/claude interactif, brain_server = service Python séparé, tokens secrets). Ce wizard DÉTECTE
 * l'état réel (via preflight:recheck), GUIDE explicitement le reste (étapes/commandes exactes), et
 * offre un bouton "re-vérifier". HONNÊTE : il ne prétend JAMAIS avoir configuré ce qu'il n'a pas fait.
 * VISIBILITÉ pilotée par l'ÉTAT (pas par un flag first-run) : n'apparaît QUE si une dépendance est
 * ROUGE. Tout vert → jamais affiché. Se referme seul si tout repasse vert (push `onPreflight`).
 * « Continuer quand même » = fermeture de session (ne re-nague pas tant qu'un rouge persiste).
 */
interface Check {
  id: string
  label: string
  ok: boolean
  detail?: string
}
interface PreflightResult {
  ok: boolean
  summary: string
  checks: Check[]
}

/** Cadence de re-sonde pendant un démarrage, et patience au-delà de laquelle on cesse d'attendre. */
const STARTUP_PROBE_MS = 3000
const STARTUP_PATIENCE_MS = 120_000

/**
 * Provider concerné par un check, pour l'affordance « Facultatif ». Rend null pour les checks non
 * liés à un provider (brain…).
 */
function checkProvider(id: string): 'codex' | 'claude' | 'kimi' | null {
  if (id === 'codex' || id === 'codex-session') return 'codex'
  if (id === 'claude' || id === 'claude-session') return 'claude'
  if (id === 'kimi') return 'kimi'
  return null
}

export function FirstRunWizard(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<PreflightResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Réparation en cours (id du check) et dernier compte-rendu par check. Un compte-rendu n'affirme
  // JAMAIS que le prérequis est réparé : il dit ce qui a été lancé, le re-diagnostic tranche.
  const [repairing, setRepairing] = useState<string | null>(null)
  const [repairNotes, setRepairNotes] = useState<Record<string, string>>({})
  /**
   * Prérequis dont le démarrage est LANCÉ mais pas encore effectif. `repairing` ne couvre que
   * l'appel lui-même (quelques millisecondes) : le brain_server, lui, chauffe ~30-40 s. Sans cet
   * état, la ligne repassait aussitôt à « ✗ injoignable » alors que le démarrage était en cours.
   * Effacé dès que le prérequis passe au vert (ou au bout du délai de patience).
   */
  const [starting, setStarting] = useState<Record<string, boolean>>({})
  // Fermé manuellement par l'utilisateur malgré un rouge → on ne ré-ouvre pas en boucle tant que
  // l'état reste rouge ; un retour au vert efface ce drapeau (prochain rouge ré-ouvrira).
  const dismissedRef = useRef(false)

  const reqRef = useRef(0)
  const initialActionRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Applique un résultat de preflight : GREEN → jamais/plus affiché ; ROUGE → affiché (sauf dismiss).
  const applyResult = useCallback((r: PreflightResult) => {
    setResult(r)
    // Un prérequis passé au vert n'est plus « en démarrage » : on éteint son indicateur.
    setStarting((s) => {
      const next = { ...s }
      let changed = false
      for (const check of r.checks) {
        if (check.ok && next[check.id]) {
          delete next[check.id]
          changed = true
        }
      }
      return changed ? next : s
    })
    if (r.ok) {
      dismissedRef.current = false
      setOpen(false)
    } else if (!dismissedRef.current) {
      setOpen(true)
    }
  }, [])

  const recheck = useCallback(
    async (force = false) => {
      if (!window.api?.recheckPreflight) {
        setError('Le diagnostic est indisponible. Réessayez après le redémarrage de l’application.')
        return
      }
      const req = ++reqRef.current
      setChecking(true)
      setError(null)
      try {
        const r = (await window.api.recheckPreflight(force)) as PreflightResult
        // Anti-race (Corrector) : ignorer une réponse périmée si un appel plus récent a démarré.
        if (req === reqRef.current) applyResult(r)
      } catch {
        if (req === reqRef.current) {
          setError('Le diagnostic a échoué. Vérifiez la configuration puis réessayez.')
          // Un échec de diagnostic EST un problème → ouvrir le wizard (sauf dismiss de session).
          if (!dismissedRef.current) setOpen(true)
        }
      } finally {
        if (req === reqRef.current) setChecking(false)
      }
    },
    [applyResult]
  )

  /**
   * Un provider mis en STANDBY est exclu du diagnostic (ses checks passent `standby`) et le réglage
   * est persistant côté main : la popup ne le réclame plus.
   */
  const markOptional = useCallback(
    async (checkId: string) => {
      const provider = checkProvider(checkId)
      if (!provider || !window.api?.setProviderMode) return
      try {
        await window.api.setProviderMode(provider, 'standby')
        await recheck(true)
      } catch {
        setError('Impossible de marquer ce prérequis comme facultatif.')
      }
    },
    [recheck]
  )

  const clearStarting = useCallback((checkId: string) => {
    setStarting((s) => {
      if (!s[checkId]) return s
      const next = { ...s }
      delete next[checkId]
      return next
    })
  }, [])

  const repair = useCallback(
    async (checkId: string) => {
      if (!window.api?.repairPreflight) {
        setRepairNotes((n) => ({ ...n, [checkId]: 'Réparation indisponible dans cette version.' }))
        return
      }
      setRepairing(checkId)
      setStarting((s) => ({ ...s, [checkId]: true }))
      try {
        const outcome = await window.api.repairPreflight(checkId)
        const detail =
          outcome && typeof outcome.detail === 'string' && outcome.detail
            ? outcome.detail
            : 'Action lancée.'
        setRepairNotes((n) => ({ ...n, [checkId]: detail }))
        // Un lancement qui a ÉCHOUÉ n'est pas « en cours » : on éteint l'indicateur tout de suite,
        // sinon la ligne tournerait jusqu'au bout de la patience sur un service qui ne viendra pas.
        if (outcome && outcome.started === false) clearStarting(checkId)
      } catch {
        setRepairNotes((n) => ({
          ...n,
          [checkId]: 'La réparation a échoué. Voir la commande ci-dessus.'
        }))
        clearStarting(checkId)
      } finally {
        setRepairing(null)
        // Le login est INTERACTIF et le brain met ~30-40 s : on re-sonde pour rafraîchir l'affichage,
        // sans prétendre que le prérequis est réglé (un rouge qui reste rouge reste rouge).
        void recheck(true)
      }
    },
    [recheck, clearStarting]
  )

  useEffect(() => {
    // Montage : diagnostic initial (sans force → partage le cache du run de démarrage) + abonnement
    // aux pushs live (watchAppPreflight) → la fenêtre s'ouvre/ferme au gré de l'état réel.
    // Synchronise immédiatement la modale avec le diagnostic externe au montage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recheck(false)
    const off = window.api?.onPreflight?.((r) => applyResult(r as PreflightResult))
    return () => off?.()
  }, [recheck, applyResult])

  useEffect(() => {
    // Tant qu'un prérequis démarre, on re-sonde : c'est ce qui fait disparaître la fenêtre d'elle-même
    // dès que le service répond, sans que l'utilisateur ait à cliquer « Re-vérifier ». Borné : au-delà
    // de la patience, on éteint l'indicateur plutôt que de tourner indéfiniment sur un démarrage raté.
    if (Object.keys(starting).length === 0) return
    const deadline = Date.now() + STARTUP_PATIENCE_MS
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        setStarting({})
        return
      }
      void recheck(true)
    }, STARTUP_PROBE_MS)
    return () => clearInterval(timer)
  }, [starting, recheck])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    initialActionRef.current?.focus()
    return () => {
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
    }
  }, [open])

  if (!open) return null
  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const actions = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    )
    if (actions.length === 0) return
    const first = actions[0]
    const last = actions[actions.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  const finish = (): void => {
    // Fermeture manuelle malgré un rouge → dismiss de session (ne ré-ouvre pas en boucle) ; un
    // retour au vert (applyResult) réarme. Pas de persistance disque : la visibilité suit l'ÉTAT.
    dismissedRef.current = true
    setOpen(false)
  }
  return (
    <div
      className="frw-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-wizard-title"
      data-testid="first-run-wizard"
      onKeyDown={trapFocus}
    >
      <div className="frw-card">
        <h2 id="first-run-wizard-title">Bienvenue dans Autowin OS</h2>
        <p className="frw-sub">
          Vérification des dépendances externes. L’installeur a posé l’app ; certaines dépendances
          se configurent une seule fois, ici.
        </p>
        <ul className="frw-checks">
          {(result?.checks ?? []).map((c) => {
            // « En démarrage » n'est ni vert ni rouge : le service a été lancé, il chauffe.
            const pending = !c.ok && starting[c.id] === true
            return (
              <li
                key={c.id}
                className={c.ok ? 'ok' : pending ? 'pending' : 'ko'}
                data-testid={`frw-check-${c.id}`}
              >
                <span className="frw-icon">
                  {c.ok ? (
                    '✓'
                  ) : pending ? (
                    <Spinner data-testid={`frw-spinner-${c.id}`} />
                  ) : (
                    '✗'
                  )}
                </span>
                <span className="frw-label">{c.label}</span>
                {pending ? (
                  <span className="frw-detail" role="status">
                    <Spinner /> en cours… la fenêtre se ferme dès que c’est prêt
                  </span>
                ) : !c.ok && c.detail ? (
                  <span className="frw-detail">{c.detail}</span>
                ) : null}
                {!c.ok && repairAffordance(c.id) ? (
                  <button
                    type="button"
                    className="frw-repair"
                    data-testid={`frw-repair-${c.id}`}
                    title={repairAffordance(c.id)?.note}
                    onClick={() => void repair(c.id)}
                    disabled={repairing !== null || checking || pending}
                  >
                    {repairing === c.id || pending ? 'En cours…' : repairAffordance(c.id)?.label}
                  </button>
                ) : null}
                {/* Prérequis d'un provider en échec = FACULTATIF possible : le passer en standby
                  (mémorisé) l'exclut du diagnostic → la popup ne le réclamera plus. */}
                {!c.ok && checkProvider(c.id) ? (
                  <button
                    type="button"
                    className="frw-optional"
                    data-testid={`frw-optional-${c.id}`}
                    title={`Marquer ${checkProvider(c.id)} comme facultatif : il sera ignoré au démarrage (réactivable dans Models).`}
                    onClick={() => void markOptional(c.id)}
                    disabled={repairing !== null || checking || pending}
                  >
                    Facultatif — ne plus demander
                  </button>
                ) : null}
                {repairNotes[c.id] ? (
                  <span className="frw-repair-note" data-testid={`frw-repair-note-${c.id}`}>
                    {repairNotes[c.id]}
                  </span>
                ) : null}
              </li>
            )
          })}
          {error ? (
            <li className="frw-error" role="alert">
              {error}
            </li>
          ) : null}
          {!result && !error && <li className="frw-loading">Vérification…</li>}
        </ul>
        <div className="frw-actions">
          <button
            ref={initialActionRef}
            type="button"
            onClick={() => void recheck(true)}
            disabled={checking}
          >
            {checking ? 'Vérification…' : error ? 'Réessayer' : 'Re-vérifier'}
          </button>
          <button type="button" className="frw-primary" onClick={finish}>
            {result?.ok ? 'Terminer' : 'Continuer quand même'}
          </button>
        </div>
      </div>
    </div>
  )
}
