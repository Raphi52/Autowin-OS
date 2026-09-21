-- Serveur autoritaire : le client envoie une INTENTION, le serveur revalide via Partie:jouer.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Partie = require(ReplicatedStorage.Shared.Partie)

local intention = Instance.new("RemoteEvent")
intention.Name = "Intention"
intention.Parent = ReplicatedStorage

local partie = Partie.nouvelle(os.time())
local sieges = {}

Players.PlayerAdded:Connect(function(joueur)
	if not sieges[1] then
		sieges[1] = joueur
	elseif not sieges[2] then
		sieges[2] = joueur
	end
end)

intention.OnServerEvent:Connect(function(joueur, index, x, y)
	local j = sieges[1] == joueur and 1 or (sieges[2] == joueur and 2 or nil)
	if j and type(index) == "number" and type(x) == "number" and type(y) == "number" then
		partie:jouer(j, index, x, y)
	end
end)

RunService.Heartbeat:Connect(function(dt)
	partie:avancer(dt)
end)
