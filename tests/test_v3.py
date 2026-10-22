"""V3 regression: integrated personal practice, privacy, and SPA deep links."""
from pathlib import Path
import os
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['APP_ENV']='development'
os.environ['DEV_DEMO_LOGIN']='true'
os.environ.setdefault('DATABASE_PATH',str(Path(__file__).resolve().parents[1]/'data'/'pytest_lexiverse.db'))
from fastapi.testclient import TestClient
from app import app


def test_practice_deck_and_deep_link():
    with TestClient(app) as client:
        for route in ('/app','/app/practice','/app/practice/lesson123'):
            response=client.get(route)
            assert response.status_code==200
            assert 'LexiVerse' in response.text
        assert client.get('/static/solo-game.html').status_code==404
        assert client.get('/api/practice/lessons/missing/cards').status_code==401
        assert client.post('/api/auth/demo',json={}).status_code==200
        csrf=client.get('/api/me').json()['csrf']
        h={'x-csrf-token':csrf}
        book=client.post('/api/books',json={'title':'English Solo V3','language':'en'},headers=h)
        assert book.status_code==200
        bid=book.json()['id']
        lesson=client.post(f'/api/books/{bid}/lessons',json={'title':'Chủ đề thư viện'},headers=h)
        assert lesson.status_code==200
        lid=lesson.json()['id']
        empty=client.get(f'/api/practice/lessons/{lid}/cards')
        assert empty.status_code==422
        for term,meaning in [('library','thư viện'),('harmony','sự hài hòa'),('student','học sinh')]:
            assert client.post(f'/api/lessons/{lid}/words',headers=h,json={'term':term,'meaning':meaning}).status_code==200
        assert client.get(f'/api/practice/lessons/{lid}/cards?mode=meaning').status_code==422
        for mode in ('mixed','spelling','reading'):
            response=client.get(f'/api/practice/lessons/{lid}/cards?mode={mode}')
            assert response.status_code==200,response.text
            data=response.json()
            assert data['lessonTitle']=='Chủ đề thư viện'
            assert data['bookTitle']=='English Solo V3'
            assert data['count']==3
            assert all(c['mode'] in ('spelling','reading') for c in data['cards'])
            if mode!='mixed':assert all(c['mode']==mode for c in data['cards'])
            assert all(c['answer'] and c['accepted'] for c in data['cards'])
