# Scenario RESTART, PROUVE en reel : A prend le verrou 2 s ; B refuse d'abord, puis l'obtient via
# attendre_verrou une fois A mort. Ce fichier tourne comme UN sous-process isole (il joue B), donc il
# ne touche pas au verrou du process de test.
import importlib.util, subprocess, sys, time, textwrap
LANCEUR = sys.argv[1]
def charge():
    s = importlib.util.spec_from_file_location('l', LANCEUR)
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
codeA = textwrap.dedent(f"""
    import importlib.util, time
    s=importlib.util.spec_from_file_location('l', r{LANCEUR!r})
    m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
    assert m.instance_unique() is True
    print('held', flush=True)
    time.sleep(2)
""")
a = subprocess.Popen([sys.executable, '-c', codeA], stdout=subprocess.PIPE, text=True)
assert a.stdout.readline().strip() == 'held', 'A doit prendre le verrou'
m = charge()
immediat = m.instance_unique()          # False attendu : A tient
t0 = time.monotonic()
obtenu = m.attendre_verrou(10.0)         # True attendu, apres ~2 s
dt = time.monotonic() - t0
a.wait()
print('IMMEDIAT', immediat, 'OBTENU', obtenu, 'DT', round(dt, 1))
