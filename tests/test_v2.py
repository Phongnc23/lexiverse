"""Regression checks for LexiVerse 2.0 feature set."""
from pathlib import Path
import hashlib
import io
import os
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
# Independent database for these tests.
os.environ['APP_ENV']='development'
os.environ['DEV_DEMO_LOGIN']='true'
os.environ.setdefault('DATABASE_PATH',str(Path(__file__).resolve().parents[1]/'data'/'pytest_lexiverse.db'))
from fastapi.testclient import TestClient
from app import app, cards_for_session, join_attempts
from db import one


def setup_function():
    Path(os.environ['DATABASE_PATH']).unlink(missing_ok=True)
    join_attempts.clear()


def login(c):
    assert c.post('/api/auth/demo',json={}).status_code==200
    return {'x-csrf-token':c.get('/api/me').json()['csrf']}


def book_and_lesson(c,h,lang):
    b=c.post('/api/books',headers=h,json={'title':f'Sách {lang}','language':lang})
    assert b.status_code==200,b.text
    lid=c.post(f"/api/books/{b.json()['id']}/lessons",json={'title':'Bài 1'},headers=h)
    assert lid.status_code==200,lid.text
    return b.json()['id'],lid.json()['id']


def test_language_choices_api_and_templates():
    with TestClient(app) as c:
        h=login(c)
        assert c.post('/api/books',headers=h,json={'title':'Không cho Việt','language':'vi'}).status_code==422
        assert c.post('/api/classes',headers=h,json={'name':'Lớp Việt','language':'vi'}).status_code==422
        for lang in ('ja','zh-CN','en'):
            _,lid=book_and_lesson(c,h,lang)
            r=c.get(f'/api/lessons/{lid}/words/template')
            assert r.status_code==200
            assert r.content.startswith(b'\xef\xbb\xbf')
            for col in ('term','meaning','pronunciation','alternatives','sort_order'):
                assert col in r.text


def test_csv_bulk_import_duplicates_and_permission():
    with TestClient(app) as c:
        h=login(c);_,lid=book_and_lesson(c,h,'ja')
        header='term,meaning,pronunciation,alternatives,sort_order\n'
        rows='図書館,thư viện,としょかん,,1\n学校,trường học,がっこう,,2\n図書館,lặp,としょかん,,3\n家,nhà,,,4\n'
        raw=('\ufeff'+header+rows).encode('utf8')
        url=f'/api/lessons/{lid}/words/import'
        r=c.post(url,files={'file':('data.csv',io.BytesIO(raw),'text/csv')})
        assert r.status_code==403
        r=c.post(url,headers=h,files={'file':('data.csv',io.BytesIO(raw),'text/csv')})
        assert r.status_code==200,r.text
        assert r.json()['added']==2
        assert r.json()['skipped']==2
        r=c.post(url,headers=h,files={'file':('data.csv',io.BytesIO(raw),'text/csv')})
        assert r.json()['added']==0 and r.json()['skipped']==4
        words=c.get(f'/api/lessons/{lid}/words').json()
        assert {w['term'] for w in words}=={'図書館','学校'}
        for bad in ('nope.txt','data.xlsx'):
            assert c.post(url,headers=h,files={'file':(bad,io.BytesIO(raw),'application/octet-stream')}).status_code==422
        assert c.post(url,headers=h,files={'file':('big.csv',io.BytesIO(b'x'*(2*1024*1024+1)),'text/csv')}).status_code==413


