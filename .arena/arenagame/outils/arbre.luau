-- RELEVE TEXTUEL d'un .rbxl pour les juges quand aucune capture n'est possible.
-- Usage : lune run arbre.luau <jeu.rbxl>  → arbre des services utiles (GUI, modeles, scripts),
-- avec textes, images, couleurs et tailles. Borne a 1500 lignes.
local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local jeu = roblox.deserializePlace(fs.readFile(process.args[1]))
local lignes = 0
local function sortie(s: string)
	lignes += 1
	if lignes <= 1500 then
		print(s)
	end
end
local function props(i): string
	local t = {}
	local function essai(nom: string)
		local ok, v = pcall(function()
			return i[nom]
		end)
		if ok and v ~= nil and tostring(v) ~= "" then
			table.insert(t, nom .. "=" .. string.sub(tostring(v), 1, 60))
		end
	end
	if i:IsA("GuiObject") then
		essai("Size")
		essai("Position")
		essai("BackgroundColor3")
		essai("Visible")
	end
	if i:IsA("TextLabel") or i:IsA("TextButton") then
		essai("Text")
		essai("Font")
	end
	if i:IsA("ImageLabel") or i:IsA("ImageButton") then
		essai("Image")
	end
	if i:IsA("BasePart") then
		essai("Size")
		essai("Color")
		essai("Material")
	end
	if i:IsA("LuaSourceContainer") then
		local ok, src = pcall(function()
			return i.Source
		end)
		if ok and src then
			table.insert(t, "lignes=" .. select(2, string.gsub(src, "\n", "")))
		end
	end
	return table.concat(t, " ")
end
local function visiter(i, prof: number)
	sortie(string.rep("  ", prof) .. i.ClassName .. " " .. i.Name .. " " .. props(i))
	for _, e in i:GetChildren() do
		visiter(e, prof + 1)
	end
end
for _, s in { "Workspace", "ReplicatedStorage", "ServerScriptService", "StarterGui", "StarterPlayer", "SoundService", "Lighting" } do
	local ok, svc = pcall(function()
		return jeu:GetService(s)
	end)
	if ok and svc then
		visiter(svc, 0)
	end
end
if lignes > 1500 then
	print("... " .. (lignes - 1500) .. " lignes coupees")
end
