# Signal de la skill `remake` — falsifiable, rejouable par le stop-gate (forme `powershell -File`).
#
# Il ne juge pas la prose. Il teste les deux classes de defaut que les audits ont trouvees :
#   (1) une AFFIRMATION SUR UN AUTRE FICHIER du kit qui ne resout pas (chemin, chapitre, champ,
#       whitelist, comportement d'une fonction) — c'est ce qui a fait reposer la garantie centrale de
#       la skill sur du vide, DEUX fois de suite ;
#   (2) une REGLE MANQUANTE ou une MECANIQUE RE-DERIVEE alors qu'elle est canonique ailleurs.
#
# LECON DU CYCLE 2, inscrite ici parce qu'elle s'est retournee contre ce fichier meme : la premiere
# version contenait TROIS assertions qui ne pouvaient pas echouer (des mots cherches dans tout le
# fichier alors qu'ils vivaient dans un commentaire du hook ou dans le frontmatter de la skill). Un
# garde-fou incapable de mordre a valide en vert une prescription cassee. D'ou deux regles tenues par
# construction : une assertion sur la WHITELIST est ancree sur la LIGNE `$replayWhitelist`, jamais sur
# le fichier entier ; une assertion sur une regle de la skill porte sur le CORPS, frontmatter exclu.
# Et surtout : le comportement du gate n'est plus PARAPHRASE, il est REJOUE (Test-MeaningfulProof).

$ErrorActionPreference = 'Stop'
$kit = Join-Path $env:USERPROFILE '.claude'
$skill = Join-Path $kit 'skills\remake\SKILL.md'
$engine = Join-Path $kit 'skills\_engine\ENGINE.md'
$gate = Join-Path $kit 'hooks\stop-gate.ps1'
$frame = Join-Path $kit 'skills\frame\SKILL.md'

$echecs = New-Object System.Collections.Generic.List[string]
function Fail([string]$m) { $script:echecs.Add($m) }

foreach ($f in @($skill, $engine, $gate, $frame)) {
    if (-not (Test-Path -LiteralPath $f)) { Fail "fichier absent : $f" }
}
if ($echecs.Count -gt 0) { $echecs | ForEach-Object { Write-Output "ECHEC: $_" }; exit 1 }

# -Encoding UTF8 EXPLICITE : sans BOM, PowerShell 5.1 lit un fichier en ANSI, et tout caractere
# non-ASCII (les fleches des renvois, les guillemets francais) cesse de correspondre au motif cherche.
# Constate ici meme : l'assertion sur front-converge echouait alors que la regle etait bien presente.
$txt = Get-Content -LiteralPath $skill -Raw -Encoding UTF8
$engineTxt = Get-Content -LiteralPath $engine -Raw -Encoding UTF8
$gateTxt = Get-Content -LiteralPath $gate -Raw -Encoding UTF8
$frameTxt = Get-Content -LiteralPath $frame -Raw -Encoding UTF8

# CORPS de la skill = frontmatter exclu. Une regle citee seulement dans la description ne compte pas :
# c'est ce qui rendait l'assertion sur front-converge inoperante.
$corps = $txt
$fin = $txt.IndexOf("`n---", 4)
if ($fin -gt 0) { $corps = $txt.Substring($fin) } else { Fail 'frontmatter introuvable : le decoupage corps/description est casse' }

# --- (1a) La whitelist citee est-elle CELLE du hook ? Assertion ancree sur sa ligne de declaration. ---
$ligneWhitelist = ($gateTxt -split "`r?`n") | Where-Object { $_ -match '^\s*\$replayWhitelist\s*=' } | Select-Object -First 1
if (-not $ligneWhitelist) {
    Fail 'la ligne $replayWhitelist a disparu du hook : toute affirmation de la skill sur le rejeu est a revoir'
}
else {
    foreach ($entree in @('dotnet test', 'dotnet build', 'cmd /c', 'powershell', 'pwsh')) {
        if ($corps -notmatch [regex]::Escape($entree)) { Fail "la skill ne cite pas l'entree de whitelist « $entree »" }
        if ($ligneWhitelist -notmatch [regex]::Escape($entree)) { Fail "« $entree » n'est PLUS dans la whitelist du hook : l'affirmation de la skill est perimee" }
    }
}

