"""Smoke / access-control / server scoring / historical snapshot verification."""
import json, os, secrets, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['APP_ENV']='development'
os.environ['DEV_DEMO_LOGIN']='true'
os.environ['DATABASE_PATH']=str(Path(__file__).resolve().parents[1]/'data'/'pytest_lexiverse.db')
from fastapi.testclient import TestClient
from app import app, hash_token, now, uid
from db import connect


def setup_function():
    p=Path(os.environ['DATABASE_PATH']);p.unlink(missing_ok=True)


def teacher(client):
    assert client.post('/api/auth/demo',json={}).status_code==200
    csrf=client.get('/api/me').json()['csrf'];return {'x-csrf-token':csrf}


def create_material(client,headers):
    b=client.post('/api/books',json={'title':'N5','language':'ja'},headers=headers);assert b.status_code==200,b.text
    bid=b.json()['id'];r=client.post(f'/api/books/{bid}/lessons',json={'title':'Bài 1'},headers=headers);assert r.status_code==200,r.text
    lid=r.json()['id']
    for term,meaning,pron in [('図書館','thư viện','としょかん'),('学校','trường học','がっこう')]:
        r=client.post(f'/api/lessons/{lid}/words',json={'term':term,'meaning':meaning,'pronunciation':pron},headers=headers)
        assert r.status_code==200,r.text
    return bid,lid


def test_teacher_crud_and_csrf():
    with TestClient(app) as c:
        assert c.get('/api/books').status_code==401
        h=teacher(c)
        assert c.post('/api/books',json={'title':'Bad','language':'ru'},headers=h).status_code==422
        assert c.post('/api/books',json={'title':'Missing CSRF','language':'en'}).status_code==403
        bid,lid=create_material(c,h)
        assert len(c.get('/api/books').json())==1
        assert len(c.get(f'/api/lessons/{lid}/words').json())==2
        assert c.get(f'/api/books/{bid}/lessons').json()[0]['wordCount']==2
        assert c.post(f'/api/lessons/{lid}/words',json={'term':'','meaning':'ok'},headers=h).status_code==422
        # A separate logged-in teacher cannot discover this owner's materials.
        with connect() as db:
            b_id=uid();db.execute('INSERT INTO users(id,google_sub,name,role,created_at) VALUES(?,?,?,?,?)',(b_id,'teacher-b','Teacher B','teacher',now()))
            raw=secrets.token_urlsafe(32)
            db.execute('INSERT INTO auth_sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)',(hash_token(raw),b_id,'csrf-b',now()+100000))
        c.cookies.set('lx_session',raw)
        assert c.get('/api/books').json()==[]
        assert c.get(f'/api/books/{bid}/lessons').status_code==404
        assert c.patch(f'/api/books/{bid}',json={'title':'Hacked','language':'en'},headers={'x-csrf-token':'csrf-b'}).status_code==404


