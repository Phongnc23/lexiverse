"""LexiVerse MVP: Google SSO, owner-scoped CRUD, realtime host/player, server-authoritative scoring.
Run one uvicorn worker: in-process websocket manager and round scheduler are single-process.
"""
import asyncio, csv, hashlib, hmac, io, json, os, re, secrets, time, unicodedata, uuid
from collections import defaultdict
from threading import Lock
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import quote

import jwt
import qrcode
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from jwt import PyJWKClient
from pydantic import BaseModel, Field

from db import init_db, one, all_rows, connect

ROOT = Path(__file__).resolve().parent
# Support .env without another dependency.
if (ROOT/'.env').exists():
    for line in (ROOT/'.env').read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.strip().startswith('#'):
            k,v=line.split('=',1)
            os.environ.setdefault(k.strip(),v.strip())
# db was imported earlier; reset its path if .env set DATABASE_PATH.
import db as dbmod
dbmod.DB_PATH = str((ROOT / os.environ.get('DATABASE_PATH','./data/lexiverse.db')).resolve())
ENV = os.getenv('APP_ENV','production').lower()
DEV_LOGIN = ENV == 'development' and os.getenv('DEV_DEMO_LOGIN','false').lower()=='true'
GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID','')
MAX_PLAYERS = max(1, int(os.getenv('MAX_PARTICIPANTS','50')))
LANGS={'vi','en','ja','zh-CN'}  # Still supported as display/translation language.
CONTENT_LANGS={'en','ja','zh-CN'}
MODES={'spelling','reading','mixed'}
BULK_LIMIT_BYTES=2*1024*1024
BULK_MAX_ROWS=1000
SPEEDS={'slow':20000,'normal':12000,'fast':8000}
TTS_LANGUAGE_CODES={'ja-JP':'ja','zh-CN':'zh-CN','en-US':'en','vi-VN':'vi'}
tts_file_locks=defaultdict(Lock)
SESSION_TTL=14*86400
hash_token=lambda t: hashlib.sha256(t.encode()).hexdigest()
now=lambda: int(time.time()*1000)
uid=lambda: str(uuid.uuid4())


def err(code, msg): raise HTTPException(status_code=code, detail=msg)
def cleaned(s, maximum=180):
    if not isinstance(s,str): return ''
    return re.sub(r'\s+', ' ',unicodedata.normalize('NFC',s)).strip()[:maximum]
def required(d,k,maxlen=180,minlen=1):
    s=cleaned(d.get(k),maxlen+1)
    if not minlen<=len(s)<=maxlen: err(422, f'{k}: cần từ {minlen}–{maxlen} ký tự')
    return s
def language(d):
    val=d.get('language','en')
    if val not in LANGS: err(422,'Ngôn ngữ chỉ hỗ trợ vi, en, ja, zh-CN')
    return val
def content_language(d):
    value=d.get('language','en')
    if value not in CONTENT_LANGS:
        err(422,'Sách và lớp học chỉ hỗ trợ: en, ja, zh-CN')
    return value

def safe_data(request:Request):
    return request.json()

def current_user(request:Request, csrf=False):
    t=request.cookies.get('lx_session','')
    s=one('SELECT * FROM auth_sessions WHERE token_hash=? AND expires_at>?',(hash_token(t),now())) if t else None
    if not s: err(401,'Vui lòng đăng nhập')
    if csrf and not hmac.compare_digest(request.headers.get('x-csrf-token',''),s['csrf']): err(403,'CSRF token không hợp lệ')
    u=one('SELECT id,name,email,avatar,role FROM users WHERE id=?',(s['user_id'],))
    if not u: err(401,'Phiên không hợp lệ')
    return u,s

def session_for_owner(session_id, request, csrf=False):
    user,_=current_user(request,csrf)
    row=one('SELECT * FROM live_sessions WHERE id=? AND owner_id=?',(session_id,user['id']))
    if not row: err(404,'Không tìm thấy phiên thuộc tài khoản')
    return row

def book_owner(book_id,user_id):
    b=one('SELECT * FROM books WHERE id=? AND owner_id=?',(book_id,user_id))
    if not b: err(404,'Không tìm thấy sách thuộc tài khoản')
    return b

def lesson_owner(lesson_id,user_id):
    r=one('SELECT l.*, b.owner_id,b.language,b.title AS book_title FROM lessons l JOIN books b ON l.book_id=b.id WHERE l.id=? AND b.owner_id=?',(lesson_id,user_id))
    if not r: err(404,'Không tìm thấy bài thuộc tài khoản')
    return r

def word_owner(word_id,user_id):
    w=one('''SELECT w.*,l.book_id,b.owner_id FROM words w JOIN lessons l ON w.lesson_id=l.id
         JOIN books b ON b.id=l.book_id WHERE w.id=? AND b.owner_id=?''',(word_id,user_id))
    if not w: err(404,'Không tìm thấy thẻ thuộc tài khoản')
    return w

def class_owner(cid,user_id):
    c=one('SELECT * FROM classrooms WHERE id=? AND owner_id=?',(cid,user_id))
    if not c: err(404,'Không tìm thấy lớp thuộc tài khoản')
    return c

def public_session(pin='', token=''):
    s=one('SELECT * FROM live_sessions WHERE pin=?',(pin,)) if pin else one('SELECT * FROM live_sessions WHERE join_token=?',(token,))
    if not s or s['status'] in ('CANCELLED','CLOSED'): err(404,'Mã không hợp lệ hoặc phiên đã đóng')
    return s

def player_session(sid,token):
    if not token: err(401,'Thiếu mã xác thực người chơi')
    p=one('SELECT * FROM participants WHERE session_id=? AND token_hash=?',(sid,hash_token(token)))
    if not p or p['removed']: err(401,'Phiên người chơi không còn hợp lệ')
    return p

def cards_for_session(s): return json.loads(s['snapshot'])
def normalize_answer(s): return cleaned(s,200).casefold()

def normalize_for_language(s, lang):
    value=normalize_answer(s)
    if lang=='zh-CN':
        # Pinyin: one Latin keyboard; tolerate tone-mark and no-tone input.
        value=unicodedata.normalize('NFD',value.replace('ü','v')).replace('u\u0308','v')
        value=''.join(c for c in value if not unicodedata.combining(c))
        value=re.sub(r"[\s'’·-]",'',value)
    return value

def valid_alternative(value,lang):
    if lang=='ja':
        return bool(value) and all((0x3040<=ord(c)<=0x309F) or c in ' ー' for c in value)
    if lang=='zh-CN':
        chars=normalize_for_language(value,lang)
        return bool(chars) and chars.isascii() and chars.isalpha()
    return bool(value) and bool(re.fullmatch(r"[a-zA-Z\s'\-]+",value))

