"""EightMax 5.11: one canonical release ZIP and the record that ties the shipped download to the tested artifact.

  python3 validation/5.11/release511.py <release root> <out dir> [--wine]

(release510.py with the 5.11 checks added: step 3 also runs mwcli --selftest511 (the counter-based training streams:
generator, counter audit, recorded states, checkpoint rules, the update limit), trains the philox64 reference state of
validation/5.11/windows/streams on 1 and 4 threads, verifies that a state of one kind of streams is refused by the
other with nothing written, and trains a philox64 state past 10,000,000 updates through the shipped mwcli.exe. The two
over-limit studies of the 5.8 and 5.9 checks ask for the 5.10 streams by name, whose limit they test. The Linux
program and the validation summary are those of validation/5.11.)

1. Builds the deterministic ZIP from the release root: root *.md, *.bat, README.txt, BUILD-INFO.json, the three
   executables, EightMax-Offline.html and everything under source/, validation/, studies/ and .github/.
   SHA256SUMS.txt lists every member except itself.
2. Computes the SHA-256 of that exact file.
3. Extracts THAT file into a new empty directory and, from the extracted copy only: verifies every manifest entry and
   that nothing unlisted exists, verifies executables / interface / source fingerprint (verify_build.js), hashes the
   executables, and smoke-tests them (natively on Windows, with --wine elsewhere).
4. Writes <out dir>/EightMax-Windows-<version>.identity.json. The record cannot be inside the archive it describes;
   it is delivered next to it.
"""
import hashlib, json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time, urllib.request, zipfile
root = pathlib.Path(sys.argv[1]).resolve(); outdir = pathlib.Path(sys.argv[2]).resolve(); wine = '--wine' in sys.argv
outdir.mkdir(parents=True, exist_ok=True)
version = (root / 'source/VERSION').read_text().strip()
subprocess.run(['node', str(root / 'source/tools/verify_build.js'), str(root)], check=True)
ROOT_NAMES = {'README.txt', 'BUILD-INFO.json', 'EightMax.exe', 'mwcli.exe', 'gpustress.exe', 'EightMax-Offline.html'}
files = [p for p in root.iterdir() if p.is_file() and (p.suffix.lower() in {'.md', '.bat'} or p.name in ROOT_NAMES)]
for folder in ['source', 'validation', 'studies', '.github']:
    files.extend(p for p in (root / folder).rglob('*') if p.is_file() and not {'build', '__pycache__', 'node_modules'}.intersection(p.relative_to(root).parts) and p.suffix != '.pyc')
