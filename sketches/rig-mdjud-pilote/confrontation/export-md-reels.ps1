$ErrorActionPreference = 'Stop'
$cs = "Server=SQL-DEV\DEV;Database=RIG_DEV;Integrated Security=True;ApplicationIntent=ReadOnly;Connect Timeout=10;TrustServerCertificate=True"
$c = New-Object System.Data.SqlClient.SqlConnection $cs
$c.Open()
$sw = New-Object System.IO.StreamWriter("D:/AutoWinOS/md-reels.tsv", $false, [System.Text.Encoding]::UTF8)
try {
  $cmd = $c.CreateCommand(); $cmd.CommandTimeout = 300
  $cmd.CommandText = @"
SELECT CASE WHEN MDPCI_ID_INSTN IS NOT NULL THEN 'Instance'
            WHEN MDPCI_ID_PRCLL IS NOT NULL THEN 'ProcedureCollective'
            WHEN MDPCI_ID_PREVE IS NOT NULL THEN 'Prevention'
            ELSE 'Indetermine' END AS type_affaire,
       MDPCI_MOTS
FROM RIG_MOTS_DIRECTEUR_PCINST
"@
  $r = $cmd.ExecuteReader()
  $n = 0
  while ($r.Read()) {
    $mots = $r.GetString(1) -replace "`t", ' ' -replace "`r", '' -replace "`n", ' '
    $sw.WriteLine($r.GetString(0) + "`t" + $mots)
    $n++
  }
  $r.Close()
  Write-Output "lignes exportees : $n"
} finally { $sw.Close(); $c.Close() }