def build_cards(words, mode, lang):
    if mode not in MODES or lang not in CONTENT_LANGS:
        err(422,'Cấu hình chế độ hoặc ngôn ngữ không hợp lệ')
    result=[]
    for i,w in enumerate(words):
        term=cleaned(w['term']); meaning=cleaned(w['meaning'])
        pron=cleaned(w['pronunciation'])
        if lang in ('ja','zh-CN') and not pron:
            err(422,f'Từ "{term}" chưa có cách đọc ({"Hiragana" if lang=="ja" else "Pinyin"}). Vui lòng sửa dữ liệu trước khi tạo phòng.')
        if lang=='ja' and not valid_alternative(pron,'ja'):
            err(422,f'Từ "{term}": cách đọc phải nhập bằng Hiragana')
        if lang=='zh-CN' and not valid_alternative(pron,'zh-CN'):
            err(422,f'Từ "{term}": cách đọc phải nhập bằng Pinyin')
        answer=pron if lang in ('ja','zh-CN') else term
        label={'ja':'Nhật','zh-CN':'Trung','en':'Anh'}[lang]
        audio_lang={'ja':'ja-JP','zh-CN':'zh-CN','en':'en-US'}[lang]
        if lang=='en':
            parts=[
                ('spelling','en_mask_to_term','Nhập từ: '+term[:1]+' '+' '.join('_' for _ in term[1:])),
                ('spelling','en_meaning_to_term',meaning),
                ('reading','en_audio_target','🔊 Nghe tiếng Anh'),
                ('reading','en_audio_meaning','🔊 Nghe nghĩa tiếng Việt')]
        else:
            parts=[
                ('spelling',f'{lang}_term_to_pron',term),
                ('spelling',f'{lang}_meaning_to_pron',meaning),
                ('reading',f'{lang}_audio_target',f'🔊 Nghe tiếng {label}'),
                ('reading',f'{lang}_audio_meaning','🔊 Nghe nghĩa tiếng Việt')]
        subset=parts if mode=='mixed' else [x for x in parts if x[0]==mode]
        selected_mode,variant,prompt=subset[i%len(subset)]
        audio_text=None;tts_lang=None
        if selected_mode=='reading':
            is_meaning=variant.endswith('_meaning')
            audio_text=meaning if is_meaning else term
            tts_lang='vi-VN' if is_meaning else audio_lang
        alternatives=json.loads(w['alternatives'])
        accepted=[answer]+[x for x in alternatives if valid_alternative(x,lang)]
        result.append({'wordId':w['id'],'mode':selected_mode,'variant':variant,'language':lang,
           'prompt':prompt,'answer':answer,'audioText':audio_text,'audioLang':tts_lang,
           'term':term,'meaning':meaning,'pronunciation':pron,'accepted':accepted})
    return result

def ranks(sid):
    data=all_rows('''SELECT id,nickname,score,correct_count,latency_total FROM participants
                   WHERE session_id=? AND removed=0 ORDER BY score DESC,correct_count DESC,latency_total ASC,nickname ASC''',(sid,))
    for i,p in enumerate(data): p['rank']=i+1
    return data

def own_player_view(s,p):
    base={'id':s['id'],'status':s['status'],'phase':s['phase'],'title':s['title'],'pin':s['pin'],
          'index':s['question_index'],'count':len(cards_for_session(s)), 'durationMs':s['duration_ms'],
          'roundStarted':s['round_started'],'roundEnds':s['round_ends'], 'serverNow':now(),
          'pausedRemaining':s['pause_remaining'], 'locked':bool(s['locked'])}
    if 0<=s['question_index']<base['count']:
        c=cards_for_session(s)[s['question_index']]
        base['card']={'prompt':c['prompt'],'mode':c['mode'],'variant':c.get('variant'),
                      'language':c.get('language','en'),'audio':c['mode']=='reading',
                      'slotLengths':[len(part) for part in c['answer'].split(' ') if part][:25]}
        if s['phase']=='REVEAL' or s['status']=='RESULTS': base['card']['answer']=c['answer']
    if p:
        base['me']={'id':p['id'],'nickname':p['nickname'],'score':p['score'],'streak':p['streak'],
                    'correct':p['correct_count']}
        a=one('SELECT correct,points FROM answers WHERE participant_id=? AND round_index=?',(p['id'],s['question_index']))
        base['myAnswer']=a
        if s['status']=='RESULTS':
            standings=ranks(s['id']); me=next((x for x in standings if x['id']==p['id']),None)
            base['me']['rank']=me['rank'] if me else None
            base['me']['totalPlayers']=len(standings)
    if s['status']=='RESULTS': base['standings']=[{'nickname':r['nickname'],'score':r['score'],'rank':r['rank']} for r in ranks(s['id'])]
    return base

def host_view(s):
    base=own_player_view(s,None)
    base['host']=True
    base['joinToken']=s['join_token']
    base['roster']=all_rows('SELECT id,nickname,score,correct_count,removed FROM participants WHERE session_id=? ORDER BY joined_at ASC',(s['id'],))
    base['standings']=ranks(s['id'])
    base['responseCount']=one('SELECT COUNT(*) as n FROM answers WHERE session_id=? AND round_index=?',(s['id'],s['question_index']))['n']
    return base

class Hub:
    def __init__(self): self.rooms=defaultdict(dict)
    async def add(self,sid,ws,kind,player=None): self.rooms[sid][ws]=(kind,player)
    def discard(self,sid,ws): self.rooms[sid].pop(ws,None)
    async def broadcast(self,sid):
        s=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
        if not s: return
        for ws,(kind,pid) in list(self.rooms[sid].items()):
            try:
                p=one('SELECT * FROM participants WHERE id=? AND session_id=? AND removed=0',(pid,sid)) if kind=='player' else None
                if kind=='player' and not p:
                    await ws.close(code=4003);self.discard(sid,ws);continue
                view=host_view(s) if kind=='host' else own_player_view(s,p)
                await ws.send_json({'type':'STATE','state':view})
            except Exception: self.discard(sid,ws)
hub=Hub()
round_tasks={}
async def broadcast(sid): await hub.broadcast(sid)

def cancel_task(sid):
    t=round_tasks.pop(sid,None)
    if t and t is not asyncio.current_task(): t.cancel()