# --- (1b) Le COMPORTEMENT du gate est REJOUE, pas paraphrase. ---
# Test-MeaningfulProof est la regle qui a fait echouer le correctif du cycle 1 : la forme prescrite
# passait la whitelist mais pas cette fonction, donc tout green etait bloque. On la rejoue ici sur les
# formes que la skill prescrit et sur celle qu'elle denonce.
$src = ($gateTxt -split 'function Test-MeaningfulProof')[1]
if (-not $src) { Fail 'Test-MeaningfulProof introuvable dans le hook : la regle de preuve a change, relire 0.b' }
else {
    $corpsFn = 'function Test-MeaningfulProof' + ($src -split "`r?`n}")[0] + "`n}"
    $runners = ($gateTxt -split "`r?`n") | Where-Object { $_ -match '^\s*\$script:proofRunners\s*=' } | Select-Object -First 1
    . ([scriptblock]::Create($runners + "`n" + $corpsFn))

    foreach ($bonne in @('powershell -NoProfile -File C:\x\signal.ps1', 'cmd /c "npm test --prefix C:\x"')) {
        if (-not (Test-MeaningfulProof $bonne)) { Fail "la forme prescrite par la skill ne PROUVE PAS pour le gate : $bonne" }
    }
    if (Test-MeaningfulProof 'cmd /c "cd /d C:\x && npm test"') {
        Fail 'le gate accepte desormais « cd /d ... && npm test » : la mise en garde de 0.b est perimee, la reecrire'
    }
    if ($corps -notmatch 'Test-MeaningfulProof') { Fail "la skill ne nomme pas Test-MeaningfulProof : elle ne decrit donc qu'une des deux contraintes" }
}

# --- (1c) Cap de rejeu, champ attestable, regimes, enchainement de frame, renvois moteur. ---
if ($corps -notmatch 'GATE_REPLAY_TIMEOUT_MS') { Fail 'la skill ne nomme pas GATE_REPLAY_TIMEOUT_MS' }
if ($gateTxt -notmatch 'GATE_REPLAY_TIMEOUT_MS') { Fail 'GATE_REPLAY_TIMEOUT_MS a disparu du hook' }
if ($corps -notmatch '120000|120 s') { Fail 'la skill ne dit pas la valeur du cap' }
if ($gateTxt -notmatch '120000') { Fail "le cap du hook n'est plus 120000 : la skill est perimee" }
if ($corps -notmatch '124') { Fail "la skill ne nomme pas le code 124, donc l'etape 5 confondra timeout et regression" }

if ($corps -notmatch 'signal-attestable') { Fail 'la skill ne nomme pas signal-attestable' }
if ($engineTxt -notmatch 'signal-attestable') { Fail 'signal-attestable absent du moteur : renvoi casse' }
if ($gateTxt -notmatch "regime -eq 'critical'") { Fail "le hook ne traite plus 'critical' a part : relire la regle attestable de 0.b" }
if ($corps -notmatch 'forces') { Fail "la skill n'impose pas critical pour un signal seulement attestable" }

if ($corps -notmatch 'disposable') { Fail 'la skill ne dit pas que disposable desarme ses garanties' }
if ($gateTxt -notmatch "regime -ne 'disposable'") { Fail 'le hook ne conditionne plus le rejeu au regime : verifier la skill' }

if ($frameTxt -notmatch 'Hand off to `terrain`') { Fail "frame n'enchaine plus sur terrain : le desarmement prescrit par la skill est peut-etre devenu inutile" }
if ($corps -notmatch 'Do NOT chain onto `terrain`') { Fail "la skill ne desarme pas explicitement l'enchainement vers terrain" }
foreach ($section in @('## Besoin', '## Contraintes', '## Confiance')) {
    if ($frameTxt -notmatch [regex]::Escape($section)) { Fail "frame n'exige plus $section : la citation de la skill est perimee" }
}
foreach ($ch in @('Ch.1', 'Ch.3', 'Ch.4')) {
    if ($corps -notmatch [regex]::Escape($ch)) { Fail "la skill ne renvoie plus a ENGINE $ch" }
}
foreach ($ancre in @('GENERATE & GATE', 'RUN', 'BUILD')) {
    if ($engineTxt -notmatch [regex]::Escape($ancre)) { Fail "chapitre « $ancre » introuvable dans le moteur" }
}
if ($corps -notmatch 'AUTOWIN_RUN_ROOT') { Fail 'la skill ne nomme pas le piege AUTOWIN_RUN_ROOT' }
if ($gateTxt -notmatch 'AUTOWIN_RUN_ROOT') { Fail "AUTOWIN_RUN_ROOT n'est plus lu par le hook" }

