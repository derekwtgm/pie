"""Rebuild native programs consistently and reproduce CPU, convergence, selector and trained-state comparisons."""
import argparse,os,pathlib,subprocess,sys,tempfile
P=pathlib.Path;val=P(__file__).resolve().parent;root=val.parents[1]
a=argparse.ArgumentParser(description=__doc__)
a.add_argument('suite',choices=['accuracy','scenarios','profile','selector','trained','continuation','faults','devices','reference','algorithms'])
a.add_argument('output',type=P);a.add_argument('--v36',type=P);a.add_argument('--v35',type=P);a.add_argument('--host',type=P,default=root/'source/build/linux/eightmax');a.add_argument('--table-mib',type=int,default=5300)
args=a.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True);host=args.host.resolve()
def run(*v,env=None):subprocess.run(list(map(str,v)),check=True,cwd=root,env=env)
def build(tree,work):
    work.mkdir();n=tree.resolve()/'source/native';flags=['g++','-std=c++20','-O2','-march=x86-64','-ffp-contract=off','-I'+str(n)]
    run('gcc','-O2','-c',n/'json.c','-o',work/'json.o');run(*flags,'-c',n/'mw.cpp','-o',work/'mw.o');objects=[work/'mw.o',work/'json.o','-pthread','-ldl']
    for name,file in [('mwcli',n/'mwcli.cpp'),('timed',n.parent/'tools/timed_training.cpp')]:
        run(*flags,file,*objects,'-o',work/name)
    if args.suite=='trained' and tree==root:run(*flags,val/'trained-series.cpp',*objects,'-o',work/'trained')
with tempfile.TemporaryDirectory() as td:
    d=P(td);new=d/'new';build(root,new)
    if args.suite=='trained':
        states=out/'states';states.mkdir(exist_ok=True);run(new/'trained',root/'validation/3.6/linked-fixture/spec.json',states,args.table_mib)
        run(sys.executable,val/'trained-recovery.py',host,new/'mwcli',states,out/'trained-recovery.json')
    elif args.suite=='devices':run(sys.executable,val/'device-fallback.py',new/'mwcli',out/'device-modes.json')
    elif args.suite=='reference':run('node',root/'validation/3.6/compare-js.js',new/'mwcli',out/'reference-engines.json')
    elif args.suite=='algorithms':run('node',root/'validation/3.6/accuracy.js',new/'mwcli',new/'timed',out/'algorithm-comparison.json')
    else:
        if not args.v36:a.error('Pass the extracted original 3.6 release directory as --v36')
        if args.suite=='selector':run('node',val/'selector.js',args.v36.resolve()/'source',root/'source',out/'selector.json');sys.exit()
        old=d/'old';build(args.v36,old)
        if args.suite in ('continuation','faults'):
            fixture=d/'fixture';fixture.mkdir();game=root/'validation/3.6/linked-fixture'
            run(old/'mwcli',game/'spec.json',20000,2,fixture/'state',4096)
            run('node',root/'source/tools/checkpoint_encode36.js',game/'meta.json',fixture/'state',fixture/'real.emstudy')
            if args.suite=='continuation':run(sys.executable,val/'native-continuation.py',host,new/'mwcli',out/'native-continuation.json',fixture)
            else:run(sys.executable,val/'restore-faults.py',host,fixture/'real.emstudy',out/'restore-faults.json')
        elif args.suite=='accuracy':run('node',val/'accuracy.js',old/'mwcli',old/'timed',new/'mwcli',new/'timed',out/'accuracy.json')
        else:
            peak=d/'peak';run('gcc','-O2',root/'source/tools/peak_rss.c','-o',peak);programs=[old/'mwcli',old/'timed',new/'mwcli',new/'timed',peak]
            if args.suite=='scenarios':run('sh',val/'run-scenarios.sh',*programs,out/'scenarios.json')
            else:
                if not args.v35:a.error('Pass the extracted original 3.5 release directory as --v35')
                earliest=d/'early';build(args.v35,earliest);specs=d/'specs'
                run('node',val/'scenarios.js',*programs,d/'unused','--quick',env={**os.environ,'EM_SCENARIO':'Eight-player linked','EM_SPEC_DIR':str(specs)})
                run(sys.executable,val/'profile-linked.py',earliest/'mwcli',old/'mwcli',new/'mwcli',specs,out/'profile-linked.json')
