"""Developer utility. End users need only the generated START.html."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
html = (root / 'dashboard.html').read_text()
html = html.replace('<link rel="stylesheet" href="src/style.css">', '<style>\n' + (root / 'src/style.css').read_text() + '\n</style>')
libs = ['cards','eval','pots','icm','information','checkpoint','eqdata','pushfold','fgs','runouts','wide','river']
worker = '\n;\n'.join((root / 'vendor/eightmax-5.1' / ('lib_' + name + '.js')).read_text() for name in libs)
for name in ('convergence.js','engine.js','round-audit.js','settlement.js','observations.js','study-adapter.js','reviewed-study.js','cpu-checkpoints.js','native-jobs.js','study-play.js','study-worker.js'):
    worker += '\n;\n' + (root / 'src' / name).read_text()
if '</script' in worker.lower():
    raise ValueError('Unexpected script terminator in worker bundle')
html = html.replace('/*WORKER_SOURCE*/', worker)
# 0.23: the multi-table panel needs the EightMax reference libraries on the page thread as well.
main_libs = '\n;\n'.join((root / 'vendor/eightmax-5.1' / ('lib_' + name + '.js')).read_text() for name in libs)
if '</script' in main_libs.lower():
    raise ValueError('Unexpected script terminator in main-thread libraries')
html = html.replace('<!--MAIN_LIBS-->', '<script>\n' + main_libs + '\n</script>')
for name in ('convergence.js','engine.js','session.js','study-adapter.js','round-audit.js','settlement.js','observations.js','reviewed-study.js','cpu-checkpoints.js','native-jobs.js','desktop-host.js','native-archive.js','study-queue.js','workloads.js','study-play.js','forms.js','cache.js','benchmark.js','app.js','session-ui.js','workloads-ui.js','vision.js','vision-ui.js','image-validation.js','image-validation-demo.js','image-validation-ui.js','worker-client.js','study-ui.js','native-archive-ui.js','benchmark-ui.js','review-session.js','preflop-demo.js','completed-demo.js','reviewed-demo.js','observations-ui.js','workspace.js','workspace-ui.js','hand-ledger.js','hand-state.js','solver-service.js','test-executor.js','multitable.js','vision-ocr.js','hardware-report.js','multitable-ui.js','image-codec.js','solver-tree.js','screen-capture.js','sim-display.js','vision-track.js','vision-metrics.js','full-hand.js','capture-ui.js','resource-monitor.js','platform-profile.js','calibration.js','capture-manager.js','execution-adapters.js','platform-ui.js'):
    script = (root / 'src' / name).read_text().replace('</script', '<\\/script')
    html = html.replace('<script src="src/' + name + '"></script>', '<script>\n' + script + '\n</script>')
(root / 'START.html').write_text(html)
print('Built standalone START.html with EightMax 5.1 worker:', len(html.encode()), 'bytes')