async def next_round(sid):
    s=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
    if not s or s['status']!='LIVE': return
    idx=s['question_index']+1
    if idx>=len(cards_for_session(s)):
        await finish(sid); return
    stamp=now()
    with connect() as db:
        db.execute('''UPDATE live_sessions SET question_index=?,phase='OPEN',round_started=?,round_ends=?,pause_remaining=0
            WHERE id=? AND status='LIVE' ''',(idx,stamp,stamp+s['duration_ms'],sid))
    await broadcast(sid)
    cancel_task(sid)
    round_tasks[sid]=asyncio.create_task(round_loop(sid))

async def round_loop(sid):
    try:
        s=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
        if not s or s['status']!='LIVE' or s['phase']!='OPEN': return
        await asyncio.sleep(max(0,(s['round_ends']-now())/1000))
        fresh=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
        if not fresh or fresh['status']!='LIVE' or fresh['phase']!='OPEN':return
        with connect() as db: db.execute("UPDATE live_sessions SET phase='REVEAL' WHERE id=? AND status='LIVE' AND phase='OPEN'",(sid,))
        await broadcast(sid)
        await asyncio.sleep(2.5)
        await next_round(sid)
    except asyncio.CancelledError: return

async def finish(sid):
    cancel_task(sid)
    s=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
    if not s or s['status'] in ('CLOSED','CANCELLED','RESULTS'): return
    scores=ranks(sid)
    answers=all_rows('''SELECT a.*,p.nickname FROM answers a JOIN participants p ON p.id=a.participant_id
                        WHERE a.session_id=? ORDER BY a.round_index,a.submitted_at''',(sid,))
    cards=cards_for_session(s)
    per=[]
    for i,c in enumerate(cards):
        a=[r for r in answers if r['round_index']==i]
        per.append({'index':i+1,'term':c['term'],'mode':c['mode'],'correct':sum(bool(r['correct']) for r in a),
                    'wrong':sum(not bool(r['correct']) for r in a),'responseCount':len(a),
                    'accuracyPct':round(100*sum(bool(r['correct']) for r in a)/len(a),1) if a else 0})
    body={'sessionId':sid,'title':s['title'],'createdAt':s['created_at'],'startedAt':s['started_at'],
          'finishedAt':now(),'participants':scores,'rounds':per,'answers':answers,'snapshot':cards}
    with connect() as db:
        db.execute('UPDATE live_sessions SET status=?,phase=?,ended_at=? WHERE id=?',('RESULTS','DONE',now(),sid))
        db.execute('INSERT OR REPLACE INTO reports(session_id,body,generated_at) VALUES(?,?,?)',(sid,json.dumps(body,ensure_ascii=False),now()))
    await broadcast(sid)

@asynccontextmanager
async def lifespan(app):
    init_db()
    # Restore the integrity of persisted games after process restart (no worker-local phantom timer).
    with connect() as db:
        for s in db.execute("SELECT id,round_ends FROM live_sessions WHERE status='LIVE'").fetchall():
            remaining=max(0,s['round_ends']-now())
            db.execute("UPDATE live_sessions SET status='PAUSED',pause_remaining=? WHERE id=?",(remaining,s['id']))
    yield
    for sid in list(round_tasks): cancel_task(sid)

app=FastAPI(title='LexiVerse API',lifespan=lifespan)
app.mount('/static',StaticFiles(directory=ROOT/'static'),name='static')

@app.middleware('http')
async def security_headers(req:Request,call_next):
    # JSON mutations require application/json; cookies protected by CSRF header.
    response=await call_next(req)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['X-Frame-Options']='SAMEORIGIN'
    response.headers['Referrer-Policy']='strict-origin-when-cross-origin'
    response.headers['Cache-Control']='no-store' if req.url.path.startswith('/api/') else 'no-cache'
    return response

@app.get('/')
@app.get('/join/{token}')
@app.get('/host/{sid}')
@app.get('/class/{token}')
@app.get('/app')
@app.get('/app/{path:path}')
def index(): return FileResponse(ROOT/'static'/'index.html')

@app.get('/api/config')
def config(): return {'googleClientId':GOOGLE_CLIENT_ID,'demoLogin':DEV_LOGIN}

@app.post('/api/auth/google')
async def auth_google(req:Request):
    data=await req.json(); credential=data.get('credential','')
    if not GOOGLE_CLIENT_ID: err(503,'Chưa cấu hình GOOGLE_CLIENT_ID')
    try:
        # Google publishes rotating RSA public keys. Signature, issuer and audience are checked.
        jwk=PyJWKClient('https://www.googleapis.com/oauth2/v3/certs').get_signing_key_from_jwt(credential)
        identity=jwt.decode(credential,jwk.key,algorithms=['RS256'],audience=GOOGLE_CLIENT_ID,
                            issuer=['https://accounts.google.com','accounts.google.com'],leeway=30)
        if not identity.get('email_verified',False): err(403,'Email Google chưa xác minh')
    except HTTPException: raise
    except Exception: err(401,'Google ID token không hợp lệ')
    sub=identity.get('sub');
    if not sub: err(401,'Không có Google subject')
    user=one('SELECT * FROM users WHERE google_sub=?',(sub,))
    if not user:
        user={'id':uid(),'name':cleaned(identity.get('name') or 'Giáo viên'), 'email':identity.get('email'),
              'avatar':identity.get('picture','')}
        with connect() as db:
            db.execute('INSERT INTO users(id,google_sub,email,name,avatar,role,created_at) VALUES(?,?,?,?,?,?,?)',
                       (user['id'],sub,user['email'],user['name'],user['avatar'],'teacher',now()))
    return create_session_response(user['id'])

def create_session_response(user_id):
    token=secrets.token_urlsafe(32); csrf=secrets.token_urlsafe(24)
    with connect() as db:
        db.execute('INSERT INTO auth_sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)',
                   (hash_token(token),user_id,csrf,now()+SESSION_TTL*1000))
    response=JSONResponse({'ok':True})
    response.set_cookie('lx_session',token,httponly=True,secure=(ENV=='production' or os.getenv('COOKIE_SECURE')=='true'),
                        samesite='lax',max_age=SESSION_TTL,path='/')
    return response

@app.post('/api/auth/demo')
async def demo_login(req:Request):
    peer=(req.client.host if req.client else '')
    if not DEV_LOGIN or peer not in ('127.0.0.1','::1','localhost','testclient') or req.url.hostname not in ('127.0.0.1','localhost','testserver'): err(404,'Demo login bị tắt')
    sub='local-demo-teacher';u=one('SELECT * FROM users WHERE google_sub=?',(sub,))
    if not u:
        u={'id':uid()}
        with connect() as db:
            db.execute('INSERT INTO users(id,google_sub,email,name,role,created_at) VALUES(?,?,?,?,?,?)',
                       (u['id'],sub,'demo@localhost','Giáo viên Demo','teacher',now()))
    return create_session_response(u['id'])

