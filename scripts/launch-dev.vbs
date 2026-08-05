' Amorce SANS CONSOLE du dev Autowin OS.
'
' Le raccourci pointait directement sur powershell.exe. Or PowerShell est une application CONSOLE :
' Windows lui alloue une console au demarrage, et Windows 11 la confie a Windows Terminal (reglage
' « application de terminal par defaut »). Windows Terminal IGNORE le SW_HIDE que pose
' `-WindowStyle Hidden` — la fenetre restait donc affichee, puis `cmd` en heritait et son `title` la
' renommait « Autowin OS Dev ». Mesure du 2026-08-05 : fenetre visible 242 ms apres le double-clic.
'
' wscript.exe, lui, est une application GRAPHIQUE : aucune console n'existe en haut de la chaine.
' Le PowerShell lance ici obtient donc une console NEUVE, a laquelle le masquage s'applique
' reellement (verifie : aucune fenetre visible pour ce meme mecanisme depuis un parent sans console).
Option Explicit

Dim shell, fso, racine, lanceur, commande
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Racine du projet = dossier parent de \scripts, deduit du chemin de CE fichier : le raccourci reste
' valable si le depot est deplace.
racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
lanceur = fso.BuildPath(racine, "scripts\launch-dev.ps1")

If Not fso.FileExists(lanceur) Then
  ' Une boite de dialogue plutot qu'un echec muet : sans console, personne ne verrait l'erreur.
  MsgBox "Lanceur Dev introuvable :" & vbCrLf & lanceur, 16, "Autowin OS Dev"
  WScript.Quit 1
End If

commande = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & lanceur & """"

' 0 = fenetre masquee, False = ne pas attendre la fin (le dev tourne tant que l'app vit).
shell.CurrentDirectory = racine
shell.Run commande, 0, False
