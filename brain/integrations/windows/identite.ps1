# Identite d'entreprise du Brain, lue en option -- meme contrat que tooling/brain_identite.py et
# src/main/identite-entreprise.ts. Sans profil `entreprise/<nom>/identite.json` (version publique),
# tout reste neutre. Avec un profil, l'installation garde les noms deja poses sur les postes :
# dossier d'installation, nom de service (relais, greffon Hermes) et anciens noms de variables.

function Get-BrainIdentite([string]$RacineDepot) {
    $identite = [ordered]@{
        service = 'autowin-brain'
        dossierLocal = 'AutowinBrain'
        racinePartagee = ''
        dossierEditeur = ''
        distributionGraphify = ''
        sourceGraphify = ''
        variables = @{}
        brut = ''
    }
    $brut = $env:AUTOWIN_IDENTITE_ENTREPRISE
    if ([string]::IsNullOrWhiteSpace($brut) -and $RacineDepot) {
        $dossier = Join-Path $RacineDepot 'entreprise'
        if (Test-Path -LiteralPath $dossier) {
            foreach ($entree in @(Get-ChildItem -LiteralPath $dossier -Directory | Sort-Object Name)) {
                $fichier = Join-Path $entree.FullName 'identite.json'
                if (-not (Test-Path -LiteralPath $fichier)) { continue }
                try {
                    $texte = Get-Content -LiteralPath $fichier -Raw -Encoding UTF8
                    $null = $texte | ConvertFrom-Json
                    $brut = $texte
                    break
                } catch { continue }
            }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($brut)) {
        try {
            $profil = $brut | ConvertFrom-Json
            $brain = $profil.brain
            if ($brain) {
                if ([string]$brain.service -cmatch '^[a-z0-9][a-z0-9-]{0,62}$') { $identite.service = [string]$brain.service }
                if ([string]$brain.dossierLocal -cmatch '^(?!\.+$)[A-Za-z0-9._-]{1,64}$') { $identite.dossierLocal = [string]$brain.dossierLocal }
                if ($brain.racinePartagee -is [string]) { $identite.racinePartagee = [string]$brain.racinePartagee }
                if ($brain.variables) {
                    foreach ($propriete in $brain.variables.PSObject.Properties) {
                        $ancien = [string]$propriete.Value
                        if ($propriete.Name -cmatch '^[A-Z][A-Z0-9_]{0,127}$' -and $ancien -cmatch '^[A-Z][A-Z0-9_]{0,127}$') {
                            $identite.variables[$propriete.Name] = $ancien
                        }
                    }
                }
            }
            if ([string]$profil.application.dossierEditeur -cmatch '^(?!\.+$)[A-Za-z0-9._-]{1,64}$') { $identite.dossierEditeur = [string]$profil.application.dossierEditeur }
            if ([string]$profil.graphify.distribution -cmatch '^(?!\.+$)[A-Za-z0-9._-]{1,64}$') { $identite.distributionGraphify = [string]$profil.graphify.distribution }
            if ($profil.graphify.source -is [string]) { $identite.sourceGraphify = [string]$profil.graphify.source }
            $identite.brut = ($profil | ConvertTo-Json -Depth 10 -Compress)
        } catch {}
    }
    return [pscustomobject]$identite
}

# Nom sous lequel ECRIRE une variable utilisateur : l'ancien nom si le profil en fournit un (les
# postes deja installes et les outils qui en dependent le lisent), le nom neutre sinon.
function Get-BrainNomVariable($Identite, [string]$Neutre) {
    if ($Identite.variables.ContainsKey($Neutre)) { return $Identite.variables[$Neutre] }
    return $Neutre
}