def test_one_keyboard_per_language_and_reading_audio_never_exposed():
    cases=[('ja','図書館','thư viện','としょかん'),
           ('zh-CN','图书馆','thư viện','tú shū guǎn'),
           ('en','library','thư viện','/ˈlaɪbrəri/')]
    with TestClient(app) as c:
        h=login(c)
        for lang,term,meaning,pron in cases:
            _,lid=book_and_lesson(c,h,lang)
            for n in range(4):
                c.post(f'/api/lessons/{lid}/words',headers=h,json={
                    'term':term+str(n), 'meaning':meaning+' '+str(n),'pronunciation':pron})
            for mode in ('spelling','reading','mixed'):
                result=c.post('/api/sessions',json={'lessonId':lid,'mode':mode,'speed':'slow'},headers=h)
                assert result.status_code==200,result.text
                sid=result.json()['id'];pin=result.json()['pin']
                session=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
                cards=cards_for_session(session)
                assert set(x['mode'] for x in cards)==({'spelling','reading'} if mode=='mixed' else {mode})
                assert all(c['answer'] == (c['term'] if lang=='en' else pron) for c in cards)
                join=c.post('/api/public/join',json={'pin':pin,'nickname':'Người chơi'})
                assert join.status_code==200,join.text
                player=join.json()
                assert c.post(f'/api/sessions/{sid}/start',headers=h).status_code==200
                data=c.get(f'/api/play/{sid}/state',headers={'x-player-token':player['playerToken']}).json()
                assert 'answer' not in data['card']
                assert 'audioText' not in str(data)
                assert 'accepted' not in str(data)
                assert data['card']['audio']==(cards[0]['mode']=='reading')
                # nobody may access a private audio request; spelling audio not allowed.
                # Use the existing TestClient; nesting another lifespan would restart timers.
                assert c.get(f'/api/play/{sid}/audio?roundIndex=0',headers={'x-player-token':'invalid-player-token'}).status_code==401
                if cards[0]['mode']!='reading':
                    assert c.get(f'/api/play/{sid}/audio?roundIndex=0',headers={'x-player-token':player['playerToken']}).status_code==422
                # close before next.
                c.post(f'/api/sessions/{sid}/end',headers=h)
            assert c.post('/api/sessions',json={'lessonId':lid,'mode':'meaning'},headers=h).status_code==422


def test_audio_endpoint_generates_private_mp3_with_correct_tts_language(monkeypatch):
    """No real external TTS calls; check localized TTS request and access control."""
    import gtts
    from app import ROOT
    from hashlib import sha256
    seen=[]
    class FakeTTS:
        def __init__(self, text, lang, timeout):
            seen.append((text,lang))
        def write_to_fp(self, stream):
            stream.write(b'ID3'+b'X'*400)
    monkeypatch.setattr(gtts,'gTTS',FakeTTS)
    with TestClient(app) as client:
        h=login(client)
        for language, term, pron, expected_lang in [
            ('ja','学校','がっこう','ja'),('zh-CN','学校','xué xiào','zh-CN'),('en','school','/skuːl/','en')
        ]:
            _, lid=book_and_lesson(client,h,language)
            for n in range(2):
                resp=client.post(f'/api/lessons/{lid}/words',headers=h,
                     json={'term':term+str(n),'meaning':'trường học','pronunciation':pron})
                assert resp.status_code==200,resp.text
            make=client.post('/api/sessions',json={'lessonId':lid,'mode':'reading','speed':'slow'},headers=h)
            assert make.status_code==200,make.text
            sid=make.json()['id'];pin=make.json()['pin']
            joining=client.post('/api/public/join',json={'pin':pin,'nickname':'Học sinh test'})
            assert joining.status_code==200,joining.text
            ph={'x-player-token':joining.json()['playerToken']}
            assert client.post(f'/api/sessions/{sid}/start',headers=h).status_code==200
            state=client.get(f'/api/play/{sid}/state',headers=ph).json()
            assert state['card']['audio'] is True
            assert not any(x in state['card'] for x in ('audioText','audioLang','answer','accepted'))
            response=client.get(f'/api/play/{sid}/audio?roundIndex=0',headers=ph)
            assert response.status_code==200,response.text if response.status_code!=200 else ''
            assert response.headers['content-type'].startswith('audio/mpeg')
            assert seen[-1][1]==expected_lang
            assert client.get(f'/api/play/{sid}/audio?roundIndex=1',headers=ph).status_code==409
            assert client.get(f'/api/play/{sid}/audio?roundIndex=0',headers={'x-player-token':'bad'}).status_code==401
            client.post(f'/api/sessions/{sid}/end',headers=h)
            # Remove only test-generated audio; never touch other files.
            audio_lang={'ja':'ja-JP','zh-CN':'zh-CN','en':'en-US'}[language]
            key=sha256((audio_lang+'\0'+term+'0').encode()).hexdigest()
            (ROOT/'data'/'tts'/f'{key}.mp3').unlink(missing_ok=True)