@app.get('/api/me')
def me(req:Request):
    u,s=current_user(req)
    return {**u,'csrf':s['csrf']}

@app.post('/api/auth/logout')
def logout(req:Request):
    u,s=current_user(req,True)
    with connect() as db: db.execute('DELETE FROM auth_sessions WHERE token_hash=?',(s['token_hash'],))
    response=JSONResponse({'ok':True});response.delete_cookie('lx_session');return response

@app.get('/api/books')
def books(req:Request):
    u,_=current_user(req)
    return all_rows('''SELECT b.*,COUNT(DISTINCT l.id) AS lessonCount,COUNT(DISTINCT w.id) AS wordCount
        FROM books b LEFT JOIN lessons l ON l.book_id=b.id LEFT JOIN words w ON w.lesson_id=l.id
        WHERE b.owner_id=? GROUP BY b.id ORDER BY b.updated_at DESC''',(u['id'],))

@app.post('/api/books')
async def create_book(req:Request):
    u,_=current_user(req,True);d=await req.json();bid=uid();stamp=now()
    title=required(d,'title',120);lang=content_language(d)
    with connect() as db:
        db.execute('INSERT INTO books(id,owner_id,title,language,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                   (bid,u['id'],title,lang,cleaned(d.get('description'),500),stamp,stamp))
    return {'id':bid}

@app.patch('/api/books/{bid}')
async def update_book(bid:str,req:Request):
    u,_=current_user(req,True);book_owner(bid,u['id']);d=await req.json()
    with connect() as db:
        db.execute('UPDATE books SET title=?,language=?,description=?,updated_at=? WHERE id=?',
                   (required(d,'title',120),content_language(d),cleaned(d.get('description'),500),now(),bid))
    return {'ok':True}

@app.delete('/api/books/{bid}')
def delete_book(bid:str,req:Request):
    u,_=current_user(req,True);book_owner(bid,u['id'])
    with connect() as db:db.execute('DELETE FROM books WHERE id=?',(bid,))
    return {'ok':True}

@app.get('/api/books/{bid}/lessons')
def lessons(bid:str,req:Request):
    u,_=current_user(req);book_owner(bid,u['id'])
    return all_rows('''SELECT l.*,COUNT(w.id) AS wordCount FROM lessons l LEFT JOIN words w ON w.lesson_id=l.id
                     WHERE l.book_id=? GROUP BY l.id ORDER BY l.sort_order,l.created_at''',(bid,))

@app.post('/api/books/{bid}/lessons')
async def create_lesson(bid:str,req:Request):
    u,_=current_user(req,True);book_owner(bid,u['id']);d=await req.json();lid=uid()
    with connect() as db:
        db.execute('INSERT INTO lessons(id,book_id,title,description,sort_order,created_at) VALUES(?,?,?,?,?,?)',
                   (lid,bid,required(d,'title',120),cleaned(d.get('description'),500),int(d.get('sort_order',0)),now()))
    return {'id':lid}

@app.patch('/api/lessons/{lid}')
async def update_lesson(lid:str,req:Request):
    u,_=current_user(req,True);lesson_owner(lid,u['id']);d=await req.json()
    with connect() as db:db.execute('UPDATE lessons SET title=?,description=?,sort_order=? WHERE id=?',
       (required(d,'title',120),cleaned(d.get('description'),500),int(d.get('sort_order',0)),lid))
    return {'ok':True}

@app.delete('/api/lessons/{lid}')
def delete_lesson(lid:str,req:Request):
    u,_=current_user(req,True);lesson_owner(lid,u['id'])
    with connect() as db:db.execute('DELETE FROM lessons WHERE id=?',(lid,))
    return {'ok':True}

@app.get('/api/practice/lessons/{lid}/cards')
def practice_cards(lid:str,req:Request,mode:str='mixed'):
    """Private solo-practice deck assembled from an owned lesson.

    This endpoint is for the authenticated content owner only; never expose
    this answer-bearing payload through public LIVE game routes.
    """
    user,_=current_user(req)
    lesson=lesson_owner(lid,user['id'])
    if mode not in MODES:err(422,'Chế độ thẻ không hợp lệ')
    words=all_rows('SELECT * FROM words WHERE lesson_id=? ORDER BY sort_order,rowid',(lid,))
    if not words:err(422,'Bài học chưa có từ vựng để luyện tập')
    cards=build_cards(words,mode,lesson['language'])
    return {'lessonId':lid,'mode':mode,'language':lesson['language'],
            'bookTitle':lesson['book_title'],'lessonTitle':lesson['title'],
            'cards':cards,'count':len(cards)}

@app.get('/api/lessons/{lid}/words')
def words(lid:str,req:Request):
    u,_=current_user(req);lesson_owner(lid,u['id'])
    rows=all_rows('SELECT * FROM words WHERE lesson_id=? ORDER BY sort_order,rowid',(lid,))
    for r in rows:r['alternatives']=json.loads(r['alternatives'])
    return rows

def vocab_data(d):
    term=required(d,'term',120);meaning=required(d,'meaning',240)
    alt=d.get('alternatives',[])
    if isinstance(alt,str):alt=re.split(r'[,;\n]',alt)
    if not isinstance(alt,list) or len(alt)>15:err(422,'Tối đa 15 đáp án thay thế')
    alt=[cleaned(x,120) for x in alt if cleaned(x,120)]
    return (term,meaning,cleaned(d.get('pronunciation'),120),json.dumps(alt,ensure_ascii=False),int(d.get('sort_order',0)))

@app.post('/api/lessons/{lid}/words')
async def create_word(lid:str,req:Request):
    u,_=current_user(req,True);lesson_owner(lid,u['id']);d=await req.json();wid=uid()
    with connect() as db:
        db.execute('INSERT INTO words(id,lesson_id,term,meaning,pronunciation,alternatives,sort_order) VALUES(?,?,?,?,?,?,?)',
                   (wid,lid,*vocab_data(d)))
    return {'id':wid}

@app.patch('/api/words/{wid}')
async def update_word(wid:str,req:Request):
    u,_=current_user(req,True);word_owner(wid,u['id']);d=await req.json()
    with connect() as db:
        db.execute('UPDATE words SET term=?,meaning=?,pronunciation=?,alternatives=?,sort_order=? WHERE id=?',(*vocab_data(d),wid))
    return {'ok':True}

@app.delete('/api/words/{wid}')
def delete_word(wid:str,req:Request):
    u,_=current_user(req,True);word_owner(wid,u['id'])
    with connect() as db:db.execute('DELETE FROM words WHERE id=?',(wid,))
    return {'ok':True}

# CSV templates are UTF-8 BOM to open cleanly in Excel on Windows.
TEMPLATE_COLUMNS=['term','meaning','pronunciation','alternatives','sort_order']

@app.get('/api/lessons/{lid}/words/template')
def download_words_template(lid:str,req:Request):
    u,_=current_user(req)
    lesson=lesson_owner(lid,u['id'])
    example={
        'ja':['図書館','thư viện','としょかん','',1],
        'zh-CN':['图书馆','thư viện','tú shū guǎn','tu shu guan',1],
        'en':['library','thư viện','/ˈlaɪbrəri/','',1]
    }[lesson['language']]
    out=io.StringIO(newline='')
    writer=csv.writer(out)
    writer.writerow(TEMPLATE_COLUMNS)
    writer.writerow(example)
    # BOM: consistent Vietnamese/Japanese/Chinese display in Excel.
    content='\ufeff'+out.getvalue()
    headers={'Content-Disposition':f'attachment; filename="lexiverse-template-{lesson["language"]}.csv"',
             'Cache-Control':'no-store'}
    return Response(content.encode('utf-8'),media_type='text/csv; charset=utf-8',headers=headers)

@app.post('/api/lessons/{lid}/words/import')
async def import_words_csv(lid:str,req:Request,file:UploadFile=File(...)):
    u,_=current_user(req,True)
    lesson=lesson_owner(lid,u['id'])
    if not file.filename or not file.filename.lower().endswith('.csv'):
        err(422,'Hãy chọn file CSV đúng template')
    if file.content_type and file.content_type not in ('text/csv','application/vnd.ms-excel',
           'application/octet-stream','text/plain','application/csv'):
        err(422,'Loại file không hợp lệ')
    raw=await file.read(BULK_LIMIT_BYTES+1)
    if len(raw)>BULK_LIMIT_BYTES:err(413,'File CSV phải không quá 2 MB')
    try:
        content=raw.decode('utf-8-sig')
    except UnicodeDecodeError:err(422,'File CSV phải được lưu bằng UTF-8')
    try:
        reader=csv.DictReader(io.StringIO(content,newline=''),strict=True)
        if not reader.fieldnames or reader.fieldnames!=TEMPLATE_COLUMNS:
            err(422,'Cột template phải đúng thứ tự: '+', '.join(TEMPLATE_COLUMNS))
        rows=list(reader)
    except csv.Error:err(422,'CSV không đúng định dạng (kiểm tra dấu phẩy/dấu nháy)')
    if not rows:err(422,'File CSV chưa có từ vựng')
    if len(rows)>BULK_MAX_ROWS:err(422,'Mỗi lần nhập tối đa 1.000 dòng')
    seen={normalize_answer(r['term']) for r in all_rows('SELECT term FROM words WHERE lesson_id=?',(lid,))}
    prepared=[];errors=[];skipped=0
    for line,row in enumerate(rows,2):
        if None in row or any(v is None for v in row.values()):
            skipped+=1;errors.append({'line':line,'reason':'Số cột không đúng'});continue
        if not any((v or '').strip() for v in row.values()):continue
        try:
            record=vocab_data(row)
            norm=normalize_answer(record[0])
            if norm in seen:
                skipped+=1;errors.append({'line':line,'reason':'Từ bị trùng trong bài học'});continue
            if lesson['language'] in ('ja','zh-CN') and not record[2]:
                raise ValueError('Bắt buộc nhập Hiragana/Pinyin ở cột pronunciation')
            if lesson['language'] in ('ja','zh-CN') and not valid_alternative(record[2],lesson['language']):
                raise ValueError('Cách đọc không đúng bảng chữ cái Hiragana/Pinyin')
            seen.add(norm)
            prepared.append((uid(),lid,*record))
        except (HTTPException,ValueError,TypeError) as ex:
            skipped+=1
            reason=ex.detail if isinstance(ex,HTTPException) else str(ex)
            errors.append({'line':line,'reason':reason})
    with connect() as db:
        db.executemany("INSERT INTO words(id,lesson_id,term,meaning,pronunciation,alternatives,sort_order) VALUES(?,?,?,?,?,?,?)",prepared)
        if prepared:db.execute('UPDATE books SET updated_at=? WHERE id=?',(now(),lesson['book_id']))
    return {'ok':True,'added':len(prepared),'skipped':skipped,'errors':errors[:20],
            'message':'Đã nhập dữ liệu; các dòng không hợp lệ/trùng được bỏ qua'}

@app.post('/api/import/legacy')
async def import_legacy(req:Request):
    u,_=current_user(req,True);d=await req.json()
    sets=d.get('sets');items=d.get('items');
    if not isinstance(sets,list) or not isinstance(items,list) or len(sets)>100 or len(items)>10000:
        err(422,'Dữ liệu cũ phải gồm sets (<=100) và items (<=10000)')
    added={'books':0,'lessons':0,'words':0,'skipped':0};seen=set();mapping={};stamp=now()
    with connect() as db:
        for st in sets:
            if not isinstance(st,dict) or st.get('languageCode') not in CONTENT_LANGS or not cleaned(st.get('name')):
                added['skipped']+=1;continue
            old=str(st.get('id',''))
            if not old or old in seen: added['skipped']+=1;continue
            seen.add(old);bid=uid();lid=uid();mapping[old]=lid
            db.execute('INSERT INTO books VALUES(?,?,?,?,?,?,?)',
                       (bid,u['id'],cleaned(st['name'],120),st['languageCode'],cleaned(st.get('description'),500),stamp,stamp))
            db.execute('INSERT INTO lessons VALUES(?,?,?,?,?,?)',(lid,bid,'Bài 1 – dữ liệu nhập từ bộ từ cũ','',0,stamp))
            added['books']+=1;added['lessons']+=1
        for it in items:
            if not isinstance(it,dict) or str(it.get('setId','')) not in mapping or not cleaned(it.get('term')) or not cleaned(it.get('meaning')):
                added['skipped']+=1;continue
            try: record=vocab_data({**it,'alternatives':it.get('acceptedAnswers',[])})
            except HTTPException:added['skipped']+=1;continue
            db.execute('INSERT INTO words VALUES(?,?,?,?,?,?,?)',(uid(),mapping[str(it['setId'])],*record))
            added['words']+=1
    return added

@app.get('/api/classes')
def classes(req:Request):
    u,_=current_user(req)
    return all_rows('''SELECT c.*,COUNT(m.id) AS memberCount FROM classrooms c
                     LEFT JOIN class_members m ON m.class_id=c.id AND m.status='ACTIVE'
                     WHERE c.owner_id=? GROUP BY c.id ORDER BY c.created_at DESC''',(u['id'],))

def code_class(): return secrets.token_urlsafe(9).replace('-','A').replace('_','B')

@app.post('/api/classes')
async def create_class(req:Request):
    u,_=current_user(req,True);d=await req.json();cid=uid()
    with connect() as db:db.execute('INSERT INTO classrooms(id,owner_id,name,language,description,invite_code,created_at) VALUES(?,?,?,?,?,?,?)',
      (cid,u['id'],required(d,'name',80,3),content_language(d),cleaned(d.get('description'),500),code_class(),now()))
    return {'id':cid}

@app.patch('/api/classes/{cid}')
async def update_class(cid:str,req:Request):
    u,_=current_user(req,True);c=class_owner(cid,u['id']);d=await req.json()
    status=d.get('status','ACTIVE')
    if status not in ('ACTIVE','ARCHIVED'):err(422,'Trạng thái không hợp lệ')
    with connect() as db:db.execute('UPDATE classrooms SET name=?,language=?,description=?,status=? WHERE id=?',
      (required(d,'name',80,3),content_language(d),cleaned(d.get('description'),500),status,cid))
    return {'ok':True}

@app.delete('/api/classes/{cid}')
def delete_class(cid:str,req:Request):
    u,_=current_user(req,True);class_owner(cid,u['id'])
    with connect() as db:db.execute('DELETE FROM classrooms WHERE id=?',(cid,))
    return {'ok':True}

@app.post('/api/classes/{cid}/reset-invite')
def reset_invite(cid:str,req:Request):
    u,_=current_user(req,True);class_owner(cid,u['id']);code=code_class()
    with connect() as db:db.execute('UPDATE classrooms SET invite_code=? WHERE id=?',(code,cid))
    return {'invite_code':code}

@app.get('/api/classes/{cid}/qr')
def class_qr(cid:str,req:Request):
    c=class_owner(cid,current_user(req)[0]['id'])
    origin=os.getenv('PUBLIC_URL','').rstrip('/') or str(req.base_url).rstrip('/')
    url=f"{origin}/class/{quote(c['invite_code'])}"
    buf=io.BytesIO();qrcode.make(url,box_size=7,border=2).save(buf,format='PNG');buf.seek(0)
    return StreamingResponse(buf,media_type='image/png')

@app.get('/api/classes/{cid}/members')
def class_members(cid:str,req:Request):
    u,_=current_user(req);class_owner(cid,u['id'])
    return all_rows('SELECT * FROM class_members WHERE class_id=? ORDER BY joined_at DESC',(cid,))

@app.delete('/api/classes/{cid}/members/{mid}')
def remove_member(cid:str,mid:str,req:Request):
    u,_=current_user(req,True);class_owner(cid,u['id'])
    with connect() as db:db.execute("UPDATE class_members SET status='REMOVED' WHERE id=? AND class_id=?",(mid,cid))
    return {'ok':True}

@app.get('/api/classes/invite/{token}')
def class_info(token:str):
    c=one('SELECT id,name,language,status FROM classrooms WHERE invite_code=?',(token,))
    if not c or c['status']!='ACTIVE':err(404,'Mã lớp đã hết hiệu lực')
    return c

@app.post('/api/classes/invite/{token}/join')
async def join_class(token:str,req:Request):
    c=class_info(token);d=await req.json();nickname=required(d,'nickname',20,2)
    if '<' in nickname or '>' in nickname or any(ord(ch)<32 for ch in nickname):err(422,'Tên có ký tự không hợp lệ')
    if one("SELECT id FROM class_members WHERE class_id=? AND nickname=? AND status='ACTIVE'",(c['id'],nickname)):
        err(409,'Tên này đã được sử dụng trong lớp')
    with connect() as db:
        db.execute('''INSERT INTO class_members(id,class_id,nickname,joined_at,status) VALUES(?,?,?,?,?)
                      ON CONFLICT(class_id,nickname) DO UPDATE SET status='ACTIVE',joined_at=excluded.joined_at''',
                   (uid(),c['id'],nickname,now(),'ACTIVE'))
    return {'ok':True,'className':c['name']}

@app.get('/api/sessions')
def sessions(req:Request):
    u,_=current_user(req)
    return all_rows('''SELECT s.id,s.title,s.pin,s.status,s.created_at,s.started_at,s.ended_at,s.class_id,
                     COUNT(p.id) AS playerCount FROM live_sessions s
                     LEFT JOIN participants p ON p.session_id=s.id AND p.removed=0
                     WHERE s.owner_id=? GROUP BY s.id ORDER BY s.created_at DESC''',(u['id'],))

@app.post('/api/sessions')
async def create_live_session(req:Request):
    u,_=current_user(req,True);d=await req.json();lid=str(d.get('lessonId',''))
    lesson=lesson_owner(lid,u['id'])
    words=all_rows('SELECT * FROM words WHERE lesson_id=? ORDER BY sort_order,rowid',(lid,))
    if not words:err(422,'Bài học chưa có từ hợp lệ')
    mode=d.get('mode','mixed');speed=d.get('speed','normal')
    if mode not in MODES or speed not in SPEEDS:err(422,'Chế độ hoặc tốc độ không hợp lệ')
    cid=d.get('classId') or None
    if cid:class_owner(cid,u['id'])
    try:
        raw_count=d.get('count',len(words))
        if isinstance(raw_count,bool) or str(raw_count).strip()!=str(int(raw_count)):
            raise ValueError()
        count=int(raw_count)
    except (TypeError,ValueError,OverflowError):
        err(422,'Số từ phải là số nguyên hợp lệ')
    if not 1<=count<=len(words):err(422,f'Số từ phải nằm trong khoảng 1 đến {len(words)}')
    if d.get('shuffle'):secrets.SystemRandom().shuffle(words)
    cards=build_cards(words[:count],mode,lesson['language']);sid=uid();pin=''
    for _ in range(20):
        pin=str(secrets.randbelow(900000)+100000)
        if not one('SELECT id FROM live_sessions WHERE pin=?',(pin,)):break
    else:err(503,'Không tạo được PIN mới')
    with connect() as db:
        db.execute('''INSERT INTO live_sessions(id,owner_id,lesson_id,class_id,title,pin,join_token,
            mode,speed,duration_ms,snapshot,created_at,allow_late) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (sid,u['id'],lid,cid,cleaned(d.get('title') or lesson['title'],120),pin,secrets.token_urlsafe(20),
             mode,speed,SPEEDS[speed],json.dumps(cards,ensure_ascii=False),now(),int(bool(d.get('allowLate',False)))))
    return {'id':sid,'pin':pin}

@app.get('/api/sessions/{sid}')
def session_info(sid:str,req:Request): return host_view(session_for_owner(sid,req))

@app.get('/api/sessions/{sid}/qr')
def qr(sid:str,req:Request):
    s=session_for_owner(sid,req)
    origin=os.getenv('PUBLIC_URL','').rstrip('/') or str(req.base_url).rstrip('/')
    url=f"{origin}/join/{quote(s['join_token'])}"
    buf=io.BytesIO();qrcode.make(url,box_size=8,border=2).save(buf,format='PNG');buf.seek(0)
    return StreamingResponse(buf,media_type='image/png')

@app.post('/api/sessions/{sid}/lock')
async def lock(sid:str,req:Request):
    s=session_for_owner(sid,req,True);d=await req.json()
    if s['status'] not in ('LOBBY','LIVE','PAUSED'):err(409,'Phiên đã đóng')
    with connect() as db:db.execute('UPDATE live_sessions SET locked=? WHERE id=?',(int(bool(d.get('locked'))),sid))
    await broadcast(sid);return {'ok':True}

@app.post('/api/sessions/{sid}/kick/{pid}')
async def kick(sid:str,pid:str,req:Request):
    session_for_owner(sid,req,True)
    with connect() as db:db.execute('UPDATE participants SET removed=1 WHERE id=? AND session_id=?',(pid,sid))
    await broadcast(sid);return {'ok':True}

@app.post('/api/sessions/{sid}/start')
async def start(sid:str,req:Request):
    s=session_for_owner(sid,req,True)
    if s['status']!='LOBBY':err(409,'Phiên không ở sảnh chờ')
    if not one('SELECT id FROM participants WHERE session_id=? AND removed=0',(sid,)):err(422,'Cần ít nhất một người chơi')
    with connect() as db:db.execute("UPDATE live_sessions SET status='LIVE',started_at=? WHERE id=?",(now(),sid))
    await next_round(sid);return {'ok':True}

@app.post('/api/sessions/{sid}/pause')
async def pause(sid:str,req:Request):
    s=session_for_owner(sid,req,True)
    if s['status']!='LIVE':err(409,'Phiên chưa LIVE')
    rem=max(0,s['round_ends']-now()) if s['phase']=='OPEN' else 0
    cancel_task(sid)
    with connect() as db:db.execute("UPDATE live_sessions SET status='PAUSED',pause_remaining=? WHERE id=?",(rem,sid))
    await broadcast(sid);return {'ok':True}

@app.post('/api/sessions/{sid}/resume')
async def resume(sid:str,req:Request):
    s=session_for_owner(sid,req,True)
    if s['status']!='PAUSED':err(409,'Phiên chưa PAUSED')
    if s['phase']=='REVEAL':
        with connect() as db:db.execute("UPDATE live_sessions SET status='LIVE' WHERE id=?",(sid,))
        await next_round(sid)
    else:
        start_at=now()-(s['duration_ms']-s['pause_remaining'])
        end_at=now()+s['pause_remaining']
        with connect() as db:db.execute("UPDATE live_sessions SET status='LIVE',round_started=?,round_ends=? WHERE id=?",(start_at,end_at,sid))
        cancel_task(sid);round_tasks[sid]=asyncio.create_task(round_loop(sid))
        await broadcast(sid)
    return {'ok':True}

@app.post('/api/sessions/{sid}/end')
async def end(sid:str,req:Request):
    s=session_for_owner(sid,req,True)
    if s['status']=='LOBBY':
        with connect() as db:db.execute("UPDATE live_sessions SET status='CANCELLED',ended_at=? WHERE id=?",(now(),sid))
        await broadcast(sid)
    elif s['status'] in ('LIVE','PAUSED'):await finish(sid)
    else:err(409,'Phiên đã kết thúc')
    return {'ok':True}

@app.get('/api/sessions/{sid}/report')
def report(sid:str,req:Request):
    session_for_owner(sid,req)
    row=one('SELECT body FROM reports WHERE session_id=?',(sid,))
    if not row:err(404,'Chưa có báo cáo')
    return json.loads(row['body'])

@app.get('/api/sessions/{sid}/report.csv')
def report_csv(sid:str,req:Request):
    r=report(sid,req);buf=io.StringIO();w=csv.writer(buf)
    w.writerow(['Hạng','Biệt danh','Tổng điểm','Số đúng','Tổng phản hồi (ms)'])
    for p in r['participants']: w.writerow([p['rank'],p['nickname'],p['score'],p['correct_count'],p['latency_total']])
    output=io.BytesIO(('\ufeff'+buf.getvalue()).encode('utf-8'))
    return StreamingResponse(output,media_type='text/csv; charset=utf-8',headers={'Content-Disposition':f'attachment; filename="lexiverse-{sid[:8]}.csv"'})

@app.get('/api/public/session')
def public_lookup(req:Request,pin:str='',token:str=''):
    throttle(req.client.host if req.client else 'unknown','pin-lookup',60)
    s=public_session(pin,token)
    return {'id':s['id'],'title':s['title'],'status':s['status'],'locked':bool(s['locked']),
            'pin':s['pin'],'joinToken':s['join_token'],'count':len(cards_for_session(s))}

join_attempts=defaultdict(list)
def throttle(ip, key,limit=20,seconds=60):
    # Protect in-process demo service; production should use central rate limiter.
    k=(ip,key);ts=time.time();join_attempts[k]=[x for x in join_attempts[k] if ts-x<seconds]
    if len(join_attempts[k])>=limit:err(429,'Thao tác quá nhanh, thử lại sau')
    join_attempts[k].append(ts)

@app.post('/api/public/join')
async def join_session(req:Request):
    d=await req.json();throttle(req.client.host if req.client else 'unknown','join',15)
    s=public_session(str(d.get('pin','')),str(d.get('token','')))
    if s['locked']:err(409,'Phòng đã khóa tham gia')
    if s['status']!='LOBBY' and not (s['status'] in ('LIVE','PAUSED') and s['allow_late']):err(409,'Phiên không cho tham gia lúc này')
    nick=required(d,'nickname',20,2)
    if '<' in nick or '>' in nick or any(ord(c)<32 for c in nick):err(422,'Tên không chứa ký tự điều khiển hoặc HTML')
    if one('SELECT id FROM participants WHERE session_id=? AND nickname=?',(s['id'],nick)):err(409,'Biệt danh đã có trong phòng, hãy chọn tên khác')
    if one('SELECT COUNT(*) AS n FROM participants WHERE session_id=? AND removed=0',(s['id'],))['n']>=MAX_PLAYERS:err(409,'Phòng đã đầy')
    pt=secrets.token_urlsafe(32);pid=uid()
    with connect() as db:
        db.execute('INSERT INTO participants(id,session_id,nickname,token_hash,joined_at) VALUES(?,?,?,?,?)',
                   (pid,s['id'],nick,hash_token(pt),now()))
    await broadcast(s['id'])
    return {'sessionId':s['id'],'playerToken':pt,'participantId':pid}

@app.get('/api/play/{sid}/state')
def player_state(sid:str,req:Request):
    p=player_session(sid,req.headers.get('x-player-token',''))
    s=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
    if not s:err(404,'Không tìm thấy phiên')
    return own_player_view(s,p)

answer_throttle=defaultdict(list)
@app.post('/api/play/{sid}/answer')
async def submit_answer(sid:str,req:Request):
    token=req.headers.get('x-player-token','');p=player_session(sid,token)
    throttle(p['id'],'answer',24,60)
    d=await req.json();answer=cleaned(d.get('answer'),200)
    s=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
    if not s or s['status']!='LIVE' or s['phase']!='OPEN' or now()>s['round_ends']:err(409,'Lượt trả lời đã đóng hoặc tạm dừng')
    index=s['question_index']
    if d.get('roundIndex')!=index:err(409,'Lượt chơi đã thay đổi, cập nhật lại màn hình')
    c=cards_for_session(s)[index]
    ok=normalize_for_language(answer,c.get('language','en')) in {normalize_for_language(x,c.get('language','en')) for x in c['accepted']}
    latency=max(0,min(s['duration_ms'],now()-s['round_started']))
    base=round(1000-900*latency/s['duration_ms']) if ok else 0
    points=round(base*(1+min(p['streak'],5)*0.1)) if ok else 0
    aid=uid()
    # Atomic idempotency under concurrent requests: insert unique once. No client score trusted.
    with connect() as db:
        insert=db.execute('''INSERT OR IGNORE INTO answers(id,session_id,participant_id,round_index,answer,correct,points,latency_ms,submitted_at)
                      VALUES(?,?,?,?,?,?,?,?,?)''',(aid,sid,p['id'],index,answer,int(ok),points,latency,now()))
        if not insert.rowcount:err(409,'Bạn đã trả lời lượt này')
        db.execute('''UPDATE participants SET score=score+?,streak=?,correct_count=correct_count+?,latency_total=latency_total+?
                      WHERE id=?''',(points,p['streak']+1 if ok else 0,int(ok),latency if ok else 0,p['id']))
    await broadcast(sid)
    return {'correct':ok,'points':points,'score':p['score']+points}

@app.get('/api/play/{sid}/audio')
def play_audio(sid:str,req:Request,roundIndex:int):
    """Retrieve an audio question as MP3 after player/host authentication.

    A cloud TTS network connection is needed for first-time generation. Cached
    audio is private and may be reused while on the local server.
    """
    session=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
    if not session:err(404,'Không tìm thấy phòng chơi')
    guest=req.headers.get('x-player-token','')
    if guest:player_session(sid,guest)
    else:session_for_owner(sid,req)
    if session['status']!='LIVE' or session['phase']!='OPEN' or roundIndex!=session['question_index']:
        err(409,'Lượt nghe đã đóng hoặc không còn hiệu lực')
    cards=cards_for_session(session)
    if not 0<=roundIndex<len(cards):err(404,'Không tìm thấy thẻ')
    c=cards[roundIndex]
    if c.get('mode')!='reading' or not c.get('audioText'):
        err(422,'Thẻ này không cần âm thanh')
    # Hash-only cache filenames. The readable text is never sent to the browser.
    lang=c['audioLang'];src=c['audioText']
    key=hashlib.sha256((lang+'\0'+src).encode('utf-8')).hexdigest()
    directory=ROOT/'data'/'tts';directory.mkdir(parents=True,exist_ok=True)
    filepath=directory/(key+'.mp3')
    # Avoid dozens of learners simultaneously generating the same clip.
    with tts_file_locks[key]:
        if not filepath.is_file():
            tmp=None
            try:
                from gtts import gTTS
                audio=io.BytesIO()
                gTTS(text=src,lang=TTS_LANGUAGE_CODES[lang],timeout=(4,8)).write_to_fp(audio)
                content=audio.getvalue()
                if len(content)<200:raise ValueError('Audio trống')
                tmp=directory/(key+'-'+secrets.token_hex(4)+'.tmp')
                tmp.write_bytes(content)
                os.replace(tmp,filepath)
            except Exception:
                if tmp is not None:tmp.unlink(missing_ok=True)
                err(503,'Không tạo được âm thanh. Kiểm tra Internet và nhấn nghe lại.')
    return FileResponse(filepath,media_type='audio/mpeg',headers={'Cache-Control':'private, max-age=3600'})

@app.websocket('/ws/sessions/{sid}')
async def socket_session(ws:WebSocket,sid:str):
    origin=ws.headers.get('origin','')
    host=ws.headers.get('host','')
    if origin and origin not in (f'http://{host}', f'https://{host}'):
        await ws.close(code=4003);return
    await ws.accept()
    try:
        hello=await asyncio.wait_for(ws.receive_json(),timeout=8)
        kind=hello.get('role');pid=None
        s=one('SELECT * FROM live_sessions WHERE id=?',(sid,))
        if not s:await ws.close(code=4004);return
        if kind=='host':
            raw=ws.cookies.get('lx_session','')
            auth=one('SELECT user_id FROM auth_sessions WHERE token_hash=? AND expires_at>?',(hash_token(raw),now())) if raw else None
            if not auth or auth['user_id']!=s['owner_id']:await ws.close(code=4003);return
        elif kind=='player':
            p=player_session(sid,hello.get('playerToken',''));pid=p['id']
        else:await ws.close(code=4003);return
        await hub.add(sid,ws,kind,pid)
        await hub.broadcast(sid)
        while True:
            msg=await ws.receive_json()
            if msg.get('type')=='PING':await ws.send_json({'type':'PONG','time':now()})
    except (WebSocketDisconnect, asyncio.TimeoutError,HTTPException):pass
    finally:hub.discard(sid,ws)
