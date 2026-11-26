"""Verify the README entry point in a fresh export; no deployment or fixed port."""
from pathlib import Path
import json, os, re, signal, subprocess, sys, tempfile, time, urllib.request

root = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="uno-open-check-") as directory:
    checkout = Path(directory) / 'source'
    checkout.mkdir()
    subprocess.run(['git','checkout-index','--all','--prefix',str(checkout)+'/'],cwd=root,check=True)
    env = {**os.environ, 'npm_config_cache': str(Path(directory)/'npm-cache'),
           'PORT':'0', 'HOST':'127.0.0.1', 'UNO_SCORE_FILE':':memory:'}
    start = time.monotonic()
    install = subprocess.run(['npm','ci'],cwd=checkout,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=165)
    if install.returncode:
        print('npm ci failed')
        print(install.stdout.decode(errors='replace')[-2500:])
        sys.exit(1)
    process = subprocess.Popen(['npm','start'],cwd=checkout,env=env,stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT,text=True,start_new_session=True)
    try:
        for line in process.stdout:
            port = re.search(r'本机牌桌\s+http://localhost:(\d+)',line)
            if port: break
        else:
            raise RuntimeError('Host did not become ready')
        base = 'http://127.0.0.1:' + port[1]
        health = json.load(urllib.request.urlopen(base+'/api/health'))
        assert health['ok']
        markup = urllib.request.urlopen(base+'/').read().decode()
        script = re.search(r'<script[^>]+src="([^"]+)"',markup)[1]
        assert urllib.request.urlopen(base+script).status == 200
        elapsed = time.monotonic() - start
        print(json.dumps(dict(setup='new staged export and empty npm cache',commands=['npm ci','npm start'],
                         host='loopback, ephemeral port',node=subprocess.check_output(['node','-v'],text=True).strip(),
                         health=True,html=True,clientAsset=True,seconds=round(elapsed,2),
                         withinThreeMinutes=elapsed < 180),ensure_ascii=False,indent=2))
    finally:
        if process.poll() is None: os.killpg(process.pid,signal.SIGTERM)
        process.wait(timeout=10)