# --- (2) Les regles exigees par les DEUX audits sont-elles la ? (recherche dans le CORPS) ---
$exigences = @{
    'forme rejouable recommandee (script)'   = 'signal.ps1'
    'forme alternative (prefix)'             = 'npm test --prefix'
    'les DEUX contraintes du gate'           = 'TWO independent constraints'
    'preuve d''armement du gate'             = 'REJEU signal-cmd ECHOUE'
    'armement distinct du rouge'             = 'step 3 proves the gate is armed'
    'regime minimum impose'                  = 'MINIMUM on the parent'
    'etape 0 declaree ecrivante'             = 'Step 0 is NOT read-only'
    'attribution PAR FICHIER, co-sale'       = 'co-dirty'
    'operation tierce en cours'              = 'index.lock'
    'ecrivains vivants avant sabotage'       = 'Inventory the live writers'
    'trace avant la cassure'                 = 'Write the trace BEFORE the breakage'
    'restauration par commande'              = 'git checkout -- <file>'
    'checkpoint bloquant apres restauration' = 'blocking checkpoint'
    'handle verifie sur le CONTENU'          = 'git show --stat <hash>'
    'nettoyage borne, prune interdit'        = 'never `git worktree prune`'
    'historique partage non reecrit'         = 'commit from 0.a stays'
    'commits etrangers avant revert'         = 'Check for foreign commits first'
    'revert nomme et abort'                  = 'git revert --abort'
    'rollback de donnees re-sonde'           = 'restoration is FORBIDDEN'
    'copie hors git avec exclusions'         = 'enumerating what it EXCLUDES'
    'copies par partition apres etape 2'     = 'per partition, after step 2'
    'rejeus du gate dans le tally'           = 'one gate replay per RUN'
    'terrain compte dans le tally'           = 'N `terrain` if armed'
    'bracket d''agents du regime'            = 'agent bracket'
    'fourchette pour l''indecidable'         = 'RANGE with its upper bound'
    'timeout distingue d''une regression'    = 'Is it even a red?'
    'bisection par partition'                = 'Bisect by PARTITION'
    'dispatch : perimetre gradue'            = 'It is GRADUATED'
    'exclusion front-converge'               = 'LOOK like (→ `front-converge`)'
    'flaky hors signal-cmd'                  = 'Flaky signal'
    'variante attestable a la cloture'       = 'FRESH attestation'
    'cap : releve = perimetre gele'          = 'NOT an autonomous option'
    'taille assumee et justifiee'            = 'long ON PURPOSE, and it is not split'
}
foreach ($k in $exigences.Keys) {
    if ($corps -notmatch [regex]::Escape($exigences[$k])) { Fail "regle manquante : $k" }
}

# Mecaniques canoniques ailleurs : la skill doit RENVOYER, pas re-deriver.
$rederivations = @{
    'chemin de RUN re-derive (canonique ENGINE Ch.3)'  = 'runs\<session_id>'
    'anti-fixation re-decrite (canonique ENGINE Ch.1)' = 'the stop-gate blocks a decision carrying fewer'
    'discipline de cloture re-decrite (ENGINE Ch.3)'   = 'Each child ends `green` with its proof'
}
foreach ($k in $rederivations.Keys) {
    if ($corps -match [regex]::Escape($rederivations[$k])) { Fail "re-derivation a retirer : $k" }
}

$occurrences = ([regex]::Matches($corps, 'absolute child-RUN path')).Count
if ($occurrences -gt 1) { Fail "le contrat de dispatch est encore ecrit $occurrences fois (une seule attendue)" }

# --- Volume : PLAFOND assume, avec sa justification ecrite. ---
# Cycle 1 : 377 lignes, la lane sur-ingenierie voulait ~150. Cycle 2 : la lane surete a rendu 6 majeurs
# (sabotage sans trace ni restauration nommee, revert sans borne, rollback de donnees qui ecrase des
# ecritures posterieures, fichier co-sale, nettoyage non borne) et la lane fidelite 5 autres. Les
# corriger COUTE des lignes : 350 -> ~430. Le conflit entre volume et surete est reel, et il est
# tranche en faveur de la surete. Le plafond n'est donc plus un objectif de reduction mais un CLIQUET :
# il empeche la croissance SILENCIEUSE. Le relever exige de dire pourquoi, ici meme.
# CLIQUET, pas objectif de reduction : la taille est une DECISION tracee (voir la derniere section du
# SKILL.md et le RUN de la session). Ce plafond n'existe que pour interdire la croissance SILENCIEUSE.
$budget = 435
$lignes = (Get-Content -LiteralPath $skill -Encoding UTF8).Count
if ($lignes -gt $budget) { Fail "volume : $lignes lignes > plafond $budget — compenser en retirant, ou justifier le relevement dans ce fichier" }

if ($echecs.Count -gt 0) {
    $echecs | ForEach-Object { Write-Output "ECHEC: $_" }
    Write-Output ("--- {0} echec(s), {1} lignes" -f $echecs.Count, $lignes)
    exit 1
}
Write-Output ("OK: comportement du gate REJOUE, renvois resolus, {0} regles presentes, re-derivations absentes, {1} lignes" -f $exigences.Count, $lignes)
exit 0
