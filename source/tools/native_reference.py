import json
import time
import itertools
from collections import Counter
from urllib.request import build_opener, ProxyHandler, Request
from urllib.error import HTTPError

# Start the native server with --no-browser --port=18708, or pass its base URL.
import sys
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:18708'
opener=build_opener(ProxyHandler({}))
def api(route, payload=None):
    req=Request(base+'/api/'+route,data=json.dumps(payload).encode() if payload is not None else None,headers={'X-EightMax':'1','Content-Type':'application/json'})
    try:
        with opener.open(req,timeout=40) as r: return r.status,json.load(r)
    except HTTPError as e: return e.code,json.load(e)
def ok(route,payload=None):
    code,body=api(route,payload)
    assert code==200,(code,body)
    return body
def card(s):
    return '23456789TJQKA'.index(s[0])*4+'cdhs'.index(s[1])
deck=list(itertools.combinations(range(52),2))
def handid(v): return deck.index(tuple(sorted((card(v[:2]),card(v[2:])))))
def weights(*hands): return [int(i in map(handid,hands)) for i in range(len(deck))]
def lab(node):
    return {'acts':[a['label'] for a in node['actions']],'strategy':node['strategy'],'ev':node['ev'],'action_ev':node['evActions']}

cfg={'board':[card(s) for s in ['2c','4d','7h','9s','Jc']],'pot':10,'stack':10,
     'ranges':[weights('QhQd'),weights('AsAd','KsTh')],'sizes':{'bet':[['',''],['',''],['','100']],'raise':[['',''],['',''],['','']]},'compress':0,'iso':0,'gpu':0,'forceAllin':0,'maxBets':1}
print('three handed postflop',api('estimate',{**cfg,'ranges':cfg['ranges']+[weights('8s8d')]}))
print('duplicate blocked ranges',api('estimate',{**cfg,'ranges':[weights('QhQd'),weights('QhQc')]}))
m=ok('build',cfg)
print('native meta:',m['stats'],'combo ids:',m['combos'])
ok('solve',{'maxIter':10000,'target':0.000001,'power':0})
for _ in range(500):
    s=ok('status')
    if s['done'] and not s['running']:break
    time.sleep(.01)
assert s['done'] and s['error'] is None,s
i=ok('node',{'path':[0]}); d=ok('node',{'path':[0,1]})
strong,weak=m['combos'][1].index(handid('AsAd')),m['combos'][1].index(handid('KsTh'))
print('river output:',s,'aggressor',lab(i),'defender',lab(d))
print('river result',{'Vbet':i['strategy'][2+strong],'Wbet':i['strategy'][2+weak],'defend':d['strategy'][1]})
assert i['strategy'][2+strong]>0.995 and abs(i['strategy'][2+weak]-.5)<.015 and abs(d['strategy'][1]-.5)<.015
def run(c, iterations=10):
    ok('build',c)
    ok('solve',{'maxIter':iterations,'target':0.000001,'power':0})
    for _ in range(1000):
        st=ok('status')
        if st['done'] and not st['running']:
            assert st['error'] is None,st
            return st,ok('node',{'path':[]})
        time.sleep(.01)
    raise RuntimeError('timeout')
empty=[['',''],['',''],['','']]
checks={**cfg,'sizes':{'bet':empty,'raise':empty}}
st,q=run(checks)
print('same game check only',{'valueRoot':q['ev'][0][0], 'exploitPct':st['ex']})
assert q['ev'][0][0]==5 and abs(st['ex'])<.0001

def strength5(cs):
    ranks=[(c//4)+2 for c in cs]
    by=Counter(ranks)
    groups=sorted(((n,r) for r,n in by.items()),reverse=True)
    rs=sorted(ranks,reverse=True)
    straight=0
    if len(by)==5:
        if rs[0]-rs[-1]==4: straight=rs[0]
        elif rs==[14,5,4,3,2]: straight=5
    flush=len({c%4 for c in cs})==1
    if flush and straight:return (8,straight)
    if groups[0][0]==4: return (7,groups[0][1],groups[1][1])
    if [n for n,r in groups]==[3,2]: return (6,groups[0][1],groups[1][1])
    if flush: return (5,*rs)
    if straight: return (4,straight)
    cat={3:3,2:2 if groups[1][0]==2 else 1,1:0}[groups[0][0]]
    return (cat,*(r for _,r in groups))
def seven(cs): return max(map(strength5,itertools.combinations(cs,5)))
holes=[[card('Ah'),card('Ad')],[card('Ks'),card('Kh')]]
flop=[card(v) for v in ['2c','7d','Th']]
rest=sorted(set(range(52)).difference(flop,*holes))
pairs=list(itertools.combinations(rest,2))
scores=[(seven([*flop,*pair,*holes[0]]),seven([*flop,*pair,*holes[1]])) for pair in pairs]
win=sum(a>b for a,b in scores); tie=sum(a==b for a,b in scores); ref=(win+tie/2)/len(scores)
flcfg={**checks,'board':flop,'ranges':[weights('AhAd'),weights('KsKh')]}
st,q=run(flcfg)
print('heads-up checkdown',{'comparedRunouts':len(scores),'wins':win,'ties':tie,'exactEquity':ref,'nativeEquity':q['equity'][0][0],'nativeEV':q['ev'][0][0],'exactEV':ref*cfg['pot']})
assert abs(q['equity'][0][0]-ref)<0.00006 and abs(q['ev'][0][0]-ref*cfg['pot'])<0.001
