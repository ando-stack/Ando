import json,glob,unicodedata,re,sys
def norm(s): s=unicodedata.normalize('NFD',s or '').encode('ascii','ignore').decode().lower(); return re.sub(r'[^a-z ]',' ',s).split()
teams={}; people={}
for f in glob.glob('raw/team*__FCBQWeb_getTeamCard*'):
    d=json.load(open(f))['messageData']; t=d['team']; tid=t['idSignedTeam']
    teams[tid]={'id':tid,'name':t['name'],'club':d['club']['name'],'uuid':t['teamUuid'],'coach':[],'players':[]}
    for p in d['players']:
        full=re.sub(r'\s+',' ',(p['name']+' '+p['surname']).strip()); lt=p['licenseTypeName'] or ''
        if 'ENTREN' in lt: teams[tid]['coach'].append(full)
        elif 'JUGADOR' in lt:
            pid=p['uuid']; people[pid]={'id':pid,'name':full,'team':tid,'games':[]}; teams[tid]['players'].append(pid)
uuid2tid={t['uuid']:k for k,t in teams.items()}
matches=json.load(open('matches.json'))
def score(n,r):
    if not n or not r: return 0
    if all(len(x)==1 for x in n):  # initials like "M. P."
        return 2 if len(n)<=len(r) and all(r[i][0]==n[i] for i in range(len(n))) else 0
    f = n[0]==r[0] or (min(len(n[0]),len(r[0]))>=4 and (n[0].startswith(r[0]) or r[0].startswith(n[0])))
    sur=len(set(n[1:])&set(r[1:]))
    if not f and sur<2: return 0
    return (1 if f else 0)+sur
used=set()
def find(tid,name,uuid,mid):
    if uuid and uuid in people: used.add((mid,uuid)); return uuid
    n=norm(name); best=None;bs=0
    for pid in teams[tid]['players']:
        if (mid,pid) in used: continue
        sc=score(n,norm(people[pid]['name']))
        if sc>bs: bs,best=sc,pid
    if bs>=2: used.add((mid,best)); return best
    pid=uuid or f'x{tid}-{"-".join(n)}'; people.setdefault(pid,{'id':pid,'name':re.sub(r'\s+',' ',name).strip().upper(),'team':tid,'games':[]})
    if pid not in teams[tid]['players']: teams[tid]['players'].append(pid)
    print('UNMATCHED',teams[tid]['name'],name,file=sys.stderr); used.add((mid,pid)); return pid
games=[]
for m in matches:
    sf=glob.glob(f"raw/match{m['idMatch']}__v1_frb_matches_*_stats.json")
    g={'id':m['idMatch'],'j':int(m['numMatchDay']),'date':m['matchDay'],'home':m['idLocalTeam'],'away':m['idVisitorTeam'],
       'hs':int(m['localScore']) if sf else None,'as':int(m['visitorScore']) if sf else None,'field':m['nameField']}
    games.append(g)
    if not sf: continue
    box=[b for b in json.load(open(sf[0]))['boxscore'] if b['period']==0][0]
    for side,tid,opp,my,their in (('local',g['home'],g['away'],g['hs'],g['as']),('visitor',g['away'],g['home'],g['as'],g['hs'])):
        for pl in box[side]['players']:
            pid=find(tid,pl['name'],pl.get('uuid'),g['id']); a=pl['accumulated']; c=pl['computed']
            people[pid]['games'].append({'j':g['j'],'opp':opp,'res':'W' if my>their else 'L','sc':f"{my}-{their}",'st':1 if pl['starting'] else 0,
              'min':round(c['seconds']/60,1),'pts':a['pts'],'t2m':a['t2m'],'t2a':a['t2a'],'t3m':a['t3m'],'t3a':a['t3a'],'ftm':a['ftm'],'fta':a['fta'],'fc':a['fc'],'pm':c['onCourtPlusMinus'],'d':pl['dorsal']})

# merge acta-only entries into roster players by team + dorsal + compatible first name
for xid in [k for k in list(people) if k.startswith('x')]:
    x=people[xid]; tid=x['team']; n=norm(x['name']); xd={g['d'] for g in x['games']}; xj={g['j'] for g in x['games']}
    for pid in teams[tid]['players']:
        if pid==xid or pid.startswith('x'): continue
        p=people[pid]; r=norm(p['name']); pd={g['d'] for g in p['games']}; pj={g['j'] for g in p['games']}
        initials=all(len(t)==1 for t in r) and all(n[i][0]==r[i] for i in range(min(len(r),len(n))))
        firstok = initials or (n and r and (n[0]==r[0] or n[0][:4]==r[0][:4]))
        if firstok and xd&pd and not xj&pj:
            p['games']=sorted(p['games']+x['games'],key=lambda g:g['j']); del people[xid]; teams[tid]['players'].remove(xid)
            print('MERGED',x['name'],'->',p['name'],file=sys.stderr); break
json.dump({'teams':teams,'players':people,'games':games},open('dataset.json','w'),ensure_ascii=False)
pl=[p for p in people.values()]; print(len(teams),'teams',len(pl),'players',sum(1 for p in pl if p['games']),'with games',sum(len(p['games']) for p in pl),'player-games')