items = {p.relative_to(root).as_posix(): p for p in files}
def digest(p):
    with open(p, 'rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()
hashes = {n: digest(p) for n, p in sorted(items.items())}
manifest = root / 'SHA256SUMS.txt'
manifest.write_bytes(''.join(h + '  ' + n + '\n' for n, h in hashes.items()).encode())
items[manifest.name] = manifest
zip_path = outdir / f'EightMax-Windows-{version}.zip'
tmp_zip = outdir / (zip_path.name + '.tmp')
with zipfile.ZipFile(tmp_zip, 'w') as z:
    for name, p in sorted(items.items()):
        info = zipfile.ZipInfo('EightMax/' + name, (2026, 11, 25, 0, 0, 0)); info.create_system = 3
        info.external_attr = (0o100755 if name.endswith(('.sh', '.exe')) else 0o100644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        info._compresslevel = 9   # 5.9: the strongest deflate level (the archive is kept below the 100 MiB limit of the repository that distributes it)
        if hasattr(info, 'compress_level'): info.compress_level = 9
        with z.open(info, 'w') as dst, p.open('rb') as src: shutil.copyfileobj(src, dst, 1 << 20)
tmp_zip.replace(zip_path)
archive_sha = digest(zip_path)
# ---- everything below reads only the extracted copy of that file ----
clean = pathlib.Path(tempfile.mkdtemp(prefix='EightMax-release-check-'))
record = {'archive': zip_path.name, 'archiveBytes': zip_path.stat().st_size, 'archiveSha256': archive_sha, 'version': version}
try:
    with zipfile.ZipFile(zip_path) as z:
        assert z.testzip() is None
        z.extractall(clean)
    assert digest(zip_path) == archive_sha
    x = clean / 'EightMax'
    listed = dict(line.split('  ', 1)[::-1] for line in (x / 'SHA256SUMS.txt').read_text().splitlines())
    present = {p.relative_to(x).as_posix() for p in x.rglob('*') if p.is_file()} - {'SHA256SUMS.txt'}
    assert present == set(listed), sorted(present ^ set(listed))[:10]
    bad = [n for n, h in listed.items() if digest(x / n) != h]
    assert not bad, bad[:10]
    subprocess.run(['node', str(x / 'source/tools/verify_build.js'), str(x)], check=True)
    info = json.loads((x / 'BUILD-INFO.json').read_text())
    record.update({'build': info['build'], 'sourceFingerprint': info['build'], 'sourceFingerprintNote': 'the build identifier is the first 16 hex digits of the SHA-256 over source/VERSION and every file of source/native, web, wasm, tools, tests, studies and the CI workflow (%d files); verify_build.js recomputed it from the extracted source and found it in the three executables and the interface' % len(info['files']),
                   'manifestEntries': len(listed), 'archiveMembers': len(listed) + 1, 'manifestVerifiedInExtractedCopy': True,
                   'manifestSha256': digest(x / 'SHA256SUMS.txt'),
                   'executables': {n: {'bytes': (x / n).stat().st_size, 'sha256': digest(x / n)} for n in ['EightMax.exe', 'mwcli.exe', 'gpustress.exe']},
                   'interfaceSha256': digest(x / 'EightMax-Offline.html'), 'studyFixtures': sorted(p.name for p in (x / 'studies').glob('*.emfix.json'))})
    native = os.name == 'nt'
    linux = not native and not wine and (x/'validation/5.11/linux-bin/mwcli').exists()
    smoke = {'ran': native or wine or linux, 'how': 'natively on Windows' if native else ('Windows executables under Wine' if wine else 'the Linux mwcli included in validation/5.11/linux-bin; Windows execution unavailable'), 'windowsExecution':native or wine}
    if native or wine or linux:
        # Wine 9.0 aborts at start-up when given this container's very large environment (BUILD-5.5.md): a minimal one is used.
        env = {'HOME': os.environ.get('EM_WINE_HOME', os.environ.get('HOME', '/tmp')), 'PATH': '/usr/bin:/bin', 'WINEDEBUG': '-all', 'EIGHTMAX_GPU': 'off', 'LC_ALL': 'C.UTF-8', **({'WINEPREFIX': os.environ['WINEPREFIX']} if 'WINEPREFIX' in os.environ else {})} if wine else dict(os.environ, EIGHTMAX_GPU='off')
        binaryRoot = x/'validation/5.11/linux-bin' if linux else x
        mapping={'mwcli.exe':'mwcli','EightMax.exe':'eightmax','gpustress.exe':'gpustress'}
        def executable(n):
            p=binaryRoot/(mapping[n] if linux else n)
            if linux:p.chmod(0o755)
            return p
        def run(args, **kw):
            args=list(args)
            if pathlib.Path(args[0]).name in mapping:args[0]=executable(pathlib.Path(args[0]).name)
            kw.setdefault('env', env); return subprocess.run((['wine'] if wine else []) + [str(a) for a in args], capture_output=True, text=True, cwd=str(x), **kw)
        ids = {}
        for n in ['mwcli.exe', 'EightMax.exe']:
            r = run([x / n, '--build-id']); ids[n] = r.stdout.strip(); assert ids[n] == 'EightMaxBuild=' + info['build'], (n, r.stdout, r.stderr)
        g = run([x / 'gpustress.exe']); ids['gpustress.exe'] = 'usage printed, exit ' + str(g.returncode); assert 'usage: gpustress' in (g.stdout + g.stderr)
        smoke['buildIds'] = ids
        work = clean / 'work'; work.mkdir()
        r = run([x / 'mwcli.exe', '--study', x / 'studies/known-akq-river.emfix.json', work / 'known.json', 'quiet=1', 'seeds=3', 'budgets=1000,100000,1000000']); assert r.returncode == 0, r.stderr
        doc = json.loads((work / 'known.json').read_text()); b = doc['variants'][0]['budgets'][-1]; call = [a for a in b['actions'] if a['label'] == 'Call 10'][0]
        assert doc['build'] == info['build'] and abs(call['frequency']['mean'] - 0.5) < 0.03 and abs(b['gap']['mean']) < 0.05, b
        smoke['studyKnownGame'] = {'build': doc['build'], 'callFrequency': call['frequency']['mean'], 'evGapBB': b['gap']['mean'], 'verdict': b['verdict'], 'closedForm': 'call 1/2, EV gap 0'}
        r = run([x / 'mwcli.exe', '--selftest49', x / 'validation/4.9/fixtures', work / 'st49']); st = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {}
        assert r.returncode == 0 and st.get('failed') == 0, (r.returncode, r.stdout[-400:], r.stderr[-400:])
        smoke['selftest49'] = {'passed': st['passed'], 'failed': st['failed'], 'build': st['build']}
        s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
        host = subprocess.Popen((['wine'] if wine else []) + [str(executable('EightMax.exe')), '--no-browser', f'--port={port}'], env=dict(env, USERPROFILE=str(work)), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(x))
        try:
            api = None
            for _ in range(400):
                try: api = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{port}/api/info', timeout=2).read()); break
                except Exception: time.sleep(0.05)
            assert api and api['build'] == info['build'] and api['version'] == version and api.get('studyApi') == 1 and api.get('studyCheckpoints') == 1, api
            saved = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{port}/api/study/checkpoints', timeout=5).read()); assert saved['checkpoints'] == [], saved
            page = urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=5).read().decode()
            assert 'data-tab="study"' in page and info['build'] in page and 'Study accuracy and recovery' in page
            smoke['host'] = {'build': api['build'], 'version': api['version'], 'studyApi': api['studyApi'], 'studyCheckpoints': api['studyCheckpoints'], 'studyTabServed': True, 'recoveryPanelInPage': True, 'savedStudyListAnswered': True}
        finally:
            host.kill(); host.wait()
            if wine: subprocess.run(['wineserver', '-k'], capture_output=True)
        # ---- 5.5: calibration fields, automatic checkpoint, interruption and resume, through the SHIPPED executables ----
        opts = ['variants=baseline', 'seeds=101,102', 'budgets=4000,16000', 'evaluationSamples=1000', 'qualitySamples=128', 'threads=2', 'quiet=1']; fx6 = x / 'studies/flop6-jack.emfix.json'
        r = run([x / 'mwcli.exe', '--study', fx6, work / 'ref.json', *opts, 'checkpoint=off']); assert r.returncode == 0, r.stderr
        r = run([x / 'mwcli.exe', '--study', fx6, work / 'res.json', *opts, 'checkpoint=' + str(work / 'ck'), 'checkpointSeconds=0.05', 'timeLimitSeconds=0.5']); assert r.returncode == 0, r.stderr
        part = json.loads((work / 'res.json').read_text()); assert part['completion']['complete'] is False and part['run']['checkpoint']['resumable'] is True, part['completion']
        r = run([x / 'mwcli.exe', '--study', fx6, work / 'res.json', *opts, 'checkpoint=' + str(work / 'ck')]); assert r.returncode == 5, ('an existing checkpoint must be refused without resume', r.returncode)
        r = run([x / 'mwcli.exe', '--study', fx6, work / 'res.json', *opts, 'checkpoint=' + str(work / 'ck'), 'resume=1']); assert r.returncode == 0, r.stderr
        eqv = subprocess.run([sys.executable, str(x / 'source/tools/study_equivalence55.py'), str(work / 'ref.json'), str(work / 'res.json')], capture_output=True, text=True)
        res = json.loads((work / 'res.json').read_text()); bud = res['variants'][0]['budgets'][-1]
        assert eqv.returncode == 0, eqv.stdout[-600:]
        assert res['calculationVersion'] == 'study-5.5-bounded-eb-v1' and res.get('replicationCalculation') == 'study-5.6-replication-v1' and res['completion']['complete'] is True and res['run']['checkpoint']['resumed'] is True and res['run']['checkpoint']['warnings'] == [], res['run']['checkpoint']
        assert bud['confidence']['evaluationCalibrated'] is True and all(p['evSamplesWithinBound'] for s_ in res['variants'][0]['perSeed'] for p in s_['budgets'])
        smoke['studyResume'] = {'interruptedByTimeLimit': True, 'pointsBeforeResume': part['completion']['pointsCompleted'], 'resumedEqualsUninterrupted': True, 'canonicalSha256': eqv.stdout.split()[0], 'existingCheckpointRefusedWithoutResume': True,
                            'calculationVersion': res['calculationVersion'], 'evaluationCalibrated': True, 'verdict': bud['verdict'], 'engineStateWrites': res['run']['checkpoint']['engineStateWrites']}
        # ---- 5.6, through the SHIPPED executables ----
        s56 = {}
        gdir = x / 'validation/5.7/windows/golden'; gold = json.loads((gdir / 'golden.json').read_text()); same = 0; gt = time.time()
        for c in gold['cases']:
            st = work / (c['name'] + '.state'); r = run([x / 'mwcli.exe', gdir / c['spec'], c['updates'], c['threads'], st, c['memoryMiB']]); assert r.returncode == 0, (c['name'], r.stderr[-300:])
            assert digest(st) == c['stateSha256'], ('golden state differs from 5.5', c['name']); same += 1
        s56['goldenStatesIdenticalTo55'] = {'checked': len(gold['cases']), 'identical': same, 'seconds': round(time.time() - gt, 1)}
        # experimental estimators: a river game walked once per deal; candidates coincide there; a state of another trainer is refused
        def body(p):
            b = pathlib.Path(p).read_bytes(); return hashlib.sha256(b[12 + int.from_bytes(b[8:12], 'little'):]).hexdigest()
        base = json.loads((gdir / 'g00-hu-river.spec.json').read_text()); infos = {}
        for m in ['river', 'river-shared', 'river-cross']:
            sp = work / (m + '.json'); sp.write_text(json.dumps({**base, 'opponentEnumeration': m, 'studyId': hashlib.sha256(('smoke-' + m).encode()).hexdigest()[:16]})); r = run([x / 'mwcli.exe', sp, 4000, 1, work / (m + '.state'), 128]); assert r.returncode == 0, r.stderr[-300:]; infos[m] = json.loads(r.stdout)
        assert infos['river-shared']['stateVisits'] * 2 == infos['river']['stateVisits'] and body(work / 'river-shared.state') == body(work / 'river-cross.state') and infos['river-cross']['trainer']['experimental'] is True
        r = run([x / 'mwcli.exe', work / 'river-cross.json', 10, 1, work / 'no.state', 128, work / 'river.state']); assert r.returncode != 0 and 'different study' in r.stderr and not (work / 'no.state').exists(), r.stderr
        s56['experimentalEstimators'] = {'riverSharedVisitsPerDeal': infos['river-shared']['stateVisits'] / 4000, 'riverVisitsPerDeal': infos['river']['stateVisits'] / 4000, 'candidatesCoincideOnRiverGame': True, 'stateOfAnotherTrainerRefused': True}
        # exact evaluation: 32 MiB and 1,024 MiB caches give the same NashConv (compact tables); passive runouts agree with the 5.5 path
        ev = {}
        for name in ['g04-bubble4', 'g05-flop6']:
            vals = {}
            for mem, extra in [(32, {}), (1024, {}), (1024, {'EM_EV_KEEP_SCORES': '1', 'EM_EV_NO_PASSIVE': '1'})]:
                q = work / ('q%d.json' % mem); q.write_text(json.dumps({'method': 'exact', 'device': 'cpu', 'threads': 1, 'timeLimitMs': 900000, 'maxVisits': 2000000000, 'memoryMiB': mem})); t0 = time.time()
                r = run([x / 'mwcli.exe', '--gain', gdir / (name + '.spec.json'), work / (name + '.state'), q, 128], env={**env, **extra}); assert r.returncode == 0, r.stderr[-300:]
                vals[(mem, bool(extra))] = (json.loads(r.stdout)['nashConv'], round(time.time() - t0, 2))
            a, b, c = vals[(32, False)], vals[(1024, False)], vals[(1024, True)]; assert a[0] == b[0] and abs(b[0] - c[0]) <= 1e-9 * max(1.0, abs(c[0])), (name, vals)
            ev[name] = {'nashConv': b[0], 'seconds32MiB': a[1], 'seconds1024MiB': b[1], 'seconds55Paths1024MiB': c[1], 'relativeDifferenceFrom55Paths': abs(b[0] - c[0]) / max(1e-300, abs(c[0]))}
        s56['exactEvaluation'] = ev
        # replication statistics and warnings in a study document; nine agreeing exact trainings can declare, two cannot
        doc = json.loads((work / 'known.json').read_text()); b3 = doc['variants'][0]['budgets'][-1]; rep = b3['confidence']['replication']
        assert rep['trainings'] == 3 and rep['sufficient'] is False and b3['bestAction']['declared'] is False and any(w['code'] == 'insufficientReplication' for w in doc['statisticalWarnings']), rep
        s56['replication'] = {'trainings': rep['trainings'], 'minimumTrainings': rep['minimumTrainingsForStatementAboutTypicalTraining'], 'verdict': rep['verdict'], 'bestActionDeclared': b3['bestAction']['declared'], 'warnings': [w['code'] for w in doc['statisticalWarnings']]}
        # checkpoint lock: a second process is refused while the first runs; the killed study resumes to the uninterrupted result
        ko = ['seeds=2', 'budgets=20000,400000,6000000', 'threads=1', 'quiet=1']; fxk = x / 'studies/known-akq-river.emfix.json'
        r = run([x / 'mwcli.exe', '--study', fxk, work / 'lref.json', *ko, 'checkpoint=off']); assert r.returncode == 0, r.stderr
        first = subprocess.Popen((['wine'] if wine else []) + [str(executable('mwcli.exe')), '--study', str(fxk), str(work / 'lock.json'), *ko, 'checkpoint=' + str(work / 'lck'), 'checkpointSeconds=0.05'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(x))
        for _ in range(600):
            if (work / 'lck/manifest.json').exists() or first.poll() is not None: break
            time.sleep(0.05)
        refused = None
        if first.poll() is None:
            r = run([x / 'mwcli.exe', '--study', fxk, work / 'second.json', *ko, 'checkpoint=' + str(work / 'lck'), 'resume=1'])
            if first.poll() is None: refused = r.returncode != 0 and 'in use' in (r.stderr + r.stdout); assert refused, (r.returncode, r.stderr[-300:])
        killed = first.poll() is None; first.kill(); first.wait()
        if wine: subprocess.run(['wineserver', '-k'], capture_output=True, env=env)
        r = run([x / 'mwcli.exe', '--study', fxk, work / 'lock.json', *ko, 'checkpoint=' + str(work / 'lck'), 'resume=1']); assert r.returncode == 0, r.stderr[-300:]
        eq2 = subprocess.run([sys.executable, str(x / 'source/tools/study_equivalence55.py'), str(work / 'lref.json'), str(work / 'lock.json')], capture_output=True, text=True); assert eq2.returncode == 0, eq2.stdout[-600:]
        s56['checkpointLock'] = {'secondProcessRefusedWhileFirstRuns': refused, 'firstProcessKilled': killed, 'resumedEqualsUninterrupted': True, 'lockFileRemoved': not (work / 'lck/study.lock').exists()}
        smoke['checks56'] = s56
        # ---- 5.7, through the SHIPPED executables ----
        s57 = {}
        t57 = time.time(); r = run([x / 'mwcli.exe', '--selftest57', x / 'validation/5.7/fixtures', work / 'st57']); st = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {}
        assert r.returncode == 0 and st.get('failed') == 0 and st.get('passed', 0) >= 28 and st.get('build') == info['build'], (r.returncode, r.stdout[-400:], r.stderr[-800:])
        rep57 = json.loads((work / 'st57/selftest57.json').read_text())
        s57['selftest57'] = {'passed': st['passed'], 'failed': st['failed'], 'build': st['build'], 'seconds': round(time.time() - t57, 1), 'checks': [c['name'] for c in rep57['checks']]}
        # frozen-batch training on 1 and 4 threads (every update on all of them): the state the 5.6 binary wrote
        g57 = json.loads((x / 'validation/5.7/fixtures/golden57.json').read_text()); c = [t for t in g57['training'] if t['name'] == 'flop3-kings-compact-batch64'][0]; th = {}
        for threads in (1, 4):
            st2 = work / ('thr%d.state' % threads); r = run([x / 'mwcli.exe', x / 'validation/5.7/fixtures' / c['spec'], c['updates'], threads, st2, c['memoryMiB']], env={**env, 'EIGHTMAX_THREAD_CHOICE': 'fixed'}); assert r.returncode == 0, r.stderr[-300:]
            i57 = json.loads(r.stdout); assert digest(st2) == c['stateSha256'] and i57['threads'] == threads, (threads, i57['threads']); th[str(threads)] = {'threadsUsed': i57['threads'], 'wallSeconds': i57['wallSeconds'], 'identicalToThe56State': True}
        s57['frozenBatchThreads'] = th
        # CPU-only mode and GPU-Preferred mode without a GPU give the same measurements, on the CPU
        fxi = x / 'studies/icm8-bb-call-small.emfix.json'; mo = ['seeds=2', 'budgets=2000,8000', 'threads=2', 'quiet=1', 'checkpoint=off']; paths = {}; pts = {}
        for mode in ('cpu', 'gpu', 'auto', 'hybrid'):
            r = run([x / 'mwcli.exe', '--study', fxi, work / ('mode-%s.json' % mode), *mo, 'processingMode=' + mode]); assert r.returncode == 0, (mode, r.stderr[-300:])
            paths[mode] = json.loads((work / ('mode-%s.json' % mode)).read_text())['variants'][0]['perSeed'][0]['budgets'][0]['trainingDevicePath']; assert paths[mode].startswith('CPU'), paths
            pts[mode] = [(v['name'], s_['seed'], p['budgetDeals'], p['deals'], p['rows'], p.get('frequency'), p.get('ev'), p.get('evStdErr'), p.get('quality'), p.get('seatGain')) for v in json.loads((work / ('mode-%s.json' % mode)).read_text())['variants'] for s_ in v['perSeed'] for p in s_['budgets']]
            assert pts[mode] == pts['cpu'] and len(pts[mode]) >= 4, (mode, 'measurements differ from CPU-only')   # every per-seed measurement; the requested mode itself is recorded in the document and differs by design
        s57['cpuFallback'] = {'modes': sorted(paths), 'allOnTheCpu': True, 'sameMeasurementsAsCpuOnly': True, 'measurementPointsCompared': len(pts['cpu']), 'trainingDevicePath': paths['gpu']}
        # invalid configurations: refused with the documented exit status, a message, and nothing written
        bad = work / 'bad spec.json'; bad.write_text('{"protocol":4,"n":99}'); inv = {}
        r = run([x / 'mwcli.exe', bad, 10, 1, work / 'bad.state', 64]); assert r.returncode == 1 and 'error' in r.stderr and not (work / 'bad.state').exists(), (r.returncode, r.stderr); inv['invalidSpec'] = {'exit': r.returncode, 'message': r.stderr.strip()[:120]}
        r = run([x / 'mwcli.exe', work / 'no such.json', 10, 1, work / 'bad.state', 64]); assert r.returncode == 2 and not (work / 'bad.state').exists(), (r.returncode, r.stderr); inv['unreadableSpec'] = {'exit': r.returncode}
        r = run([x / 'mwcli.exe', '--study', x / 'studies/known-akq-river.emfix.json', work / 'opt.json', 'nonsense=1', 'quiet=1']); assert r.returncode == 2 and 'unknown option' in r.stderr and not (work / 'opt.json').exists(), (r.returncode, r.stderr); inv['unknownStudyOption'] = {'exit': r.returncode, 'message': r.stderr.strip()[:120]}
        r = run([x / 'mwcli.exe', '--study', x / 'studies/known-akq-river.emfix.json', work / 'opt.json', 'seeds=0', 'quiet=1']); assert r.returncode == 1 and 'seeds' in r.stderr and not (work / 'opt.json').exists(), (r.returncode, r.stderr); inv['invalidStudyOptionValue'] = {'exit': r.returncode, 'message': r.stderr.strip()[:120]}
        r = run([x / 'mwcli.exe', '--selftest57']); assert r.returncode == 2, r.returncode; inv['selftestWithoutArguments'] = {'exit': r.returncode}
        s57['invalidConfigurations'] = inv
        smoke['checks57'] = s57
        # ---- 5.7.1, through the SHIPPED executables ----
        t571 = time.time(); r = run([x / 'mwcli.exe', '--selftest571', x / 'studies', work / 'st571', 'all']); st = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {}
        assert r.returncode == 0 and st.get('failed') == 0 and st.get('untested') == 0 and st.get('passed') == 24 and st.get('build') == info['build'], (r.returncode, r.stdout[-400:], r.stderr[-1500:])
        rep571 = json.loads((work / 'st571/selftest571.json').read_text()); assert all(c['status'] == 'passed' and c['exercised'] for c in rep571['checks'])
        ev = {c['section'] + ' ' + c['id']: c['evidence'] for c in rep571['checks']}
        r2 = run([x / 'mwcli.exe', '--selftest571', x / 'studies', work / 'st571-fault', 'checkpoint'], env={**env, 'EM_TEST_SAVE_FAULT': 'create'})   # nothing can be saved: nothing may pass
        bad571 = json.loads((work / 'st571-fault/selftest571.json').read_text()); assert r2.returncode == 1 and bad571['passed'] == 0 and bad571['failed'] + bad571['untested'] == len(bad571['checks']), (r2.returncode, bad571['passed'])
        smoke['checks571'] = {'selftest571': {'passed': st['passed'], 'failed': st['failed'], 'untested': st['untested'], 'build': st['build'], 'platform': rep571.get('platform'), 'seconds': round(time.time() - t571, 1), 'checks': [c['section'] + ' ' + c['id'] + ': ' + c['name'] for c in rep571['checks']]},
                              'whiteSpaceAccepted': ev['checkpoint A']['manifestUsed'] == 'manifest.json' and ev['checkpoint A']['finalStateEqualsReference'],
                              'alteredDataFallsBackToThePreviousGeneration': ev['checkpoint B1']['fallbackGenerationUsed'] and ev['checkpoint B1']['finalStateEqualsReference'],
                              'bothManifestsDamagedRefusedWithExit': ev['checkpoint B2']['engineExitCode'],
                              'previousGenerationKeptIntactByAKilledFirstCommit': ev['checkpoint E2']['previousGenerationKeptIntact'],
                              'memoryStop': {'stoppedByProcessMemory': ev['memory A']['stoppedByProcessMemory'], 'budgetMiB': ev['memory A']['processMemoryBudgetMiB'], 'peakRssMiB': ev['memory A']['processPeakRssMiB'], 'stoppedPoint': ev['memory A']['stoppedPoint'],
                                             'resumedEqualsControl': ev['memory B']['finalStateEqualsReference'], 'controlStoppedByProcessMemory': ev['memory E']['stoppedByProcessMemory']},
                              'failureReporting': {'withEverySaveFailing': {'exit': r2.returncode, 'passed': bad571['passed'], 'failed': bad571['failed'], 'untested': bad571['untested']}}}
        # ---- 5.8, through the SHIPPED executables ----
        t58 = time.time(); r = run([x / 'mwcli.exe', '--selftest58', x / 'studies', work / 'st58', 'all']); st = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {}
        assert r.returncode == 0 and st.get('failed') == 0 and st.get('untested') == 0 and st.get('passed') == 33 and st.get('build') == info['build'], (r.returncode, r.stdout[-400:], r.stderr[-1500:])
        rep58 = json.loads((work / 'st58/selftest58.json').read_text()); assert all(c['status'] == 'passed' for c in rep58['checks'])
        s58 = {'selftest58': {'passed': st['passed'], 'failed': st['failed'], 'untested': st['untested'], 'build': st['build'], 'seconds': round(time.time() - t58, 1), 'checks': [c['section'] + ' ' + c['id'] + ': ' + c['name'] for c in rep58['checks']]}}
        # the reference responses recorded by the Linux build: the shipped program must give the same bits
        rdir = x / 'validation/5.8/windows/response'; gold58 = json.loads((rdir / 'golden58.json').read_text()); same58 = 0; t0 = time.time()
        for c in gold58['cases']:
            st = work / (c['name'] + '.r58.state'); r = run([x / 'mwcli.exe', rdir / c['spec'], c['updates'], 1, st, c['memoryMiB']]); assert r.returncode == 0 and digest(st) == c['stateSha256'], (c['name'], r.stderr[-300:])
            # 5.9: the 5.8 references are the bits of the 5.8 evaluation streams, drawn on request
            r = run([x / 'mwcli.exe', '--response', rdir / c['spec'], st, x / 'validation/5.9/windows/response/request-58-streams.json', c['memoryMiB']]); assert r.returncode == 0, (c['name'], r.stderr[-300:])
            got = ['%d:%s:%s:%s' % (q['seat'], q['sampled']['gain']['gainBits'], q['exact']['gainBits'], q['exact']['bestResponseGainBits']) for q in json.loads(r.stdout)['seats']]
            assert got == c['seatBits'], ('5.8 reference response differs', c['name'], got, c['seatBits']); same58 += 1
        s58['referenceResponses'] = {'checked': len(gold58['cases']), 'identicalToThe58LinuxBuildWithThe58Streams': same58, 'recordedBy': gold58['recordedBy'], 'seconds': round(time.time() - t0, 1)}
        # a study budget above the limit: refused when it is configured, nothing written
        t0 = time.time(); r = run([x / 'mwcli.exe', '--study', x / 'studies/known-akq-river.emfix.json', work / 'over.json', 'quiet=1', 'seeds=1', 'budgets=1000,10000001', 'trainingStreams=5.10', 'checkpoint=' + str(work / 'over-ck')])
        assert r.returncode == 1 and '10 million iteration limit' in r.stderr and 'Nothing was trained' in r.stderr and not (work / 'over.json').exists() and not (work / 'over-ck').exists(), (r.returncode, r.stderr[-300:])
        s58['overLimitBudget'] = {'exit': r.returncode, 'seconds': round(time.time() - t0, 2), 'resultWritten': False, 'checkpointCreated': False, 'message': r.stderr.strip()[:260]}
        smoke['checks58'] = s58
        # ---- 5.9, through the SHIPPED executables ----
        t59 = time.time(); r = run([x / 'mwcli.exe', '--selftest59', x / 'studies', work / 'st59', 'all']); st = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {}
        assert r.returncode == 0 and st.get('failed') == 0 and st.get('untested') == 0 and st.get('passed') == 32 and st.get('build') == info['build'], (r.returncode, r.stdout[-400:], r.stderr[-1500:])
        rep59 = json.loads((work / 'st59/selftest59.json').read_text()); assert all(c['status'] == 'passed' for c in rep59['checks'])
        s59 = {'selftest59': {'passed': st['passed'], 'failed': st['failed'], 'untested': st['untested'], 'build': st['build'], 'seconds': round(time.time() - t59, 1), 'checks': [c['section'] + ' ' + c['id'] + ': ' + c['name'] for c in rep59['checks']]}}
        rdir = x / 'validation/5.9/windows/response'; gold59 = json.loads((rdir / 'golden59.json').read_text()); same59 = 0; t0 = time.time()
        for c in gold59['cases']:
            st = work / (c['name'] + '.r59.state'); r = run([x / 'mwcli.exe', rdir / c['spec'], c['updates'], 1, st, c['memoryMiB']]); assert r.returncode == 0 and digest(st) == c['stateSha256'], (c['name'], r.stderr[-300:])
            for request in (c['request'], c['parallelRequest']):
                r = run([x / 'mwcli.exe', '--response', rdir / c['spec'], st, rdir / request, c['memoryMiB']]); assert r.returncode == 0, (c['name'], r.stderr[-300:]); d59 = json.loads(r.stdout); S59 = d59['summary']
                got = ['%d:%s:%s:%s:%s' % (q['seat'], q['sampled']['gain']['gainBits'], q['sampled']['statistics']['sampleVarianceBits'], q['exact']['gainBits'], q['exact']['bestResponseGainBits']) for q in d59['seats']]
                sums = [S59['simultaneous']['bits']['sumOfResponseGainsLowerBound'], S59['simultaneous']['bits']['nashConvLowerBound'], S59['pooledIndependent']['bits']['sumOfResponseGainsLowerBound'], S59['pooledIndependent']['bits']['bestSubset']]
                assert got == c['seatBits'] and sums == c['summaryBits'], ('5.9 reference response differs', c['name'], request, got, sums)
                a59 = S59['againstExact']; assert a59['simultaneousHolds'] and a59['simultaneousNashConvBoundHolds'] and a59['pooledAllSeatsHolds'] and a59['pooledBestSubsetHolds'] and a59['seatBoundsHolding'] == a59['seatBoundsChecked'], (c['name'], a59)
            same59 += 1
        s59['referenceResponses'] = {'checked': len(gold59['cases']), 'identicalToTheLinuxBuild': same59, 'summaryBoundsIdentical': same59, 'parallelSeatsIdentical': same59, 'everyStatementHoldsAgainstExactValues': True, 'recordedBy': gold59['recordedBy'], 'seconds': round(time.time() - t0, 1)}
        # the desktop host: a refused study leaves no folder behind
        s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close(); prof = work / 'profile59'; prof.mkdir()
        host = subprocess.Popen((['wine'] if wine else []) + [str(executable('EightMax.exe')), '--no-browser', f'--port={port}'], env=dict(env, USERPROFILE=str(prof), HOME=env.get('HOME', str(prof)) if wine else str(prof)), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(x))
        try:
            def call(path, body=None):
                rq = urllib.request.Request(f'http://127.0.0.1:{port}/api/' + path, data=None if body is None else json.dumps(body).encode(), headers={'X-EightMax': '1'} if body is not None else {})
                return json.loads(urllib.request.urlopen(rq, timeout=60).read())
            for _ in range(600):
                try: call('info'); break
                except Exception: time.sleep(0.05)
            fx59 = json.loads((x / 'studies/flop6-jack-small.emfix.json').read_text(encoding='utf-8-sig')); sdir = pathlib.Path(call('study/checkpoints')['directory'].replace('\\', '/')) if not wine else None
            def wait():
                for _ in range(6000):
                    s_ = call('study/status')
                    if not s_['running']: return s_
                    time.sleep(0.02)
            t0 = time.time(); started = call('study/start', {'fixture': fx59, 'options': {'variants': 'baseline', 'seeds': [1, 2], 'budgets': [1000, 20000000], 'threads': 2, 'trainingStreams': '5.10'}}); stt = wait(); ms = round((time.time() - t0) * 1000)
            listed59 = call('study/checkpoints')['checkpoints']
            assert 'study budget too large' in (stt['error'] or '') and 'Nothing was trained' in stt['error'] and stt['refusedStudyFolder'] == 'removed' and stt['checkpointId'] is None and listed59 == [], stt
            if sdir is not None: assert not sdir.exists() or list(sdir.iterdir()) == [], list(sdir.iterdir())
            ok59 = call('study/start', {'fixture': fx59, 'options': {'variants': 'baseline', 'seeds': [1, 2], 'budgets': [1000, 4000], 'threads': 2, 'evaluationSamples': 256, 'qualitySamples': 64}}); st2 = wait(); done59 = call('study/result')
            assert not st2['error'] and done59['completion']['complete'] is True and st2['refusedStudyFolder'] is None and len(call('study/checkpoints')['checkpoints']) == 1, st2
            s59['refusedStudy'] = {'refusedAfterMilliseconds': ms, 'refusedStudyFolder': stt['refusedStudyFolder'], 'foldersLeft': 0, 'message': stt['error'][:200], 'ordinaryStudyAfterwardsComplete': True}
        finally:
            host.kill(); host.wait()
            if wine: subprocess.run(['wineserver', '-k'], capture_output=True)
        smoke['checks59'] = s59
        # ---- 5.10, through the SHIPPED executables ----
        t510 = time.time(); r = run([x / 'mwcli.exe', '--selftest510', x / 'studies', work / 'st510', 'all']); st = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {}
        assert r.returncode == 0 and st.get('failed') == 0 and st.get('untested') == 0 and st.get('passed', 0) >= 21 and st.get('build') == info['build'], (r.returncode, r.stdout[-400:], r.stderr[-1500:])
        rep510 = json.loads((work / 'st510/selftest510.json').read_text()); assert all(c['status'] == 'passed' for c in rep510['checks'])
        s510 = {'selftest510': {'passed': st['passed'], 'failed': st['failed'], 'untested': st['untested'], 'build': st['build'], 'seconds': round(time.time() - t510, 1), 'checks': [c['section'] + ' ' + c['id'] + ': ' + c['name'] for c in rep510['checks']]}}
        # the reference state of the experimental estimator (recorded by the Linux build), on 1 and 4 threads
        edir = x / 'validation/5.10/windows/estimator'; ref510 = json.loads((edir / 'reference.json').read_text()); T = ref510['threads']; th = {}
        for threads in (1, 4):
            st2 = work / ('rbes%d.state' % threads); r = run([x / 'mwcli.exe', edir / T['spec'], T['updates'], threads, st2, T['memoryMiB']], env={**env, 'EIGHTMAX_THREAD_CHOICE': 'fixed'}); assert r.returncode == 0, r.stderr[-300:]
            i510 = json.loads(r.stdout); assert digest(st2) == T['stateSha256'] and i510['threads'] == threads and i510['trainer']['algorithm'] == 'rbes-5.10-v1' and i510['trainer']['experimentalEstimator'] is True and i510['rows'] == T['rows'], (threads, i510['threads'], i510['trainer'])
            th[str(threads)] = {'threadsUsed': i510['threads'], 'wallSeconds': i510['wallSeconds'], 'identicalToTheLinuxReferenceState': True, 'sampledDeals': i510['trainingDeals']}
        s510['rbesReferenceState'] = {'spec': T['spec'], 'stateSha256': T['stateSha256'], 'algorithm': 'rbes-5.10-v1', 'threads': th}
        # the exact check of the estimator (every sampling outcome of the first deals against a full walk), through the shipped program
        E = ref510['exactCheck']; r = run([x / 'mwcli.exe', '--estimator-check', edir / E['spec'], E['updates'], E['deals']]); assert r.returncode == 0, r.stderr[-300:]; ck = json.loads(r.stdout)
        assert ck['passed'] is True and ck['estimator'] == 'rbes-5.10-v1' and ck['largestDifferenceOverScale'] <= ck['tolerance'] and ck['largestOutcomeProbabilityError'] < 1e-9 and ck['entriesCompared'] > 1000, ck
        s510['exactEstimatorCheck'] = {k: ck[k] for k in ('estimator', 'walk', 'players', 'deals', 'seatDeals', 'traversalOutcomesEnumerated', 'entriesCompared', 'largestDifferenceOverScale', 'largestProductionReferenceDifferenceOverScale', 'largestOutcomeProbabilityError', 'tolerance', 'passed')}
        # a state of one trainer is refused by the other; nothing is written
        dsp = edir / ref510['throughput'][0]['defaultSpec']; rsp = edir / ref510['throughput'][0]['rbesSpec']
        r = run([x / 'mwcli.exe', dsp, 5, 1, work / 'd510.state', 512]); assert r.returncode == 0, r.stderr[-300:]
        r = run([x / 'mwcli.exe', rsp, 5, 1, work / 'r510.state', 512]); assert r.returncode == 0, r.stderr[-300:]
        r1 = run([x / 'mwcli.exe', rsp, 5, 1, work / 'no1.state', 512, work / 'd510.state']); r2 = run([x / 'mwcli.exe', dsp, 5, 1, work / 'no2.state', 512, work / 'r510.state'])
        assert r1.returncode != 0 and 'default trainer' in r1.stderr and not (work / 'no1.state').exists() and r2.returncode != 0 and 'experimental training algorithm' in r2.stderr and not (work / 'no2.state').exists(), (r1.stderr[-300:], r2.stderr[-300:])
        r3 = run([x / 'mwcli.exe', rsp, 5, 1, work / 'r510b.state', 512, work / 'r510.state']); r4 = run([x / 'mwcli.exe', rsp, 10, 1, work / 'r510c.state', 512]); assert r3.returncode == 0 and r4.returncode == 0 and digest(work / 'r510b.state') == digest(work / 'r510c.state'), 'a continued rbes training must equal the uninterrupted one'
        s510['checkpointRules'] = {'defaultStateRefusedByRbes': True, 'rbesStateRefusedByDefault': True, 'nothingWritten': True, 'continuedEqualsUninterrupted': True, 'messageToTheDefault': r2.stderr.strip()[-200:]}
        smoke['checks510'] = s510
        # ---- 5.11, through the SHIPPED executables ----
        t511 = time.time(); r = run([x / 'mwcli.exe', '--selftest511', x / 'studies', work / 'st511', 'all']); st = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {}
        assert r.returncode == 0 and st.get('failed') == 0 and st.get('untested') == 0 and st.get('passed') == 26, (r.returncode, r.stdout[-400:], r.stderr[-1200:])
        rep511 = json.loads((work / 'st511/selftest511.json').read_text()); assert all(c['status'] == 'passed' for c in rep511['checks'])
        s511 = {'selftest511': {'passed': st['passed'], 'failed': st['failed'], 'untested': st['untested'], 'build': st['build'], 'seconds': round(time.time() - t511, 1), 'studyDefaultStreams': rep511['studyDefaultStreams'], 'checks': [c['section'] + ' ' + c['id'] + ': ' + c['name'] for c in rep511['checks']]}}
        # the philox64 reference state (recorded by the Linux build), on 1 and 4 threads
        sdir = x / 'validation/5.11/windows/streams'; ref511 = json.loads((sdir / 'reference.json').read_text()); T = ref511['threads']; th = {}
        for threads in (1, 4):
            st2 = work / ('wide%d.state' % threads); r = run([x / 'mwcli.exe', sdir / T['spec'], T['updates'], threads, st2, T['memoryMiB']], env={**env, 'EIGHTMAX_THREAD_CHOICE': 'fixed'}); assert r.returncode == 0, r.stderr[-300:]
            i511 = json.loads(r.stdout); assert digest(st2) == T['stateSha256'] and i511['threads'] == threads and i511['trainingStreams'] == ref511['algorithm'] and i511['rows'] == T['rows'], (threads, i511['threads'], i511.get('trainingStreams'))
            th[str(threads)] = {'threadsUsed': i511['threads'], 'wallSeconds': i511['wallSeconds'], 'identicalToTheLinuxReferenceState': True, 'sampledDeals': i511['trainingDeals']}
        s511['philox64ReferenceState'] = {'spec': T['spec'], 'stateSha256': T['stateSha256'], 'algorithm': ref511['algorithm'], 'threads': th}
        # a state continues only under the streams that trained it
        K = [t for t in ref511['throughput'] if not t['batch']][0]; lsp = sdir / K['streams510Spec']; wsp = sdir / K['philox64Spec']
        r = run([x / 'mwcli.exe', lsp, 500, 1, work / 'l511.state', 512]); assert r.returncode == 0, r.stderr[-300:]
        r = run([x / 'mwcli.exe', wsp, 500, 1, work / 'w511.state', 512]); assert r.returncode == 0, r.stderr[-300:]
        r1 = run([x / 'mwcli.exe', wsp, 5, 1, work / 'no3.state', 512, work / 'l511.state']); r2 = run([x / 'mwcli.exe', lsp, 5, 1, work / 'no4.state', 512, work / 'w511.state'])
        assert r1.returncode != 0 and '5.10 training streams' in r1.stderr and not (work / 'no3.state').exists() and r2.returncode != 0 and 'counter-based training streams' in r2.stderr and not (work / 'no4.state').exists(), (r1.stderr[-300:], r2.stderr[-300:])
        r3 = run([x / 'mwcli.exe', wsp, 500, 1, work / 'w511b.state', 512, work / 'w511.state']); r4 = run([x / 'mwcli.exe', wsp, 1000, 1, work / 'w511c.state', 512]); assert r3.returncode == 0 and r4.returncode == 0 and digest(work / 'w511b.state') == digest(work / 'w511c.state'), 'a continued philox64 training must equal the uninterrupted one'
        s511['checkpointRules'] = {'state510RefusedByPhilox64': True, 'philox64StateRefusedByThe510Streams': True, 'nothingWritten': True, 'continuedEqualsUninterrupted': True, 'messageToThe510Streams': r2.stderr.strip()[-220:]}
        # the update limit: kept by the 5.10 streams, absent for philox64
        t0 = time.time(); r5 = run([x / 'mwcli.exe', lsp, 10000001, 1, work / 'no5.state', 512]); assert r5.returncode == 2 and '10,000,000' in r5.stderr and not (work / 'no5.state').exists(), (r5.returncode, r5.stderr[-300:])
        r6 = run([x / 'mwcli.exe', wsp, 10000064, 1, work / 'big511.state', 512]); assert r6.returncode == 0, r6.stderr[-300:]; big = json.loads(r6.stdout)
        assert big['iterations'] == 10000064 and big['trainingDeals'] == 10000064 and big['maxUpdates'] == 140737488355327, big
        s511['updateLimit'] = {'streams510Refuse10000001Updates': True, 'philox64Updates': big['iterations'], 'philox64MaxUpdates': big['maxUpdates'], 'seconds': round(time.time() - t0, 1)}
        smoke['checks511'] = s511
        smoke['passed'] = True
    record['smokeTest'] = smoke
    vs = x / 'validation/5.11/validation-summary.json'
    record['validationStatus'] = json.loads(vs.read_text()) if vs.exists() else {'note': 'validation/5.11/validation-summary.json is not in the archive'}
finally:
    shutil.rmtree(clean, ignore_errors=True)
record['note'] = 'Every check after the hash was made on a copy extracted from this exact file into a new empty directory.'
(outdir / f'EightMax-Windows-{version}.identity.json').write_text(json.dumps(record, indent=1) + '\n')
print(json.dumps(record, indent=1))
print(f'{archive_sha}  {zip_path.name}')
