/**
 * LES CANAUX DES WORKFLOWS NOMMÉS, sortis de `src/main/index.ts`.
 *
 * Huit canaux : lire le fichier des workflows, lire et accuser réception d'un refus, créer ou
 * modifier, supprimer, sélectionner, exporter vers un fichier, importer depuis un fichier.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, mêmes
 * validations. Trois règles de fond que le déplacement ne touche pas :
 *   - toute écriture RÉAPPLIQUE ensuite le workflow actif. Sans cela, éditer le graphe du workflow
 *     en cours laisserait le moteur jouer la version d'avant, en silence ; et supprimer le
 *     workflow actif le laisserait piloter un profil mort ;
 *   - un fichier importé n'est JAMAIS cru : il passe par le même assainisseur que la relecture
 *     locale, et un identifiant en collision est ré-attribué plutôt que d'écraser le voisin ;
 *   - l'identifiant d'un refus doit être un entier sûr, pas seulement « un nombre ».
 *
 * La boîte des refus et la réapplication du workflow actif vivent dans `index.ts` (elles servent
 * aussi au démarrage) : elles sont reçues, pas recopiées.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import {
  loadWorkflowProfiles,
  removeWorkflowProfile,
  saveWorkflowProfiles,
  selectWorkflowProfile,
  upsertWorkflowProfile,
  type WorkflowProfile,
  type WorkflowProfilesFile
} from '../workflow-profiles'
import { buildExport, readImport, suggestedFileName } from '../workflow-transfer'
import type { AppEvent } from '../commands'

/** Ce que les canaux des workflows prenaient dans `index.ts` — désormais passé explicitement. */
export type WorkflowProfilesIpcDeps = {
  /** La boîte des refus de workflow : lue et acquittée depuis la vue. */
  workflowRefusalMailbox: {
    peek: () => unknown
    acknowledge: (id: number) => unknown
  }
  /** Réapplique le workflow actif au moteur après CHAQUE écriture. */
  appliquerWorkflowActif: (fichier: WorkflowProfilesFile) => void
  /** Le sélecteur natif « ouvrir un fichier » — rend `null` si l'utilisateur annule. */
  pickPath: (
    sender: Electron.WebContents,
    kind: 'openDirectory' | 'openFile'
  ) => Promise<string | null>
  /** Le sélecteur natif « enregistrer sous » — rend `null` si l'utilisateur annule. */
  pickSavePath: (sender: Electron.WebContents, defaultPath: string) => Promise<string | null>
  /** Prévenir les écrans que les workflows ont changé. */
  broadcast: (e: AppEvent) => void
}

export function registerWorkflowProfilesIpc({
  workflowRefusalMailbox,
  appliquerWorkflowActif,
  pickPath,
  pickSavePath,
  broadcast
}: WorkflowProfilesIpcDeps): void {
  ipcMain.handle('os:workflowProfiles:get', (event) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    return loadWorkflowProfiles()
  })
  ipcMain.handle('os:workflowProfiles:notice', (event) => {
    assertTrustedRendererSender(event, 'Workflow profile notice')
    return workflowRefusalMailbox.peek()
  })
  ipcMain.handle('os:workflowProfiles:acknowledgeNotice', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profile notice acknowledgement')
    if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId)) {
      throw new Error('Identifiant de notice invalide')
    }
    return workflowRefusalMailbox.acknowledge(rawId)
  })
  ipcMain.handle('os:workflowProfiles:upsert', (event, raw: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const next = upsertWorkflowProfile(loadWorkflowProfiles(), raw as WorkflowProfile)
    saveWorkflowProfiles(next)
    // Éditer le graphe du workflow ACTIF doit prendre effet tout de suite : sinon le moteur
    // continuerait de jouer la version d'avant, sans que rien ne le signale.
    appliquerWorkflowActif(next)
    broadcast({ type: 'refresh', scope: 'workflows' })
    return next
  })
  ipcMain.handle('os:workflowProfiles:remove', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const next = removeWorkflowProfile(loadWorkflowProfiles(), guardString(rawId, 'id'))
    saveWorkflowProfiles(next)
    // Supprimer le workflow actif doit le retirer du moteur, pas le laisser piloter un profil mort.
    appliquerWorkflowActif(next)
    broadcast({ type: 'refresh', scope: 'workflows' })
    return next
  })
  ipcMain.handle('os:workflowProfiles:select', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const id = rawId === null ? null : guardString(rawId, 'id')
    const next = selectWorkflowProfile(loadWorkflowProfiles(), id)
    saveWorkflowProfiles(next)
    appliquerWorkflowActif(next)
    broadcast({ type: 'refresh', scope: 'workflows' })
    return next
  })
  /**
   * Sortir un ou tous les workflows vers un fichier. Un workflow est une façon de travailler : elle
   * se partage et se versionne, elle ne doit pas rester prisonnière d'un %APPDATA%.
   */
  ipcMain.handle('os:workflowProfiles:export', async (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const fichier = loadWorkflowProfiles()
    const id = rawId === null || rawId === undefined ? null : guardString(rawId, 'id')
    const choisis = id ? fichier.profiles.filter((p) => p.id === id) : fichier.profiles
    if (!choisis.length) return { ok: false as const, reason: 'aucun workflow à exporter' }
    const cible = await pickSavePath(event.sender, suggestedFileName(id ? choisis[0] : undefined))
    if (!cible) return { ok: false as const, reason: 'annulé' }
    const paquet = buildExport(choisis, new Date().toISOString())
    writeFileSync(cible, JSON.stringify(paquet, null, 2), 'utf8')
    return { ok: true as const, path: cible, count: choisis.length }
  })
  /**
   * Faire entrer des workflows depuis un fichier. Le contenu n'est JAMAIS cru : il passe par le même
   * assainisseur que la relecture locale, et un identifiant en collision est ré-attribué plutôt que
   * d'écraser en silence le workflow d'à côté.
   */
  ipcMain.handle('os:workflowProfiles:import', async (event) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const choisi = await pickPath(event.sender, 'openFile')
    if (!choisi) {
      return { ok: false as const, reason: 'annulé', file: loadWorkflowProfiles() }
    }
    let brut: unknown
    try {
      // Le BOM est retiré : sous Windows, presque tout ce qui écrit un JSON à la main en pose un.
      brut = JSON.parse(readFileSync(choisi, 'utf8').replace(/^\uFEFF/, ''))
    } catch {
      return { ok: false as const, reason: 'fichier illisible', file: loadWorkflowProfiles() }
    }
    let fichier = loadWorkflowProfiles()
    const { profiles, rejected } = readImport(brut, fichier.profiles)
    for (const profil of profiles) fichier = upsertWorkflowProfile(fichier, profil)
    if (profiles.length) {
      saveWorkflowProfiles(fichier)
      appliquerWorkflowActif(fichier)
      broadcast({ type: 'refresh', scope: 'workflows' })
    }
    return { ok: true as const, imported: profiles.length, rejected, file: fichier }
  })
}
