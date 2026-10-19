import { createContext } from 'react'
import type { ScopedLiveRun } from './chat-view-model'
import type { StepDeRun } from './juges-votes'

/**
 * LES RUNS EN COURS, tels que le fil les reçoit (`ChatView`, état `liveRuns`), offerts aux blocs
 * du fil qui doivent se remplir PENDANT le run — le bloc des juges d'abord (conv-1021, 2026-10-19).
 *
 * Un contexte plutôt qu'une prop : le fil rendu est mémoïsé (`filRendu`, conv-1464) et chaque morceau
 * de texte streamé change `liveRuns` toutes les 50 ms. Passé en prop, il re-rendrait TOUTES les
 * lignes du fil ; par contexte, seul le bloc qui le lit se re-rend.
 */
export const RunsEnDirect = createContext<Readonly<Record<string, ScopedLiveRun<StepDeRun>>>>({})
