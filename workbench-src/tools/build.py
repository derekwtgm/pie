"""Developer utility. End users need only the generated START.html."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
html = (root / 'dashboard.html').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="src/style.css">', '<style>\n' + (root / 'src/style.css').read_text(encoding='utf-8') + '\n</style>')
libs = ['cards','eval','pots','icm','information','checkpoint','eqdata','pushfold','fgs','runouts','wide','river']
worker = '\n;\n'.join((root / 'vendor/eightmax-5.1' / ('lib_' + name + '.js')).read_text(encoding='utf-8') for name in libs)
for name in ('convergence.js','engine.js','round-audit.js','settlement.js','observations.js','study-adapter.js','reviewed-study.js','cpu-checkpoints.js','native-jobs.js','study-play.js','study-worker.js'):
    worker += '\n;\n' + (root / 'src' / name).read_text(encoding='utf-8')
if '</script' in worker.lower():
    raise ValueError('Unexpected script terminator in worker bundle')
html = html.replace('/*WORKER_SOURCE*/', worker)
# 0.23: the multi-table panel needs the EightMax reference libraries on the page thread as well.
main_libs = '\n;\n'.join((root / 'vendor/eightmax-5.1' / ('lib_' + name + '.js')).read_text(encoding='utf-8') for name in libs)
if '</script' in main_libs.lower():
    raise ValueError('Unexpected script terminator in main-thread libraries')
html = html.replace('<!--MAIN_LIBS-->', '<script>\n' + main_libs + '\n</script>')
for name in ('range-engine.js','research-view.js','research-ui.js','research032-view.js','research032-ui.js','research033-view.js','research033-ui.js','convergence.js','engine.js','session.js','study-adapter.js','round-audit.js','settlement.js','observations.js','reviewed-study.js','cpu-checkpoints.js','native-jobs.js','desktop-host.js','native-archive.js','study-queue.js','workloads.js','study-play.js','forms.js','cache.js','benchmark.js','app.js','session-ui.js','workloads-ui.js','vision.js','vision-ui.js','image-validation.js','image-validation-demo.js','image-validation-ui.js','worker-client.js','study-ui.js','native-archive-ui.js','benchmark-ui.js','review-session.js','preflop-demo.js','completed-demo.js','reviewed-demo.js','observations-ui.js','workspace.js','workspace-ui.js','hand-ledger.js','hand-state.js','solver-service.js','test-executor.js','multitable.js','vision-ocr.js','hardware-report.js','multitable-ui.js','image-codec.js','solver-tree.js','screen-capture.js','sim-display.js','vision-track.js','vision-metrics.js','full-hand.js','capture-ui.js','resource-monitor.js','platform-profile.js','calibration.js','capture-manager.js','execution-adapters.js','strategy-budget.js','platform-ui.js','test-results.js','test-results-ui.js','strategy-library-view.js','strategy-library-ui.js','input-geometry.js','input-motion.js','windows-input-driver.js','input-scheduler.js','status-strip.js','fixture-dealer.js','simulator-profiles.js','simulator-controls.js','simulator-controls-ui.js'):
    script = (root / 'src' / name).read_text(encoding='utf-8').replace('</script', '<\\/script')
    html = html.replace('<script src="src/' + name + '"></script>', '<script>\n' + script + '\n</script>')
# 0.32: release research measurements embedded for the Research panel when the desktop host is not connected (labelled as release data)
import json as _json
_sum = root / 'src' / 'research-release-summary.json'   # 0.33: written by tools/research-summary-033.cjs --release (0.32 keys + v033 block), kept in src/ so the build is reproducible from sources
_emb = _json.dumps(_json.loads(_sum.read_text(encoding='utf-8'))) if _sum.exists() else 'null'
html = html.replace('<!--RESEARCH_SUMMARY-->', '<script>window.EIGHTMAX_RESEARCH_SUMMARY=' + _emb.replace('</', '<\\/') + ';</script>')
with open(root / 'START.html', 'w', encoding='utf-8', newline='\n') as out: out.write(html)  # 0.29: identical bytes on Windows and Linux
print('Built standalone START.html with EightMax 5.1 worker:', len(html.encode()), 'bytes')
