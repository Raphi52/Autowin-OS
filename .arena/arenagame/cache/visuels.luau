-- VISUELS CACHES : images des cartes (Partie.CARTES[id].image) et modeles des unites dans le .rbxl
-- construit (ReplicatedStorage.Modeles.<idCarte>). Usage : lune run visuels.luau <jeu.rbxl>
-- Imprime « VIS images <avec>/<cartes> », « VIS modeles <valides>/<unites> » (un modele valide =
-- une Model d'au moins 3 BaseParts, et pas deux unites avec la meme silhouette), puis
-- « VIS SCORE <images 0-1> <modeles 0-1> ».
local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local okP, Partie = pcall(require, "./shared/Partie")
local cartes = (okP and type(Partie) == "table" and type(Partie.CARTES) == "table") and Partie.CARTES or {}

local nCartes, avecImage, unites = 0, 0, {}
for id, c in cartes do
	nCartes += 1
	if type(c.image) == "string" and string.match(c.image, "^rbxassetid://%d+$") then
		avecImage += 1
	end
	if c.type == "unite" then
		table.insert(unites, id)
	end
end
print(string.format("VIS images %d/%d", avecImage, nCartes))

local valides = 0
local chemin = process.args[1]
if chemin and fs.isFile(chemin) and #unites > 0 then
	local okJ, jeu = pcall(roblox.deserializePlace, fs.readFile(chemin))
	local dossier = okJ and jeu:GetService("ReplicatedStorage"):FindFirstChild("Modeles")
	local silhouettes = {}
	for _, id in unites do
		local m = dossier and dossier:FindFirstChild(id)
		if m and m:IsA("Model") then
			local parts, cle = 0, {}
			for _, d in m:GetDescendants() do
				if d:IsA("BasePart") then
					parts += 1
					local s = d.Size
					table.insert(cle, string.format("%.1f,%.1f,%.1f", s.X, s.Y, s.Z))
				end
			end
			table.sort(cle)
			local sig = table.concat(cle, ";")
			if parts >= 3 and not silhouettes[sig] then
				silhouettes[sig] = true
				valides += 1
			else
				print("VIS modele refuse " .. id .. " (" .. parts .. " pieces" .. (silhouettes[sig] and ", copie" or "") .. ")")
			end
		else
			print("VIS modele absent " .. id)
		end
	end
end
print(string.format("VIS modeles %d/%d", valides, #unites))
local sImages = nCartes >= 8 and avecImage / nCartes or avecImage / 8
local sModeles = math.min(1, valides / math.max(4, #unites))
print(string.format("VIS SCORE %.3f %.3f", sImages, sModeles))
