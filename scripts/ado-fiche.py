"""Depose une fiche (work item) sur Azure DevOps sans Azure CLI.

Pourquoi ce script existe : le jeton stocke par Git (GCM) ouvre les depots
mais renvoie 401 sur /_apis/wit (portee vso.code seulement), et le MSI
Azure CLI exige des droits administrateur (erreur 1925) indisponibles ici.
Ce script obtient donc lui-meme un jeton par flux "device code" sur le
client public Azure CLI, en ouvrant le navigateur avec le code prerempli.

  python scripts/ado-fiche.py login          -> obtient et stocke un jeton
  python scripts/ado-fiche.py create T.md    -> cree la fiche (1re ligne = titre)
"""
import json, sys, time, os, subprocess, urllib.request, urllib.parse, webbrowser

CLIENT = "04b07795-8ddb-461a-bbee-02f9e1bf7b46"   # Azure CLI, client public
ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798"
AUTH = "https://login.microsoftonline.com/organizations/oauth2/v2.0"
ORG, PROJECT = "AmitelGTC", "AutoWinOS"
TOKEN_PATH = os.path.expanduser("~/.ado-token")


def _post(url, data):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode())
    try:
        return json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def login(wait_seconds=600):
    dc = _post(AUTH + "/devicecode",
               {"client_id": CLIENT, "scope": ADO_RESOURCE + "/.default offline_access"})
    if "user_code" not in dc:
        raise SystemExit("echec devicecode: %s" % dc)
    code = dc["user_code"]
    print("CODE:", code, flush=True)
    url = "https://login.microsoftonline.com/common/oauth2/deviceauth?otc=" + code
    # webbrowser.open() n'ouvre RIEN depuis un processus sans fenetre (mesure du
    # 2026-09-08) : la page n'apparaissait jamais et l'utilisateur ne voyait rien.
    # os.startfile passe par le shell Windows et ouvre le navigateur par defaut.
    try:
        os.startfile(url)
    except Exception:
        webbrowser.open(url)
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        time.sleep(dc.get("interval", 5))
        r = _post(AUTH + "/token", {"grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                                    "client_id": CLIENT, "device_code": dc["device_code"]})
        if "access_token" in r:
            with open(TOKEN_PATH, "w") as f:
                f.write(r["access_token"])
            print("CONNEXION OK", flush=True)
            return r["access_token"]
        if r.get("error") not in ("authorization_pending", "slow_down"):
            raise SystemExit("echec token: %s %s" % (r.get("error"), r.get("error_description", "")[:200]))
    raise SystemExit("expire: pas de validation dans le delai")


def token():
    """Jeton, par ordre de preference.

    Le flux "device code" exige que l'utilisateur valide PENDANT que ce script
    attend. Mesure du 2026-09-08 : quatre tentatives expirees, parce que l'agent
    et l'utilisateur ne sont jamais actifs au meme moment. Un PAT depose une
    fois dans ~/.ado-pat supprime cette synchronisation.
    """
    pat = os.environ.get("ADO_PAT") or _read(os.path.expanduser("~/.ado-pat"))
    if pat:
        return ("basic", pat)
    cached = _read(TOKEN_PATH)
    if cached:
        return ("bearer", cached)
    return ("bearer", login())


def _read(path):
    try:
        return open(path).read().strip() or None
    except OSError:
        return None


def api(path, data=None, ct="application/json", method=None):
    url = "https://dev.azure.com/%s/%s/_apis/%s" % (ORG, PROJECT, path)
    kind, tok = token()
    if kind == "basic":
        import base64
        auth = "Basic " + base64.b64encode((":" + tok).encode()).decode()
    else:
        auth = "Bearer " + tok
    req = urllib.request.Request(
        url, data=json.dumps(data).encode() if data is not None else None,
        headers={"Authorization": auth, "Content-Type": ct}, method=method)
    return json.loads(urllib.request.urlopen(req).read())


def create(md_path, wit="Task"):
    lines = open(md_path, encoding="utf-8").read().splitlines()
    title, body = lines[0].strip(), "\n".join(lines[1:]).strip()
    patch = [{"op": "add", "path": "/fields/System.Title", "value": title},
             {"op": "add", "path": "/fields/System.Description",
              "value": "<pre>" + body.replace("&", "&amp;").replace("<", "&lt;") + "</pre>"}]
    r = api("wit/workitems/$%s?api-version=7.0" % wit, patch,
            ct="application/json-patch+json", method="POST")
    print("FICHE CREEE: #%s -> %s" % (r["id"], r["_links"]["html"]["href"]))
    return r


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "login"
    if cmd == "login":
        login()
    elif cmd == "create":
        create(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "Task")
    else:
        raise SystemExit(__doc__)
