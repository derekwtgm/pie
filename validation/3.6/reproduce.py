"""Run Linux CPU comparisons and cold study recovery from the extracted release."""
import argparse,os,pathlib,subprocess,sys,tempfile
P=pathlib.Path
val=P(__file__).resolve().parent;root=val.parents[1]
ap=argparse.ArgumentParser();ap.add_argument('suite',choices=['sizes','study','math','performance','reference']);ap.add_argument('output',type=P);ap.add_argument('--v35',type=P);ap.add_argument('--v34',type=P)
ap.add_argument('--host',type=P,default=root/'source/build/linux/eightmax');a=ap.parse_args()
out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
def run(*args,env=None,output=None):subprocess.run(list(map(str,args)),cwd=root,env=env,stdout=output,check=True)
def build(tree,d):
 d.mkdir();s=tree.resolve()/'source';n=s/'native';flags=['g++','-std=c++20','-O2','-march=x86-64','-ffp-contract=off','-I'+str(n)]
 run('gcc','-O2','-c',n/'json.c','-o',d/'j.o');run(*flags,'-c',n/'mw.cpp','-o',d/'mw.o')
 for name,src in [('mwcli',n/'mwcli.cpp'),('timed',s/'tools/timed_training.cpp')]:run(*flags,src,d/'mw.o',d/'j.o','-pthread','-ldl','-o',d/name)
if a.suite=='sizes':
 run(sys.executable,root/'source/tools/checkpoint_stress36.py',a.host.resolve(),out/'sizes.json',16,64,128,256,512,1024);sys.exit()
with tempfile.TemporaryDirectory() as tmp:
 d=P(tmp);new=d/'new';build(root,new)
 if a.suite=='study':
  f=d/'fixture';run('node',root/'source/tools/fixture36.js',f)
  with (out/'status.json').open('w') as status:run(new/'mwcli',f/'spec.json',20000,2,out/'state',960,output=status)
  with (out/'encoding.json').open('w') as enc:run('node',root/'source/tools/checkpoint_encode36.js',f/'meta.json',out/'state',out/'real.emstudy',output=enc)
  run(sys.executable,val/'real-continuation.py',a.host.resolve(),new/'mwcli',f,out,out/'continuation.json')
  run(sys.executable,val/'legacy-large.py',a.host.resolve(),f/'meta.json',out/'state',out/'legacy-large.json')
 elif a.suite=='reference':run('node',val/'compare-js.js',new/'mwcli',out/'reference-engines.json')
 else:
  if not a.v35:ap.error('Specify the extracted 3.5 tree with --v35')
  old=d/'old';build(a.v35,old)
  if a.suite=='math':
   run('node',val/'accuracy.js',new/'mwcli',new/'timed',out/'accuracy-river.json')
   run('node',val/'time-to-target.js',old/'mwcli',new/'mwcli',new/'timed',out/'time-to-target.json')
  else:
   if not a.v34:ap.error('Specify the extracted 3.4 tree with --v34')
   orig=d/'orig';build(a.v34,orig);peak=d/'peak';run('gcc','-O2',root/'source/tools/peak_rss.c','-o',peak)
   args=[old/'mwcli',old/'timed',new/'mwcli',new/'timed',peak];specs=d/'specs'
   run('node',val/'scenarios.js',*args,d/'unused','--quick',env={**os.environ,'EM_SCENARIO':'Eight-player linked','EM_SPEC_DIR':str(specs)})
   run(sys.executable,val/'profile-linked.py',orig/'mwcli',old/'mwcli',new/'mwcli',specs,out/'profile-linked.json')
   run('sh',val/'run-scenarios.sh',*args,out/'scenarios.json')