def test_class_and_live_security_scoring_report():
    with TestClient(app) as c:
        h=teacher(c);bid,lid=create_material(c,h)
        r=c.post('/api/classes',json={'name':'Lớp Nhật 1','language':'ja'},headers=h)
        assert r.status_code==200,r.text
        cid=r.json()['id'];cl=c.get('/api/classes').json()[0]
        inv=cl['invite_code'];assert c.post(f'/api/classes/invite/{inv}/join',json={'nickname':'Học sinh A'}).status_code==200
        assert len(c.get(f'/api/classes/{cid}/members').json())==1
        sess=c.post('/api/sessions',headers=h,json={'lessonId':lid,'classId':cid,'title':'Thi N5','mode':'reading','speed':'slow'})
        assert sess.status_code==200,sess.text
        sid=sess.json()['id'];pin=sess.json()['pin']
        assert c.get(f'/api/sessions/{sid}/qr').headers['content-type']=='image/png'
        assert c.post('/api/public/join',json={'pin':pin,'nickname':'An'}).status_code==200
        guest=c.post('/api/public/join',json={'pin':pin,'nickname':'Bình'}).json()
        pt=guest['playerToken'];player_head={'x-player-token':pt}
        assert c.post('/api/public/join',json={'pin':pin,'nickname':'Bình'}).status_code==409
        assert c.post('/api/public/join',json={'pin':pin,'nickname':'<script>'}).status_code==422
        assert c.post('/api/public/join',json={'pin':'000000','nickname':'Khách'}).status_code==404
        assert c.post(f'/api/sessions/{sid}/start',headers=h).status_code==200
        state=c.get(f'/api/play/{sid}/state',headers=player_head).json()
        assert state['status']=='LIVE'
        assert state['card']['mode']=='reading'
        assert state['card']['audio'] is True
        assert 'audioText' not in state['card']
        assert state['card']['prompt'].startswith('🔊')
        assert 'answer' not in state['card']
        assert 'accepted' not in str(state)
        assert c.post(f'/api/play/{sid}/answer',json={'roundIndex':0,'answer':'こあく'},headers=player_head).json()['points']==0
        # Once-per-round write, including wrong attempts. No free second try.
        assert c.post(f'/api/play/{sid}/answer',json={'roundIndex':0,'answer':'としょかん'},headers=player_head).status_code==409
        other=c.post('/api/public/join',json={'pin':pin,'nickname':'Muộn'})
        assert other.status_code==409  # no late entry after start
        c.post(f'/api/sessions/{sid}/pause',headers=h)
        assert c.post(f'/api/play/{sid}/answer',json={'roundIndex':0,'answer':'としょかん'},headers=player_head).status_code==409
        assert c.post(f'/api/sessions/{sid}/resume',headers=h).status_code==200
        assert c.post(f'/api/sessions/{sid}/end',headers=h).status_code==200
        report=c.get(f'/api/sessions/{sid}/report').json()
        assert report['title']=='Thi N5'
        assert len(report['participants'])==2
        assert report['snapshot'][0]['answer']=='としょかん'
        assert c.get(f'/api/sessions/{sid}/report.csv').status_code==200
        # Historical snapshot preserved after original book is removed.
        assert c.delete(f'/api/books/{bid}',headers=h).status_code==200
        preserved=c.get(f'/api/sessions/{sid}/report').json()
        assert preserved['snapshot']==report['snapshot']
        assert c.post('/api/public/join',json={'pin':pin,'nickname':'Trễ'}).status_code==409
        assert c.get(f'/api/sessions/{sid}/report',headers=player_head).status_code==200 # teacher cookie still in c
        with TestClient(app) as noauth:
            assert noauth.get(f'/api/sessions/{sid}/report').status_code==401
            assert noauth.post('/api/books',json={'title':'Hack','language':'en'}).status_code==401


def test_legacy_import_and_invalid_auth():
    with TestClient(app) as c:
        assert c.post('/api/auth/google',json={'credential':'invalid'}).status_code==503 # no Google client ID configured
        h=teacher(c)
        payload={'sets':[{'id':'a','name':'Oxford 3000','languageCode':'en'},{'id':'b','name':'Sai ngôn ngữ','languageCode':'de'}],
                 'items':[{'setId':'a','term':'harmony','meaning':'hòa hợp','pronunciation':'/hɑːməni/','acceptedAnswers':[]}]}
        r=c.post('/api/import/legacy',json=payload,headers=h)
        assert r.status_code==200,r.text
        assert r.json()=={'books':1,'lessons':1,'words':1,'skipped':1}
        logout=c.post('/api/auth/logout',json={},headers=h);assert logout.status_code==200
        assert c.get('/api/me').status_code==401


def test_websocket_role_specific_views():
    with TestClient(app) as c:
        h=teacher(c)
        _,lid=create_material(c,h)
        created=c.post('/api/sessions',json={'lessonId':lid,'mode':'reading'},headers=h).json()
        sid=created['id'];pt=c.post('/api/public/join',json={'pin':created['pin'],'nickname':'Mai'}).json()['playerToken']
        with c.websocket_connect(f'/ws/sessions/{sid}') as hw:
            hw.send_json({'role':'host'})
            host=hw.receive_json()
            assert host['type']=='STATE'
            assert host['state']['host'] is True
            assert len(host['state']['roster'])==1
            with c.websocket_connect(f'/ws/sessions/{sid}') as pw:
                pw.send_json({'role':'player','playerToken':pt})
                player=pw.receive_json()
                assert player['type']=='STATE'
                assert player['state']['me']['nickname']=='Mai'
                assert 'roster' not in player['state']
                assert 'snapshot' not in str(player)
                assert c.post(f'/api/sessions/{sid}/start',headers=h).status_code==200
                updated=pw.receive_json()
                assert updated['state']['status']=='LIVE'
                assert 'answer' not in updated['state']['card']
                assert 'accepted' not in str(updated)
