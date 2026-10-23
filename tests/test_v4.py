"""V4 regressions: host card-count selection and private answer-slot metadata."""
from pathlib import Path
import os, sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['APP_ENV']='development'
os.environ['DEV_DEMO_LOGIN']='true'
os.environ.setdefault('DATABASE_PATH',str(Path(__file__).resolve().parents[1]/'data'/'pytest_lexiverse.db'))
from fastapi.testclient import TestClient
from app import app, cards_for_session
from db import one


def test_count_limit_and_answer_slots_hidden_from_players():
    with TestClient(app) as c:
        assert c.post('/api/auth/demo',json={}).status_code==200
        h={'x-csrf-token': c.get('/api/me').json()['csrf']}
        bid=c.post('/api/books',headers=h,json={'title':'日本語','language':'ja'}).json()['id']
        lid=c.post(f'/api/books/{bid}/lessons',headers=h,json={'title':'日本語 bài 41'}).json()['id']
        for term,reading in [('いただきます','いただきます'),('図書館','としょかん'),('先生','せんせい')]:
            assert c.post(f'/api/lessons/{lid}/words',headers=h,json={
                'term':term,'meaning':'từ kiểm tra','pronunciation':reading}).status_code==200
        url='/api/sessions'
        for value in (0,4,-1,'bad','2.5',True):
            r=c.post(url,headers=h,json={'lessonId':lid,'count':value})
            assert r.status_code==422,(value,r.text)
        r=c.post(url,headers=h,json={'lessonId':lid,'count':2,'mode':'spelling','shuffle':False})
        assert r.status_code==200,r.text
        sid=r.json()['id']
        session=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
        assert len(cards_for_session(session))==2
        joined=c.post('/api/public/join',json={'pin':r.json()['pin'],'nickname':'Học sinh'}).json()
        assert c.post(f'/api/sessions/{sid}/start',headers=h).status_code==200
        player=c.get(f'/api/play/{sid}/state',headers={'x-player-token':joined['playerToken']}).json()
        assert player['count']==2
        assert player['card']['slotLengths']==[len('いただきます')]
        assert 'answer' not in player['card']
        assert 'accepted' not in player['card']
        assert 'pronunciation' not in player['card']
        assert 'audioText' not in player['card']
        c.post(f'/api/sessions/{sid}/end',headers=h)
