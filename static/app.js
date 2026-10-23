/* LexiVerse responsive vanilla-JS UI. Security is enforced by server; hiding UI is not authorization. */
const $=(s,root=document)=>root.querySelector(s);
const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const langName={en:'🇬🇧 Tiếng Anh',ja:'🇯🇵 Tiếng Nhật','zh-CN':'🇨🇳 Tiếng Trung'};
const statusName={LOBBY:'Sảnh chờ',LIVE:'Đang chơi',PAUSED:'Tạm dừng',RESULTS:'Hoàn tất',CANCELLED:'Đã hủy'};
const flags={en:'🇬🇧',ja:'🇯🇵','zh-CN':'🇨🇳'};
const A={user:null,config:null,books:[],classes:[],sessions:[],activeBook:null,activeLesson:null,socket:null,poll:null,ticker:null,currentState:null,playerToken:null,host:false,sid:null,route:'',lastPlayerSig:null,reconnectTimer:null,lastAudioKey:null,practice:null,practiceTimer:null,postLogin:null,liveClock:null,lastHostSig:null,liveVisualRatio:0,kanaVisible:false};
const apiBase='/api';
function toast(msg,error=false){let t=$('#toast');t.className='toast'+(error?' error':'');t.textContent=msg;t.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.style.display='none',4000)}
function niceError(e){const m=e?.message||'Đã có lỗi, vui lòng thử lại';toast(m,true);return m}
async function api(path,method='GET',data=undefined,player=false){
 const headers={'Accept':'application/json'};
 if(data!==undefined)headers['Content-Type']='application/json';
 if(player){if(A.playerToken)headers['X-Player-Token']=A.playerToken;}
 else if(A.user&&method!=='GET')headers['X-CSRF-Token']=A.user.csrf;
 let res;try{res=await fetch(apiBase+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});}catch{throw Error('Không kết nối được máy chủ. Kiểm tra mạng và thử lại.');}
 let obj;try{obj=await res.json()}catch{obj={detail:'Máy chủ trả dữ liệu không hợp lệ'}};
 if(!res.ok)throw Error(typeof obj.detail==='string'?obj.detail:JSON.stringify(obj.detail||'Yêu cầu thất bại'));
 return obj;
}
const html=(str)=>{ $('#app').innerHTML=str;};
const action=(label,type='',id='',cls='btn',attrs='')=>`<button class="${cls}" data-action="${type}" data-id="${esc(id)}" ${attrs}>${label}</button>`;
const nav=(url,label,cls='btn')=>`<button class="${cls}" data-nav="${esc(url)}">${label}</button>`;
const badge=s=>`<span class="pill ${s==='LIVE'?'good':s==='LOBBY'?'blue':s==='PAUSED'?'warn':''}">${esc(statusName[s]||s)}</span>`;
const date=n=>n?new Date(n).toLocaleString('vi-VN'):'—';
function goto(url){stopPractice();disconnect();history.pushState({},'',url);render();window.scrollTo(0,0)}
window.addEventListener('popstate',()=>{stopPractice();disconnect();render()});
function disconnect(){if(A.socket){A.socket.onclose=null;A.socket.close();A.socket=null;}if(A.poll){clearInterval(A.poll);A.poll=null}if(A.ticker){cancelAnimationFrame(A.ticker);A.ticker=null}if(A.reconnectTimer)clearTimeout(A.reconnectTimer);A.currentState=null;A.lastPlayerSig=null;A.lastAudioKey=null;A.sid=null;A.liveClock=null;A.lastHostSig=null;A.kanaVisible=false;}
function modal(title,fields,submit){
 const root=$('#modal-root');root.innerHTML=`<div class="modalback" role="presentation"><div class="modalbox" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modalhead"><h2 id="dialog-title">${esc(title)}</h2><button class="closebtn" id="closeModal" aria-label="Đóng">×</button></div><form id="modalForm">${fields}<div class="modalfoot"><button type="button" class="btn ghost" id="cancelModal">Hủy</button><button type="submit" class="btn primary" id="saveModal">Lưu thay đổi</button></div></form></div></div>`;
 const close=()=>root.innerHTML='';$('#closeModal').onclick=$('#cancelModal').onclick=close;
 $('.modalback',root).addEventListener('click',ev=>{if(ev.target.classList.contains('modalback'))close()});
 $('#modalForm').onsubmit=async ev=>{ev.preventDefault();let b=$('#saveModal');b.disabled=true;try{let values=Object.fromEntries(new FormData(ev.currentTarget));let result=await submit(values);close();await render();toast(result?.notice||'Đã lưu thành công');}catch(e){niceError(e)}finally{b.disabled=false}};
 $('#modalForm input,#modalForm select')?.focus();
}
const field=(name,title,value='',required=true,type='text',max=120)=>`<label class="formrow"><span class="label">${esc(title)}${required?' *':''}</span><input class="field" name="${name}" type="${type}" value="${esc(value)}" maxlength="${max}" ${required?'required':''}></label>`;
const area=(name,title,value='')=>`<label class="formrow"><span class="label">${esc(title)}</span><textarea class="field" name="${name}">${esc(value)}</textarea></label>`;
const select=(name,title,values,current)=>`<label class="formrow"><span class="label">${esc(title)}</span><select class="field" name="${name}">${values.map(([k,v])=>`<option value="${esc(k)}" ${k===current?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
const langSelect=(lang='en')=>select('language','Ngôn ngữ học',Object.entries(langName),lang);
const empty=(icon,title,desc,btn='')=>`<div class="empty"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(desc)}</p>${btn}</div>`;
function homeHeader(){return `<div class="intro-nav"><div class="brandline"><div class="brandmark">✦</div> LexiVerse</div><div class="button-row">${nav('/','Trang chủ','btn ghost')}${A.user?nav('/app','Trang giáo viên','btn primary'):''}</div></div>`}
async function initialize(){try{A.config=await api('/config')}catch(e){A.config={googleClientId:'',demoLogin:false};niceError(e)}try{A.user=await api('/me')}catch{A.user=null}await render()}
function pathParts(){return location.pathname.split('/').filter(Boolean)}
async function render(){let p=pathParts();A.route=location.pathname;
 try{
  if(p[0]==='join')return await showJoin(p[1]||'');
  if(p[0]==='host')return await showHost(p[1]||'');
  if(p[0]==='class')return await showClassJoin(p[1]||'');
  if(p[0]==='app')return await showTeacher(p);
  return showLanding();
 }catch(e){html(`${homeHeader()}<main class="center-stage">${empty('⚠️','Không tải được trang',e.message,nav('/','Về trang chủ','btn primary'))}</main>`);niceError(e)}
}
function showLanding(){html(`<div class="landing">${homeHeader()}<section class="hero"><div><div class="eyebrow">✦ LEARN · PLAY · GROW</div><h1>Học từ vựng.<br><span class="gradient">Chơi hết mình.</span></h1><p>Biến mỗi tiết học thành một đấu trường ngôn ngữ. Tạo sách và bài học riêng, mời học sinh bằng QR/PIN, cùng thi đấu và theo dõi tiến bộ theo thời gian thực.</p><div class="button-row mt24">${A.user?nav('/app','Đi tới bảng điều khiển →','btn primary'):action('Bắt đầu với vai trò giáo viên →','login','','btn primary')}${action('🎮 Luyện tập cá nhân','practice-entry','','btn ghost')}</div><div class="joinpanel"><label for="pinInput">Bạn có mã PIN của giáo viên?</label><form id="pinForm" class="flex"><input id="pinInput" class="field" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="Nhập mã 6 chữ số" required aria-label="Mã PIN phòng chơi"><button class="btn amber">Tham gia →</button></form></div></div><div><div class="hero-card"><div class="justify-between"><span class="pill good">● LIVE VOCAB ARENA</span><span class="pill">🇯🇵 🇬🇧 🇨🇳</span></div><div class="fall-preview"><div class="eyebrow" style="color:#42200c">Thẻ từ vựng</div><strong>図書館</strong><p style="color:#5d2f1c;font-weight:800">Đọc từ này như thế nào?</p><div class="dots">_ _ _ _ _</div></div><div class="justify-between"><span>⚡ Ghi điểm theo tốc độ</span><span class="pill warn">+1000 PTS</span></div></div><div class="hero-stat"><div class="card"><h3>📚</h3><small>Sách → Bài → Từ</small></div><div class="card"><h3>📱</h3><small>Quét QR, vào chơi ngay</small></div></div></div></section><section class="featurestrip"><div class="card"><div class="iconcircle mb16">🗂️</div><h3>Thư viện của riêng bạn</h3><p>Tổ chức nội dung thành sách, bài học và từ vựng cho ba ngôn ngữ.</p></div><div class="card"><div class="iconcircle mb16">🚀</div><h3>Phòng chơi đồng bộ</h3><p>Giáo viên chủ trì, học sinh tham gia miễn đăng nhập, cùng chơi một lượt thẻ.</p></div><div class="card"><div class="iconcircle mb16">🏆</div><h3>Điểm và báo cáo</h3><p>Bảng xếp hạng, podium, lịch sử trả lời và xuất kết quả CSV.</p></div></section></div>`);
 $('#pinForm').onsubmit=async e=>{e.preventDefault();try{let r=await api('/public/session?pin='+encodeURIComponent($('#pinInput').value));goto('/join/'+r.joinToken)}catch(e){niceError(e)}};
}
async function openLogin(){if(A.user){goto('/app');return}if(!A.config)A.config=await api('/config');
 modal('Đăng nhập giáo viên',`<p class="mb16">Đăng nhập bằng tài khoản Google để quản lý nội dung của chính bạn.</p><div id="googleButtonArea" class="google-area"></div><div class="stack">${A.config.demoLogin?'<button type="button" class="btn outline-cyan" id="devLogin">🧪 Vào tài khoản demo trên máy cục bộ</button>':''}</div><div class="sub mt12">Học sinh tham gia bằng QR/PIN không cần đăng nhập.</div>`,async()=>{});
 $('#modalForm .modalfoot').style.display='none';
 if(A.config.demoLogin)$('#devLogin').onclick=async()=>{try{await api('/auth/demo','POST',{});A.user=await api('/me');$('#modal-root').innerHTML='';goto(A.postLogin||'/app');A.postLogin=null}catch(e){niceError(e)}};
 if(A.config.googleClientId){
  if(!window.google){const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=googleInit;script.onerror=()=>toast('Không tải được Google Identity Services',true);document.head.appendChild(script);}else googleInit();
 }else $('#googleButtonArea').innerHTML='<p class="sub">Chưa thiết lập GOOGLE_CLIENT_ID. Thêm biến môi trường để bật Google Login.</p>';
}
function googleInit(){if(!window.google||!$('#googleButtonArea'))return;google.accounts.id.initialize({client_id:A.config.googleClientId,callback:async data=>{try{await api('/auth/google','POST',{credential:data.credential});A.user=await api('/me');$('#modal-root').innerHTML='';goto(A.postLogin||'/app');A.postLogin=null}catch(e){niceError(e)}}});google.accounts.id.renderButton($('#googleButtonArea'),{theme:'filled_black',size:'large',text:'continue_with',width:340})}
function shell(section,content){const items=[['app','⌂','Tổng quan'],['app/books','▣','Thư viện'],['app/classes','♙','Lớp học'],['app/sessions','⚡','Phiên chơi'],['app/practice','🎮','Luyện tập'],['app/reports','▤','Báo cáo']];
 const key=section==='book'||section==='lesson'?'app/books':section;
 html(`<div class="shell"><aside class="sidebar"><div class="sidehead"><div class="brandline"><div class="brandmark">✦</div><span>LexiVerse</span></div><p class="sub">TEACHER WORKSPACE</p></div><nav class="navlist" aria-label="Điều hướng giáo viên">${items.map(([url,icon,label])=>`<a class="navitem ${key===url?'active':''}" href="/${url}" data-nav="/${url}"><span class="navicon">${icon}</span><span class="navlabel">${label}</span></a>`).join('')}</nav><div class="sidetip"><strong>⚡ Mẹo nhỏ</strong><p>Chuẩn bị bộ từ, chọn bài học rồi tạo phòng LIVE để chia sẻ QR với cả lớp.</p></div><div class="account"><div class="avatar">${esc((A.user.name||'G')[0].toUpperCase())}</div><div class="grow"><strong>${esc(A.user.name)}</strong><small>${esc(A.user.email||'Giáo viên')}</small></div><button class="btn small ghost" title="Đăng xuất" data-action="logout">↪</button></div></aside><div class="main"><header class="topbar"><div class="crumb">LexiVerse / <strong style="color:#fff">${esc({'app':'Tổng quan','app/books':'Thư viện','app/classes':'Lớp học','app/sessions':'Phiên chơi','app/practice':'Luyện tập','app/reports':'Báo cáo',book:'Chi tiết sách',lesson:'Chi tiết bài'}[section]||'Workspace')}</strong></div><div class="topactions"><span class="pill good hide-mobile">● Không gian giáo viên</span>${nav('/','⌂ Trang chủ','btn small ghost')}</div></header><main class="page">${content}</main></div></div>`);
}
async function showTeacher(p){if(!A.user){showLanding();openLogin();return}
 const sec=p[1]||'dashboard';
 if(sec==='practice' && p[2])return await renderPracticeLesson(p[2]);
 if(sec==='practice')return await renderPracticeLibrary();
 if(sec==='books' && p[2])return await renderBook(p[2]);
 if(sec==='lessons' && p[2])return await renderLesson(p[2]);
 if(sec==='books')return await renderBooks();
 if(sec==='classes')return await renderClasses();
 if(sec==='sessions')return await renderSessions();
 if(sec==='reports')return await renderReports();
 return await renderDashboard();
}
async function getBooks(){A.books=await api('/books');return A.books}
async function getClasses(){A.classes=await api('/classes');return A.classes}
async function getSessions(){A.sessions=await api('/sessions');return A.sessions}
async function renderDashboard(){let [books,classes,sessions]=await Promise.all([getBooks(),getClasses(),getSessions()]);let active=sessions.filter(s=>['LIVE','PAUSED','LOBBY'].includes(s.status));
 shell('app',`<div class="pagehead"><div><div class="eyebrow">WORKSPACE / TỔNG QUAN</div><h1>Xin chào, ${esc(A.user.name.split(' ')[0])} 👋</h1><p>Chào mừng trở lại đấu trường ngôn ngữ của bạn.</p></div>${action('＋ Tạo phòng chơi','new-session','','btn primary')}</div><div class="grid grid-4 mb24"><div class="stat-card"><div class="iconcircle mb8">📚</div><div class="stat-number">${books.length}</div><div class="stat-label">Sách của tôi</div></div><div class="stat-card"><div class="iconcircle mb8">📖</div><div class="stat-number">${books.reduce((sum,b)=>sum+b.lessonCount,0)}</div><div class="stat-label">Bài học</div></div><div class="stat-card"><div class="iconcircle mb8">👩‍🏫</div><div class="stat-number">${classes.length}</div><div class="stat-label">Lớp học</div></div><div class="stat-card"><div class="iconcircle mb8">⚡</div><div class="stat-number">${sessions.length}</div><div class="stat-label">Phiên đã tạo</div></div></div><div class="lead-card mb24"><div><div class="eyebrow">🎮 GAME TIME</div><h2 style="font-size:29px;margin:10px 0">Sẵn sàng khuấy động lớp học?</h2><p>Chọn một bài từ vựng, tạo PIN và đón học sinh vào phòng.</p><div class="button-row mt12">${action('🚀 Tổ chức chơi ngay','new-session','','btn primary')}${nav('/app/books','Mở thư viện','btn ghost')}</div></div><div class="lead-emoji">🏆</div></div><div class="grid grid-2"><div class="card"><div class="card-title"><h3>⚡ Phiên gần đây</h3>${nav('/app/sessions','Xem tất cả →','btn small ghost')}</div>${sessions.length?sessions.slice(0,5).map(s=>`<div class="listitem"><span class="iconcircle">🎯</span><div class="grow"><strong>${esc(s.title)}</strong><p>${date(s.created_at)} · ${s.playerCount} người chơi</p></div>${badge(s.status)}${nav('/host/'+s.id,'Mở','btn small')}</div>`).join(''):'<p class="sub">Chưa có phiên chơi. Tạo bài học đầu tiên để bắt đầu.</p>'}</div><div class="card"><div class="card-title"><h3>📚 Sách gần đây</h3>${nav('/app/books','Quản lý →','btn small ghost')}</div>${books.length?books.slice(0,5).map(b=>`<div class="listitem"><span class="iconcircle">${flags[b.language]}</span><div class="grow"><strong>${esc(b.title)}</strong><p>${b.lessonCount} bài · ${b.wordCount} từ</p></div>${nav('/app/books/'+b.id,'Mở →','btn small ghost')}</div>`).join(''):'<p class="sub">Chưa có sách trong thư viện.</p>'}</div></div>`);
}
async function renderBooks(){let books=await getBooks();shell('app/books',`<div class="pagehead"><div><div class="eyebrow">NỘI DUNG HỌC TẬP</div><h1>📚 Thư viện của tôi</h1><p>Tổ chức nội dung theo Sách → Bài học → Từ vựng.</p></div><div class="button-row">${action('⇧ Nhập dữ liệu cũ','legacy-import','','btn ghost')}${action('＋ Tạo sách','new-book','','btn primary')}</div></div><div class="justify-between mb24 wrap-mobile"><input id="bookFilter" class="field" style="max-width:380px" placeholder="🔎 Tìm sách theo tên..." aria-label="Tìm kiếm sách"><span class="pill blue">${books.length} sách · ${books.reduce((n,b)=>n+b.wordCount,0)} từ vựng</span></div><div class="grid grid-3" id="booksGrid">${bookTiles(books)}</div>`);
 $('#bookFilter').oninput=e=>$('#booksGrid').innerHTML=bookTiles(books.filter(b=>b.title.toLocaleLowerCase().includes(e.target.value.toLocaleLowerCase())));
}
function bookTiles(books){return books.length?books.map(b=>`<div class="card library-card"><div class="justify-between"><span class="booksymbol">${flags[b.language]}</span><span class="pill">${esc(langName[b.language]||b.language)}</span></div><h3 class="mt12">${esc(b.title)}</h3><p class="sub" style="min-height:35px">${esc(b.description||'Chưa có mô tả')}</p><div class="justify-between"><span class="bookmeta">${b.lessonCount} bài · ${b.wordCount} từ</span><div class="button-row">${action('✎','edit-book',b.id,'btn small ghost')}${nav('/app/books/'+b.id,'Mở →','btn small outline-cyan')}</div></div></div>`).join(''):empty('📚','Chưa có sách','Tạo sách đầu tiên để bắt đầu xây dựng thư viện từ vựng.',action('＋ Tạo sách','new-book','','btn primary'))}
async function renderBook(bid){let books=await getBooks();const b=books.find(x=>x.id===bid);if(!b)throw Error('Sách không tồn tại hoặc bạn không có quyền truy cập');A.activeBook=b;
 let ls=await api(`/books/${bid}/lessons`);A.lessons=ls;
 shell('book',`<div class="pagehead"><div>${nav('/app/books','← Quay lại thư viện','btn small ghost')}<div class="eyebrow mt12">${esc(langName[b.language])} / ${b.lessonCount} bài học</div><h1>${esc(b.title)}</h1><p>${esc(b.description||'Thêm các bài học để sắp xếp từ vựng.')}</p></div><div class="button-row">${action('✎ Sửa sách','edit-book',b.id,'btn ghost')}${action('🗑 Xóa sách','delete-book',b.id,'btn danger')}${action('＋ Tạo bài học','new-lesson',bid,'btn primary')}</div></div><div class="card mb24"><div class="card-title"><h3>Danh sách bài học</h3><span class="pill">${ls.length} bài</span></div><p class="sub">Chọn bài để quản lý từ và tạo phiên chơi trực tiếp.</p></div>${ls.length?ls.map((l,i)=>`<div class="listitem"><div class="iconcircle">${i+1}</div><div class="grow"><h3>${esc(l.title)}</h3><p>${esc(l.description||'Bài học từ vựng')} · ${l.wordCount} từ</p></div><span class="pill ${l.wordCount?'good':'warn'}">${l.wordCount?'Có thể chơi':'Chưa có từ'}</span>${action('✎','edit-lesson',l.id,'btn small ghost')}${action('🗑','delete-lesson',l.id,'btn small danger')}${nav('/app/lessons/'+l.id,'Chi tiết →','btn small outline-cyan')}</div>`).join(''):empty('📖','Chưa có bài học','Một sách có thể chứa nhiều bài và mỗi bài có nhiều từ.',action('＋ Tạo bài','new-lesson',bid,'btn primary'))}`);
}
async function renderLesson(lid){let books=await getBooks(),l=null,b=null;
 for(const book of books){let ls=await api(`/books/${book.id}/lessons`);let found=ls.find(x=>x.id===lid);if(found){l=found;b=book;break}}
 if(!l)throw Error('Bài học không tồn tại');A.activeBook=b;A.activeLesson=l;
 let words=await api(`/lessons/${lid}/words`);A.words=words;
 shell('lesson',`<div class="pagehead"><div>${nav('/app/books/'+b.id,'← '+esc(b.title),'btn small ghost')}<div class="eyebrow mt12">${esc(langName[b.language])} / ${words.length} từ vựng</div><h1>${esc(l.title)}</h1><p>${esc(l.description||'Nội dung bài học')}</p></div><div class="button-row">${words.length?nav('/app/practice/'+lid,'🎮 Luyện bài này','btn primary'):''}${action('⚡ Tổ chức LIVE','new-session',lid,'btn ghost',words.length?'':'disabled')}${action('⇩ Tải mẫu CSV','download-template',lid,'btn ghost')}${action('⇧ Nhập nhiều từ','bulk-import',lid,'btn outline-cyan')}${action('＋ Thêm từ','new-word',lid,'btn primary')}</div></div><div class="card mb16"><div class="card-title"><h3>🧠 Kho từ vựng</h3><span class="pill">${words.length} mục</span></div><div class="mt12"><input id="wordFilter" class="field" placeholder="🔎 Tìm theo từ hoặc nghĩa..." aria-label="Tìm từ vựng"></div></div><div id="wordList">${wordItems(words)}</div>`);
 $('#wordFilter').oninput=e=>$('#wordList').innerHTML=wordItems(words.filter(w=>(w.term+' '+w.meaning).toLocaleLowerCase().includes(e.target.value.toLocaleLowerCase())));
}
function wordItems(words){return words.length?words.map((w,i)=>`<div class="listitem"><div class="iconcircle">${i+1}</div><div class="grow"><h3>${esc(w.term)} <small>${esc(w.pronunciation)}</small></h3><p>${esc(w.meaning)}</p>${w.alternatives?.length?`<p>Đáp án khác: ${esc(w.alternatives.join(', '))}</p>`:''}</div><div class="button-row">${action('✎ Sửa','edit-word',w.id,'btn small ghost')}${action('🗑','delete-word',w.id,'btn small danger')}</div></div>`).join(''):empty('🧠','Chưa có từ vựng','Thêm từ, nghĩa tiếng Việt, cách đọc và đáp án thay thế.',action('＋ Thêm từ','new-word',A.activeLesson?.id||'','btn primary'))}
// Integrated solo-practice game: books -> lesson -> cards. PRIVATE: requires teacher login.
function stopPractice(){
 if(A.practiceTimer){clearInterval(A.practiceTimer);A.practiceTimer=null}
 if(window.speechSynthesis)window.speechSynthesis.cancel();
 A.practice=null;
}
async function renderPracticeLibrary(){
 const books=await getBooks();
 const lists=await Promise.all(books.map(async b=>({book:b,lessons:await api(`/books/${b.id}/lessons`)})));
 shell('app/practice',`<div class="pagehead"><div><div class="eyebrow">🎮 LUYỆN TẬP CÁ NHÂN</div><h1>Chọn sách để luyện tập</h1><p>Chọn một cuốn sách, sau đó chọn bài học bạn đã thêm. Dùng chính kho từ vựng của bạn.</p></div>${nav('/app/books','Quản lý sách','btn ghost')}</div>${lists.length?lists.map(({book,lessons})=>`<section class="card practice-book"><div class="practice-book-title"><div><span class="pill">${flags[book.language]||'📚'} ${esc(langName[book.language]||book.language)}</span><h2 class="mt12">${esc(book.title)}</h2><p class="sub">${lessons.length} bài học · ${book.wordCount} từ</p></div><span class="booksymbol" aria-hidden="true">📖</span></div><div class="practice-lesson-list">${lessons.length?lessons.map((l,i)=>`<div class="practice-lesson-row"><span class="iconcircle">${i+1}</span><div class="grow"><strong>${esc(l.title)}</strong><p>${l.wordCount} từ vựng · ${esc(l.description||'Sẵn sàng luyện tập')}</p></div>${l.wordCount?nav('/app/practice/'+l.id,'🎮 Luyện bài này','btn primary'):'<span class="pill warn">Chưa có từ</span>'}</div>`).join(''):'<p class="sub">Sách chưa có bài học. Vào Thư viện để tạo bài.</p>'}</div></section>`).join(''):empty('📚','Bạn chưa có sách','Hãy tạo sách → bài học → từ vựng để bắt đầu luyện tập.',nav('/app/books','Tạo sách đầu tiên','btn primary'))}`);
}
async function renderPracticeLesson(lid){
 // Find lesson only within books owned by the current authenticated teacher.
 const books=await getBooks();let lesson=null,book=null;
 for(const b of books){let lessons=await api(`/books/${b.id}/lessons`);const candidate=lessons.find(l=>l.id===lid);if(candidate){lesson=candidate;book=b;break}}
 if(!lesson){goto('/app/practice');toast('Không tìm thấy bài học hoặc bạn không có quyền',true);return}
 if(!lesson.wordCount){goto('/app/practice');toast('Bài chưa có từ vựng',true);return}
 shell('app/practice',`<div class="pagehead"><div>${nav('/app/practice','← Chọn bài khác','btn small ghost')}<div class="eyebrow mt12">${esc(langName[book.language])} / ${esc(book.title)}</div><h1>🎯 ${esc(lesson.title)}</h1><p>${lesson.wordCount} từ · Trả lời càng nhanh, điểm càng cao.</p></div></div><div class="card practice-setup"><div class="grid grid-2"><label class="formrow"><span class="label">Chế độ thẻ</span><select class="field" id="practiceMode"><option value="mixed">🎲 Hỗn hợp</option><option value="spelling">✍️ Chính tả</option><option value="reading">🔊 Cách đọc</option></select></label><label class="formrow"><span class="label">Tốc độ thẻ rơi</span><select class="field" id="practiceSpeed"><option value="slow">Chậm · 20 giây</option><option value="normal" selected>Vừa · 12 giây</option><option value="fast">Nhanh · 8 giây</option></select></label></div><div class="practice-setup-actions">${action('▶ Bắt đầu luyện tập','practice-start',lid,'btn primary')}${nav('/app/lessons/'+lid,'✎ Chỉnh sửa từ vựng','btn ghost')}</div><p class="sub mt12">Bài tập dùng 1 bàn phím: tiếng Nhật nhập Hiragana, tiếng Trung nhập Pinyin, tiếng Anh nhập chữ Latin. Thẻ nghe có nút 🔊.</p></div>`);
}
function normPractice(value,lang){
 let v=String(value??'').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
 if(lang==='zh-CN')v=v.replace(/ü/g,'v').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s'’·-]/g,'');
 return v;
}
function practiceStats(p){return `<span class="pill warn">⭐ ${p.score} điểm</span><span class="pill good">✓ ${p.correct}/${p.index} đúng</span><span class="pill">🔥 x${p.streak}</span>`}
async function startPractice(lid,mode='mixed',speed='normal',retryDeck=null){
 if(!lid)return;
 stopPractice();
 const deck=retryDeck||await api(`/practice/lessons/${encodeURIComponent(lid)}/cards?mode=${encodeURIComponent(mode)}`);
 if(!deck.cards.length){toast('Bài học chưa có từ hợp lệ',true);return}
 const durations={slow:20000,normal:12000,fast:8000};
 const p={lid,mode,speed,cards:deck.cards,language:deck.language,bookTitle:deck.bookTitle,lessonTitle:deck.lessonTitle,
   index:0,correct:0,missed:[],history:[],score:0,streak:0,maxStreak:0,total:deck.cards.length,duration:durations[speed]||12000,
   questionStarted:0,pausedAt:0,paused:false,feedback:null,phase:'OPEN',autoPlay:false};
 A.practice=p;renderPracticeArena();practiceNextCard();
}
function renderPracticeArena(){
 const p=A.practice;if(!p)return;
 html(`<div class="game-shell practice-screen"><header class="game-top"><div class="brandline"><div class="brandmark">✦</div><span>LexiVerse <small>· Luyện tập</small></span></div><div class="game-control">${action('← Chọn bài','practice-stop','','btn small ghost')}<span class="pill blue">${esc(p.bookTitle)}</span></div></header>
 <div class="practice-game-layout"><div class="practice-game-heading"><div><div class="eyebrow">🎯 ${esc(p.lessonTitle)}</div><h2>Luyện tập cá nhân</h2></div><div class="practice-score" id="practiceStats">${practiceStats(p)}</div></div>
 <div class="arena arena-compact practice-arena" id="practiceArena"><div class="progress-top"><span id="practiceProgress">1/${p.total}</span><div class="meter"><span id="practiceMeter" style="width:0%"></span></div><span>💎</span></div><div class="dangerline"></div><div class="fall-card game-card" id="practiceCard"><div class="timebar"><span id="practiceFuse" style="width:100%"></span></div><span class="label-dark card-mode-label" id="practiceCardMode">CHÍNH TẢ</span><button class="card-sound" id="practiceSpeak" data-action="practice-sound" type="button" aria-label="Nghe câu hỏi" title="Nghe câu hỏi">🔊</button><div class="prompt-text" id="practicePrompt"></div><div class="question-underline" id="practiceSlots">· · · · ·</div><div class="card-reveal hidden" id="practiceReveal"></div></div><div class="practice-pause-layer hidden" id="practicePaused"><h2>⏸ Tạm dừng</h2></div></div>
 <form class="answer-bar practice-answer" id="practiceAnswerForm"><input id="practiceInput" class="field" type="text" maxlength="200" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Gõ đáp án…" aria-label="Nhập đáp án từ vựng"><button class="btn amber" id="practiceSend">Gửi ↵</button><button class="btn ghost" id="practiceSkip" type="button" title="Bỏ qua">Bỏ qua</button></form>
 <div class="practice-feedback" id="practiceFeedback" role="status" aria-live="polite"><span>⌨️ Một bàn phím xuyên suốt lượt chơi</span><div class="button-row"><button type="button" class="btn small ghost" id="practicePause">⏸ Tạm dừng</button><button type="button" class="btn small ghost" id="practiceRestart">↻ Chơi lại</button></div></div></div>`);
 $('#practiceAnswerForm').onsubmit=ev=>{ev.preventDefault();practiceSubmit($('#practiceInput')?.value||'')};
 $('#practiceSkip').onclick=()=>practiceSubmit('',true);
 $('#practicePause').onclick=practiceTogglePause;
 $('#practiceRestart').onclick=()=>startPractice(p.lid,p.mode,p.speed).catch(niceError);
}
function practiceNextCard(){
 const p=A.practice;if(!p)return;
 if(p.index>=p.total){practiceFinished();return}
 p.phase='OPEN';p.feedback=null;p.questionStarted=performance.now();
 const card=p.cards[p.index];const length=Math.min(12,Math.max(4,Array.from(card.answer||'').length));
 $('#practicePrompt').textContent=card.prompt;
 $('#practiceCardMode').textContent=card.mode==='reading'?'CÁCH ĐỌC':'CHÍNH TẢ';
 $('#practiceSlots').textContent=Array(length).fill('—').join(' ');
 $('#practiceReveal').classList.add('hidden');$('#practiceReveal').textContent='';
 $('#practiceInput').value='';$('#practiceInput').disabled=false;$('#practiceSend').disabled=false;$('#practiceSkip').disabled=false;
 $('#practiceProgress').textContent=(p.index+1)+'/'+p.total;
 $('#practiceMeter').style.width=((p.index)/p.total*100)+'%';
 $('#practiceStats').innerHTML=practiceStats(p);
 $('#practiceFeedback>span').textContent='⌨️ Gõ đáp án trước khi thẻ chạm đáy';
 $('#practiceFeedback').classList.remove('is-good','is-wrong');
 $('#practiceSpeak').hidden=card.mode!=='reading';
 const fc=$('#practiceCard');fc.style.top='21%';
 if(A.practiceTimer)clearInterval(A.practiceTimer);
 A.practiceTimer=setInterval(practiceTick,65);practiceTick();
 $('#practiceInput')?.focus({preventScroll:true});
 if(card.mode==='reading')speakPractice(true);
}
function practiceTick(){
 const p=A.practice;if(!p||p.phase!=='OPEN'||p.paused)return;
 let remain=Math.max(0,p.duration-(performance.now()-p.questionStarted)),pct=remain/p.duration;
 const stage=$('#practiceArena'),fc=$('#practiceCard');if(!stage||!fc)return;
 $('#practiceFuse').style.width=(pct*100)+'%';
 const first=Math.max(63,stage.clientHeight*.21),last=Math.max(first,stage.clientHeight-fc.offsetHeight-18);
 fc.style.top=(first+(last-first)*(1-pct))+'px';
 if(remain<=0)practiceSubmit('',true);
}
function practiceSubmit(value,skipped=false){
 const p=A.practice;if(!p||p.phase!=='OPEN'||p.paused)return;
 p.phase='REVEAL';if(A.practiceTimer){clearInterval(A.practiceTimer);A.practiceTimer=null}
 const card=p.cards[p.index];const elapsed=Math.min(p.duration,performance.now()-p.questionStarted);
 const answers=(card.accepted||[card.answer]).map(x=>normPractice(x,p.language));
 const ok=!skipped&&Boolean(value.trim())&&answers.includes(normPractice(value,p.language));
 const points=ok?Math.round((1000-900*elapsed/p.duration)*(1+Math.min(5,p.streak)*.1)):0;
 if(ok){p.correct++;p.streak++;p.maxStreak=Math.max(p.maxStreak,p.streak);p.score+=points}
 else{p.streak=0;p.missed.push(card)}
 p.history.push({prompt:card.prompt,answer:card.answer,correct:ok,points});
 $('#practiceInput').disabled=true;$('#practiceSend').disabled=true;$('#practiceSkip').disabled=true;
 const feedback=$('#practiceFeedback');feedback.classList.remove('is-good','is-wrong');feedback.classList.add(ok?'is-good':'is-wrong');
 feedback.querySelector('span').textContent=ok?'✓ Chính xác! +'+points+' điểm':skipped?'○ Hết giờ / Bỏ qua':'↻ Chưa đúng · Đáp án hiển thị trên thẻ';
 const reveal=$('#practiceReveal');reveal.classList.remove('hidden');reveal.textContent='Đáp án: '+card.answer;
 $('#practiceStats').innerHTML=practiceStats({...p,index:p.index+1});
 const stage=$('#practiceArena'),fc=$('#practiceCard');if(stage&&fc)fc.style.top=Math.max(63,Math.min(stage.clientHeight*.30,stage.clientHeight-fc.offsetHeight-18))+'px';
 const current=p;
 setTimeout(()=>{if(A.practice!==current||p.phase!=='REVEAL')return;p.index++;practiceNextCard()},1100);
}
function practiceTogglePause(){
 const p=A.practice;if(!p||p.phase!=='OPEN')return;
 if(!p.paused){p.paused=true;p.pausedAt=performance.now();$('#practicePaused').classList.remove('hidden');$('#practicePause').textContent='▶ Tiếp tục';$('#practiceInput').disabled=true;}
 else{p.questionStarted+=performance.now()-p.pausedAt;p.paused=false;$('#practicePaused').classList.add('hidden');$('#practicePause').textContent='⏸ Tạm dừng';$('#practiceInput').disabled=false;$('#practiceInput').focus({preventScroll:true})}
}
function speakPractice(silent=false){
 const p=A.practice;if(!p||p.phase!=='OPEN')return;
 const card=p.cards[p.index];
 const text=card.audioText||card.term;
 const lang=card.audioLang||({'ja':'ja-JP','zh-CN':'zh-CN','en':'en-US'}[p.language]);
 if(!('speechSynthesis' in window)){if(!silent)toast('Trình duyệt chưa hỗ trợ phát âm',true);return}
 window.speechSynthesis.cancel();
 const utterance=new SpeechSynthesisUtterance(text);utterance.lang=lang;utterance.rate=.85;
 window.speechSynthesis.speak(utterance);
}
function practiceFinished(){
 const p=A.practice;if(!p)return;
 if(A.practiceTimer){clearInterval(A.practiceTimer);A.practiceTimer=null}
 html(`<div class="game-shell practice-screen"><div class="practice-result"><div class="waiting-emoji">🏆</div><div class="eyebrow">HOÀN TẤT BÀI LUYỆN</div><h1>${esc(p.lessonTitle)}</h1><p>Bạn đã hoàn thành ${p.total} thẻ của sách ${esc(p.bookTitle)}</p><div class="grid grid-3 mt24"><div class="card scoretile"><b>${p.score}</b><small>Điểm số</small></div><div class="card scoretile"><b>${p.correct}/${p.total}</b><small>Đúng</small></div><div class="card scoretile"><b>x${p.maxStreak}</b><small>Combo cao nhất</small></div></div><div class="card mt24"><h3>📖 Lịch sử trả lời</h3><div class="practice-history">${p.history.map((h,i)=>`<div class="scoreboard-row"><span>${h.correct?'✓':'○'} ${i+1}. ${esc(h.prompt)}</span><strong>${esc(h.answer)}</strong></div>`).join('')}</div></div><div class="button-row mt24" style="justify-content:center">${action('↻ Luyện lại bài','practice-again','','btn primary')}${p.missed.length?action('🎯 Ôn từ sai ('+p.missed.length+')','practice-retry','','btn amber'):''}${nav('/app/practice','Chọn bài khác','btn ghost')}</div></div></div>`);
}
function retryPractice(){
 const p=A.practice;if(!p||!p.missed.length)return;
 const deck={cards:p.missed,language:p.language,bookTitle:p.bookTitle,lessonTitle:p.lessonTitle};
 return startPractice(p.lid,p.mode,p.speed,deck);
}

async function renderClasses(){let cs=await getClasses();shell('app/classes',`<div class="pagehead"><div><div class="eyebrow">QUẢN LÝ NHÓM HỌC</div><h1>👩‍🏫 Lớp học</h1><p>Lớp học dài hạn và mã lớp độc lập với PIN phòng chơi.</p></div>${action('＋ Tạo lớp học','new-class','','btn primary')}</div><div class="grid grid-2">${cs.length?cs.map(c=>`<div class="card"><div class="justify-between"><div class="iconcircle">${flags[c.language]}</div><span class="pill ${c.status==='ACTIVE'?'good':'warn'}">${c.status==='ACTIVE'?'Đang hoạt động':'Đã lưu trữ'}</span></div><h3 class="mt12">${esc(c.name)}</h3><p>${esc(c.description||'Lớp học ngôn ngữ')}</p><div class="tagrow"><span class="pill">♙ ${c.memberCount} thành viên</span><span class="pill">Mã lớp: ${esc(c.invite_code)}</span></div><div class="button-row mt24">${action('👥 Thành viên','members',c.id,'btn small primary')}${action('🔗 Sao chép lời mời','copy-class',c.id,'btn small')}${action('✎','edit-class',c.id,'btn small ghost')}${action('🗑','delete-class',c.id,'btn small danger')}</div></div>`).join(''):empty('👩‍🏫','Chưa có lớp học','Tạo lớp để lưu danh sách học viên và liên kết kết quả phiên.',action('＋ Tạo lớp học','new-class','','btn primary'))}</div>`)}
async function renderSessions(){let ss=await getSessions();shell('app/sessions',`<div class="pagehead"><div><div class="eyebrow">TỔ CHỨC TRỰC TIẾP</div><h1>⚡ Phiên chơi</h1><p>Phát mã PIN/QR, quản lý sảnh chờ và điều khiển game đồng bộ.</p></div>${action('＋ Tạo phòng mới','new-session','','btn primary')}</div>${ss.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Tên phiên</th><th>PIN</th><th>Người chơi</th><th>Thời gian tạo</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${ss.map(s=>`<tr><td><strong>${esc(s.title)}</strong></td><td><strong>${esc(s.pin)}</strong></td><td>${s.playerCount}</td><td>${date(s.created_at)}</td><td>${badge(s.status)}</td><td>${nav('/host/'+s.id,s.status==='RESULTS'?'Kết quả →':'Mở phòng →','btn small outline-cyan')}</td></tr>`).join('')}</tbody></table></div>`:empty('⚡','Chưa có phiên chơi','Chuẩn bị bài từ vựng rồi nhấn Tạo phòng.',action('＋ Tạo phòng','new-session','','btn primary'))}`)}
async function renderReports(){let ss=(await getSessions()).filter(s=>s.status==='RESULTS');shell('app/reports',`<div class="pagehead"><div><div class="eyebrow">LEARNING INSIGHTS</div><h1>▤ Báo cáo & kết quả</h1><p>Xem điểm, bảng xếp hạng và kết quả từng lượt sau phiên LIVE.</p></div></div>${ss.length?ss.map(s=>`<div class="listitem"><div class="iconcircle">🏆</div><div class="grow"><h3>${esc(s.title)}</h3><p>Hoàn tất ${date(s.ended_at)} · ${s.playerCount} người</p></div>${action('Xem báo cáo','report',s.id,'btn small primary')}${nav('/host/'+s.id,'Podium','btn small ghost')}</div>`).join(''):empty('▤','Chưa có báo cáo','Báo cáo được lưu sau khi phiên chơi kết thúc.')}`)}
async function bookForm(id=null){let b=id?(await getBooks()).find(x=>x.id===id):null;if(id&&!b)throw Error('Không có quyền với sách này');
 modal(b?'Chỉnh sửa sách':'Tạo sách mới',field('title','Tên sách',b?.title||'')+langSelect(b?.language||'en')+area('description','Mô tả',b?.description||''),async v=>{
  await api(b?`/books/${b.id}`:'/books',b?'PATCH':'POST',v)
 })}
async function lessonForm(bookId,lid=null){let b=bookId||A.activeBook?.id;if(!b)throw Error('Hãy chọn sách');
 let ls=lid?await api(`/books/${b}/lessons`):[];let l=ls.find(x=>x.id===lid);
 modal(l?'Chỉnh sửa bài học':'Thêm bài học',field('title','Tên bài',l?.title||'')+area('description','Mô tả',l?.description||'')+field('sort_order','Thứ tự',l?.sort_order||'0',false,'number',6),async v=>{
  v.sort_order=Number(v.sort_order)||0;await api(l?`/lessons/${l.id}`:`/books/${b}/lessons`,l?'PATCH':'POST',v)
 })}
async function wordForm(lid,wid=null){lid=lid||A.activeLesson?.id;if(!lid)throw Error('Chưa chọn bài học');let words=wid?await api(`/lessons/${lid}/words`):[];let w=words.find(x=>x.id===wid);
 modal(w?'Chỉnh sửa thẻ từ':'Thêm từ vựng',field('term','Từ / thuật ngữ',w?.term||'')+field('meaning','Nghĩa tiếng Việt',w?.meaning||'')+field('pronunciation','Phiên âm / cách đọc',w?.pronunciation||'',false)+field('alternatives','Đáp án chấp nhận thêm (ngăn bằng dấu phẩy)',w?.alternatives?.join(', ')||'',false)+field('sort_order','Thứ tự',w?.sort_order||'0',false,'number',6),async v=>{
  v.sort_order=Number(v.sort_order)||0;await api(w?`/words/${w.id}`:`/lessons/${lid}/words`,w?'PATCH':'POST',v)
 })}
async function classForm(id=null){let c=id?(await getClasses()).find(x=>x.id===id):null;
 modal(c?'Chỉnh sửa lớp học':'Tạo lớp học',field('name','Tên lớp',c?.name||'',true,'text',80)+langSelect(c?.language||'en')+area('description','Mô tả',c?.description||'')+(c?select('status','Trạng thái',[['ACTIVE','Đang hoạt động'],['ARCHIVED','Đã lưu trữ']],c.status):''),async v=>{
  await api(c?`/classes/${c.id}`:'/classes',c?'PATCH':'POST',v)
 })}
async function membersModal(cid){const c=(await getClasses()).find(x=>x.id===cid);if(!c)return;
 const members=await api(`/classes/${cid}/members`);
 modal('Thành viên · '+c.name,`<p class="sub mb16">Mã mời: <strong>${esc(c.invite_code)}</strong></p><div class="text-center mb16"><div class="qr-box"><img style="height:138px;width:138px" alt="QR mời lớp học" src="/api/classes/${encodeURIComponent(cid)}/qr"></div><p class="sub">Quét mã QR để tham gia lớp</p></div><div class="button-row mb16">${action('Sao chép link','copy-class',c.id,'btn small primary')}${action('Đổi mã mời','reset-code',c.id,'btn small ghost')}</div><div class="stack">${members.filter(m=>m.status==='ACTIVE').length?members.filter(m=>m.status==='ACTIVE').map(m=>`<div class="listitem"><span class="iconcircle">👤</span><div class="grow"><strong>${esc(m.nickname)}</strong><p>Tham gia ${date(m.joined_at)}</p></div>${action('Loại','remove-member',cid+'|'+m.id,'btn small danger')}</div>`).join(''):'<p>Chưa có thành viên.</p>'}</div>`,async()=>{});
 $('#modalForm .modalfoot').style.display='none';
}
async function newSession(defaultLesson=null){let books=await getBooks(),classes=await getClasses();let ls=[];
 for(const b of books){let list=await api(`/books/${b.id}/lessons`);for(const l of list)if(l.wordCount)ls.push({...l,bookTitle:b.title,bookLang:b.language})}
 if(!ls.length){toast('Hãy tạo ít nhất một bài có từ vựng trước khi mở phòng',true);goto('/app/books');return}
 const defaultId=ls.some(x=>x.id===defaultLesson)?defaultLesson:ls[0].id;
 modal('🚀 Tạo phòng chơi trực tiếp',`<p class="sub mb16">Một phiên sử dụng một bài học và chấm điểm riêng cho từng người trên máy chủ.</p>${select('lessonId','Bài học',ls.map(l=>[l.id,`${l.bookTitle} → ${l.title} (${l.wordCount} từ)`]),defaultId)}${field('title','Tên phiên',ls.find(x=>x.id===defaultId)?.title||'Đấu trường từ vựng')}${select('classId','Gắn với lớp (không bắt buộc)',[['','Không gắn lớp'],...classes.filter(c=>c.status==='ACTIVE').map(c=>[c.id,c.name])],'')}
 <div class="formgrid"><div>${select('mode','Chế độ thẻ',[['mixed','🎲 Hỗn hợp'],['spelling','✍️ Chính tả'],['reading','🎧 Cách đọc']],'mixed')}</div><div>${select('speed','Tốc độ',[['slow','🐢 Chậm · 20 giây'],['normal','⚡ Vừa · 12 giây'],['fast','🚀 Nhanh · 8 giây']],'normal')}</div></div>
 <label class="formrow"><span class="label">Số từ sử dụng trong phiên *</span><input class="field" type="number" name="count" min="1" max="${ls.find(x=>x.id===defaultId).wordCount}" value="${Math.min(10,ls.find(x=>x.id===defaultId).wordCount)}" required inputmode="numeric"><span class="sub" id="sessionCountHint">Tối đa ${ls.find(x=>x.id===defaultId).wordCount} từ · Có thể chọn ít hơn tổng số từ trong bài.</span></label>
 <label class="flex mb16"><input name="shuffle" type="checkbox" value="on" checked> Trộn thứ tự từ ngẫu nhiên</label><label class="flex mb16"><input name="allowLate" type="checkbox" value="on"> Cho phép người chơi tham gia khi đã bắt đầu</label>`,async v=>{
  v.shuffle=Boolean(v.shuffle);v.allowLate=Boolean(v.allowLate);v.count=Number(v.count);
  if(!Number.isInteger(v.count)||v.count<1)throw Error('Số từ phải là số nguyên dương');
  v.title=v.title.trim();const result=await api('/sessions','POST',v);goto('/host/'+result.id)
 });
 const lessonSelect=$('#modalForm [name="lessonId"]'),countInput=$('#modalForm [name="count"]');
 lessonSelect.addEventListener('change',()=>{
  const lesson=ls.find(x=>x.id===lessonSelect.value);if(!lesson)return;
  countInput.max=String(lesson.wordCount);countInput.value=String(Math.min(10,lesson.wordCount));
  $('#sessionCountHint').textContent=`Tối đa ${lesson.wordCount} từ · Có thể chọn ít hơn tổng số từ trong bài.`;
 });
}
async function downloadTemplate(lid){
 const response=await fetch(`/api/lessons/${encodeURIComponent(lid)}/words/template`,{credentials:'same-origin'});
 if(!response.ok)throw Error((await response.json().catch(()=>({}))).detail||'Không tải được template');
 const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='lexiverse-template.csv';document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function bulkImportWords(lid){
 const lessons=A.activeLesson;
 modal('⇧ Nhập nhiều từ vựng',`<div class="import-guide"><p>1. Tải mẫu CSV đúng ngôn ngữ của bài học.</p><p>2. Điền <strong>term, meaning, pronunciation, alternatives, sort_order</strong> và giữ nguyên tên/thứ tự cột.</p><p>3. Lưu dưới dạng <strong>CSV UTF-8</strong>, tối đa 1.000 dòng và 2 MB.</p><p>4. Tải lên: các dòng bị trùng/sai được bỏ qua và hệ thống trả về thống kê.</p></div><div class="button-row mb16">${action('⇩ Tải template mẫu','download-template',lid,'btn outline-cyan')}</div><label class="formrow"><span class="label">Chọn tệp CSV *</span><input class="field file-input" type="file" id="bulkWordsFile" accept=".csv,text/csv" required></label><p class="sub">Bài hiện tại: ${esc(lessons?.title||'Bài học đang chọn')}. Với tiếng Nhật/Trung cần có Hiragana/Pinyin để chơi bằng một bàn phím.</p>`,async()=>{
  const file=$('#bulkWordsFile').files?.[0];if(!file)throw Error('Bạn chưa chọn file CSV');
  if(file.size>2*1024*1024)throw Error('File không được quá 2 MB');
  const fd=new FormData();fd.append('file',file);
  const response=await fetch(`/api/lessons/${encodeURIComponent(lid)}/words/import`,{
    method:'POST',body:fd,credentials:'same-origin',headers:{'X-CSRF-Token':A.user.csrf}
  });
  const data=await response.json().catch(()=>({detail:'Máy chủ không trả JSON'}));
  if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Import CSV không thành công');
  const detail=(data.errors||[]).slice(0,2).map(x=>`Dòng ${x.line}: ${x.reason}`).join(' · ');
  return {notice:`Đã thêm ${data.added} từ; bỏ qua ${data.skipped} dòng.${detail?' '+detail:''}`};
 });
}
async function replayAudio(){
 const state=A.currentState,card=state?.card;
 if(!state || card?.mode!=='reading' || !card.audio){toast('Thẻ này không yêu cầu nghe âm thanh');return}
 if(state.status!=='LIVE'||state.phase!=='OPEN'){toast('Lượt chơi đã kết thúc',true);return}
 const headers={};if(A.playerToken&&!A.host)headers['X-Player-Token']=A.playerToken;
 let res;
 try{res=await fetch(`/api/play/${encodeURIComponent(state.id)}/audio?roundIndex=${state.index}`,{headers,credentials:'same-origin'})}
 catch{throw Error('Không kết nối được máy chủ âm thanh')}
 if(!res.ok){let d=await res.json().catch(()=>({}));throw Error(d.detail||'Không phát được âm thanh')}
 const blob=await res.blob(),url=URL.createObjectURL(blob),player=new Audio(url);
 player.onended=()=>URL.revokeObjectURL(url);
 player.onerror=()=>{URL.revokeObjectURL(url);toast('Không phát được tệp âm thanh',true)};
 try{await player.play()}catch{URL.revokeObjectURL(url);throw Error('Trình duyệt chặn phát âm thanh. Hãy nhấn nghe lại.')}
}

async function importLegacy(){modal('⇧ Nhập dữ liệu từ HTML cũ',`<p class="sub">Chọn file JSON đã xuất từ tab “Đồng bộ & Sao lưu” của game cũ. Mỗi bộ từ sẽ tạo một sách và một bài mặc định, không ghi đè dữ liệu hiện tại.</p><label class="label mt24">File sao lưu JSON</label><input id="legacyFile" class="field" type="file" accept=".json,application/json" required><p class="sub mt12">Hoặc sao chép dữ liệu <code>lexiverse_standalone_data_v2</code> từ LocalStorage để tạo file JSON.</p>`,async()=>{
  const file=$('#legacyFile').files?.[0];if(!file)throw Error('Hãy chọn file .json');if(file.size>2*1024*1024)throw Error('File phải dưới 2 MB');let data;
  try{data=JSON.parse(await file.text())}catch{throw Error('Không đọc được file JSON')}
  let result=await api('/import/legacy','POST',data);
  toast(`Đã nhập ${result.books} sách, ${result.words} từ; bỏ qua ${result.skipped} dòng.`)
 })}
async function showClassJoin(token){let c;try{c=await api(`/classes/invite/${encodeURIComponent(token)}`)}catch(e){html(`${homeHeader()}<div class="center-stage">${empty('🔒','Lời mời không hợp lệ',e.message)}</div>`);return}
 html(`<div class="game-shell">${homeHeader()}<main class="center-stage"><div class="iconcircle" style="margin:0 auto 20px;width:70px;height:70px;font-size:32px">👩‍🏫</div><div class="eyebrow">THAM GIA LỚP HỌC</div><h1>${esc(c.name)}</h1><p>${esc(langName[c.language])} · Nhập biệt danh để ghi danh vào lớp.</p><form id="classJoin" class="card mt24"><label class="label" for="classNick">Biệt danh</label><input id="classNick" class="field nick-input mb16" minlength="2" maxlength="20" required autocomplete="off" placeholder="Tên của bạn"><button class="btn primary" style="width:100%">Tham gia lớp →</button></form></main></div>`);
 $('#classJoin').onsubmit=async e=>{e.preventDefault();try{await api(`/classes/invite/${encodeURIComponent(token)}/join`,'POST',{nickname:$('#classNick').value});html(`${homeHeader()}<div class="center-stage">${empty('🎉','Ghi danh thành công','Bạn đã tham gia lớp '+c.name+'. Giáo viên sẽ chia sẻ mã PIN khi tổ chức game.',nav('/','Trở về trang chủ','btn primary'))}</div>`)}catch(e){niceError(e)}};
}
async function showJoin(token){let s;try{s=await api('/public/session?token='+encodeURIComponent(token))}catch(e){html(`${homeHeader()}<main class="center-stage">${empty('🔒','Không thể tham gia',e.message,nav('/','Thử mã khác','btn primary'))}</main>`);return}
 const existing=sessionStorage.getItem('lx_player_'+s.id);
 if(existing){A.playerToken=existing;A.sid=s.id;A.host=false;try{let data=await api(`/play/${s.id}/state`,'GET',undefined,true);receiveLive(data);connectLive(s.id,'player');return}catch{sessionStorage.removeItem('lx_player_'+s.id);A.playerToken=null}}
 html(`<div class="game-shell">${homeHeader()}<main class="center-stage"><div class="eyebrow">✦ ĐẤU TRƯỜNG LEXIVERSE</div><div class="waiting-emoji">🎮</div><h1>Chuẩn bị vào trận!</h1><p>Bạn sắp tham gia <strong style="color:white">${esc(s.title)}</strong></p><div class="tagrow" style="justify-content:center"><span class="pill blue">PIN ${esc(s.pin)}</span><span class="pill">${s.count} thẻ từ</span>${badge(s.status)}</div><form class="card mt24" id="joinForm"><label class="label" for="nickInput">Bạn muốn được gọi là gì?</label><input id="nickInput" class="field nick-input" minlength="2" maxlength="20" required autocomplete="nickname" placeholder="Nhập biệt danh của bạn" aria-label="Biệt danh"><p class="sub mt12">Dùng biệt danh, không nhập thông tin cá nhân nhạy cảm.</p><button class="btn amber mt24" style="width:100%;font-size:16px">⚡ Vào sảnh chờ →</button></form><p class="sub mt24">Hãy chờ giáo viên bắt đầu. Không cần tài khoản.</p></main></div>`);
 $('#joinForm').onsubmit=async e=>{e.preventDefault();const btn=$('#joinForm button');btn.disabled=true;try{let r=await api('/public/join','POST',{token,nickname:$('#nickInput').value});A.playerToken=r.playerToken;sessionStorage.setItem('lx_player_'+s.id,r.playerToken);A.sid=s.id;A.host=false;let st=await api(`/play/${s.id}/state`,'GET',undefined,true);receiveLive(st);connectLive(s.id,'player')}catch(e){niceError(e)}finally{btn.disabled=false}};
}
async function showHost(sid){if(!A.user){showLanding();openLogin();return}
 A.sid=sid;A.host=true;const data=await api(`/sessions/${sid}`);receiveLive(data);connectLive(sid,'host');
}
function connectLive(sid,role){if(A.socket){A.socket.onclose=null;A.socket.close()};if(A.poll)clearInterval(A.poll);if(A.ticker){cancelAnimationFrame(A.ticker);A.ticker=null;}
 let protocol=location.protocol==='https:'?'wss:':'ws:';
 const conn=()=>{
  if(A.sid!==sid)return;
  let ws;try{ws=new WebSocket(`${protocol}//${location.host}/ws/sessions/${encodeURIComponent(sid)}`)}catch{return}
  A.socket=ws;ws.onopen=()=>{ws.send(JSON.stringify(role==='host'?{role:'host'}:{role:'player',playerToken:A.playerToken}));const el=$('#socketStatus');if(el)el.innerHTML='<span class="status-dot"></span> Đã kết nối';};
  ws.onmessage=ev=>{try{const event=JSON.parse(ev.data);if(event.type==='STATE')receiveLive(event.state)}catch(e){console.warn(e)}};
  ws.onclose=()=>{if(A.sid!==sid)return;const el=$('#socketStatus');if(el)el.innerHTML='<span class="status-dot offline"></span> Đang kết nối lại…';A.reconnectTimer=setTimeout(conn,2500)};
 };
 conn();
 A.poll=setInterval(async()=>{if(A.sid!==sid)return;try{let state=await api(role==='host'?`/sessions/${sid}`:`/play/${sid}/state`,'GET',undefined,role==='player');receiveLive(state)}catch(e){if(role==='player'&&String(e.message).includes('không còn hợp lệ')){disconnect();toast('Bạn đã rời phòng',true);goto('/')}}},4000);
 scheduleLiveAnimation();
}
function liveTop(isHost,s){return `<header class="game-top"><div class="brandline"><div class="brandmark">✦</div><span>LexiVerse <small style="font-size:11px;letter-spacing:0;font-weight:500">${isHost?'· Host':'· Player'}</small></span></div><div class="game-control"><span id="socketStatus" class="status-line"><span class="status-dot"></span> Đã kết nối</span><span class="pill blue">PIN ${esc(s.pin)}</span>${isHost?nav('/app/sessions','✕ Rời màn host','btn small ghost'):''}</div></header>`}
function alignLiveClock(s){
 if(!['LIVE','PAUSED'].includes(s.status)||!s.card)return;
 // The server's round start/end are authoritative. Use a monotonic device clock
 // for animation; do NOT change the clock baseline on every WebSocket/poll packet.
 const key=[s.id,s.index,s.roundStarted,s.roundEnds,s.status].join(':');
 if(A.liveClock?.key===key)return;
 const remain=s.status==='PAUSED'?s.pausedRemaining:Math.max(0,s.roundEnds-s.serverNow);
 A.liveClock={key,remaining:remain,at:performance.now(),lastRemain:remain};
 A.liveVisualRatio=Math.max(0,Math.min(1,1-remain/Math.max(1,s.durationMs)));
}
function scheduleLiveAnimation(){
 if(A.ticker)return;
 A.ticker=requestAnimationFrame(function frame(){
  A.ticker=null;
  if(!A.sid||!['LIVE','PAUSED'].includes(A.currentState?.status))return;
  updateClock();
  A.ticker=requestAnimationFrame(frame);
 });
}
function hostScoreRows(s){return s.standings.map((p,i)=>`<div class="scoreboard-row"><span>${i<3?['🥇','🥈','🥉'][i]:'#'+(i+1)} ${esc(p.nickname)}</span><strong>${p.score.toLocaleString('vi-VN')}</strong></div>`).join('')||'<p>Đang chờ người chơi...</p>'}
function receiveLive(s){
 if(!A.sid)A.sid=s.id;
 alignLiveClock(s);A.currentState=s;
 if(A.host){
  // Do not recreate the falling card when someone else submits an answer.
  const sig=[s.status,s.phase,s.index,s.locked,s.roster?.length].join('|');
  if(sig!==A.lastHostSig){A.lastHostSig=sig;renderHostView(s)}
  else{
   const score=$('#hostScoreboard');if(score)score.innerHTML=hostScoreRows(s);
   const count=$('#hostResponseCount');if(count)count.textContent=s.responseCount;
  }
 }else{
  // Preserve the input and the animated card across score-only notifications.
  const sig=[s.status,s.phase,s.index,Boolean(s.myAnswer),s.me?.score].join('|');
  if(sig!==A.lastPlayerSig){A.lastPlayerSig=sig;renderPlayerView(s)}
  else{const pt=$('#myScore');if(pt)pt.textContent=s.me?.score||0;}
  if(s.status==='LIVE'&&s.phase==='OPEN'&&s.card?.audio){
   const audioKey=s.id+':'+s.index;
   if(A.lastAudioKey!==audioKey){A.lastAudioKey=audioKey;replayAudio().catch(()=>{});}
  }
 }
 updateClock();scheduleLiveAnimation();
}
function renderHostView(s){let body='';
 if(s.status==='LOBBY'){
  body=`<div class="lobby-panel"><div class="eyebrow text-center">HOST LOBBY · CHỜ NGƯỜI CHƠI</div><h1 class="text-center">${esc(s.title)}</h1><p class="text-center">Người chơi mở camera, quét QR hoặc nhập PIN để tham gia.</p><div class="lobby-grid mt24"><div class="card text-center"><p class="eyebrow">QUÉT ĐỂ THAM GIA</p><div class="qr-box"><img src="/api/sessions/${encodeURIComponent(s.id)}/qr" alt="Mã QR tham gia phòng chơi"></div><div class="pin-number">${esc(s.pin)}</div><p class="sub">Mã PIN của phòng chơi</p><div class="button-row" style="justify-content:center">${action('🔗 Sao chép link','copy-join',s.id,'btn outline-cyan')}${action(s.locked?'🔓 Mở phòng':'🔒 Khóa phòng','lock',s.id,'btn ghost')}</div></div><div class="card"><div class="justify-between mb16"><h3>👥 Sảnh chờ <span class="pill good">${s.roster.filter(p=>!p.removed).length} người</span></h3><span class="pill">${s.count} từ</span></div><div class="lobby-names">${s.roster.filter(p=>!p.removed).map(p=>`<span class="chip">👤 ${esc(p.nickname)} ${action('×','kick',p.id,'btn small ghost')}</span>`).join('')||'<p class="sub">Chưa có người chơi. Mời học sinh vào bằng QR hoặc PIN.</p>'}</div><div class="button-row mt24">${action('🚀 BẮT ĐẦU TRÒ CHƠI','start',s.id,'btn primary',s.roster.every(x=>x.removed)?'disabled':'')}${action('Hủy phiên','end',s.id,'btn danger')}</div><p class="sub mt12">Chỉ giáo viên điều khiển phòng. Tất cả thiết bị bắt đầu đồng thời.</p></div></div></div>`;
 }else if(s.status==='LIVE'||s.status==='PAUSED'){
  body=`<div class="game-layout"><section class="game-main"><div class="justify-between wrap-mobile"><div><div class="eyebrow">HOST SCREEN</div><h2>${esc(s.title)}</h2></div><div class="game-control">${s.status==='PAUSED'?action('▶ Tiếp tục','resume',s.id,'btn primary'):action('⏸ Tạm dừng','pause',s.id,'btn ghost')}${action(s.locked?'🔓 Mở tham gia':'🔒 Khóa tham gia','lock',s.id,'btn ghost')}${action('■ Kết thúc','end',s.id,'btn danger')}</div></div>${arenaHtml(s,true)}<div class="grid grid-3 mt12"><div class="scoretile"><b>${s.roster.filter(x=>!x.removed).length}</b><small>Người chơi</small></div><div class="scoretile"><b id="hostResponseCount">${s.responseCount}</b><small>Đã trả lời</small></div><div class="scoretile"><b>${s.index+1}/${s.count}</b><small>Lượt hiện tại</small></div></div></section><aside class="card game-sidebar"><h3>🏆 Bảng điểm trực tiếp</h3><p class="sub">Điểm được máy chủ xác nhận.</p><div id="hostScoreboard">${hostScoreRows(s)}</div></aside></div>`;
 }else if(s.status==='RESULTS'){
  body=`<div class="lobby-panel"><div class="eyebrow text-center">GAME OVER · PODIUM</div><h1 class="text-center">🏆 Kết quả trận đấu</h1><p class="text-center">${esc(s.title)}</p><div class="podium">${s.standings.slice(0,3).map((p,i)=>`<div class="podium-item"><div class="rank-badge">${['🥇','🥈','🥉'][i]}</div><strong>${esc(p.nickname)}</strong><b>${p.score.toLocaleString('vi-VN')}</b><small>${p.correct_count} câu đúng</small></div>`).join('')}</div><div class="card"><div class="card-title"><h3>📋 Bảng xếp hạng đầy đủ</h3><span class="pill good">${s.standings.length} người</span></div>${s.standings.map(p=>`<div class="scoreboard-row"><span>#${p.rank} ${esc(p.nickname)} · ${p.correct_count} đúng</span><strong>${p.score.toLocaleString('vi-VN')}</strong></div>`).join('')}<div class="button-row mt24">${action('▤ Xem báo cáo chi tiết','report',s.id,'btn primary')}${action('⇩ Xuất CSV','csv',s.id,'btn ghost')}${nav('/app/sessions','Về dashboard','btn ghost')}</div></div></div>`;
 }else body=`<div class="center-stage">${empty('🛑','Phiên đã hủy','Bạn có thể tạo phòng mới bất cứ lúc nào.',nav('/app/sessions','Về danh sách phiên','btn primary'))}</div>`;
 html(`<div class="game-shell">${liveTop(true,s)}${body}</div>`);updateClock();
}
function arenaHtml(s,isHost=false){
 const card=s.card, percentage=s.count?((s.index+1)/s.count)*100:0;
 const label={spelling:'CHÍNH TẢ',reading:'CÁCH ĐỌC'}[card?.mode]||'TỪ VỰNG';
 const reveal=s.phase==='REVEAL', paused=s.status==='PAUSED';
 const shape=Array.isArray(card?.slotLengths)?card.slotLengths.filter(x=>Number.isInteger(x)&&x>=1&&x<=100):[];
 const slots=shape.length?shape.map(n=>`<span class="answer-slot-word">${Array.from({length:n},()=>'<span class="answer-slot"></span>').join('')}</span>`).join(''):'';
 return `<div class="arena arena-compact" id="gameArena"><div class="progress-top"><span>${Math.max(s.index+1,0)}/${s.count}</span><div class="meter"><span style="width:${percentage}%"></span></div><span>✦</span></div><div class="dangerline"></div>${card?`<div class="fall-card game-card" id="fallCard"><div class="timebar"><span id="fuseBar"></span></div><span class="label-dark card-mode-label">${label}</span>${card.audio?`<button class="card-sound" type="button" data-action="play-audio" title="Nghe lại câu hỏi" aria-label="Nghe lại câu hỏi">🔊</button>`:''}<div class="prompt-text">${esc(card.prompt)}</div><div class="question-underline answer-slots" aria-label="${shape.reduce((a,b)=>a+b,0)} ký tự cần nhập">${reveal?'✓':slots}</div>${reveal?`<div class="card-reveal"><span>Đáp án:</span> <strong>${esc(card.answer||'')}</strong></div>`:''}</div>`:''}${paused?'<div class="arena-overlay"><div><div class="waiting-emoji">⏸</div><h2>Tạm dừng</h2><p>Giáo viên sẽ tiếp tục trò chơi.</p></div></div>':''}</div>`;
}
function renderPlayerView(s){let me=s.me||{},htmlBody='';
 if(s.status==='LOBBY'){
  htmlBody=`<main class="center-stage"><div class="waiting-emoji">⏳</div><div class="eyebrow">ĐÃ VÀO SẢNH CHỜ</div><h1>Xin chào, ${esc(me.nickname)}!</h1><p>Bạn đang ở phòng <strong style="color:white">${esc(s.title)}</strong></p><div class="card mt24"><h2>🎉 Bạn đã sẵn sàng!</h2><p>Đang chờ giáo viên nhấn “Bắt đầu trò chơi”. Màn hình sẽ tự động chuyển khi cuộc thi bắt đầu.</p><div class="tagrow" style="justify-content:center"><span class="pill blue">PIN ${esc(s.pin)}</span><span class="pill warn">${s.count} thẻ từ</span></div></div></main>`;
 }else if(s.status==='LIVE'||s.status==='PAUSED'){
  let done=Boolean(s.myAnswer);
  htmlBody=`<div class="game-layout" style="max-width:1000px;grid-template-columns:minmax(0,1fr)"><section class="game-main"><div class="justify-between"><div><div class="eyebrow">⚡ PLAYER ARENA</div><h2>${esc(s.title)}</h2></div><div class="game-control"><span class="pill">👤 ${esc(me.nickname)}</span><span class="pill warn">⭐ <span id="myScore">${me.score}</span> PTS</span></div></div>${arenaHtml(s)}${!done?`<form class="answer-bar" id="answerForm"><input id="answerInput" class="field" type="text" inputmode="text" enterkeyhint="send" lang="${esc(s.card?.language||'en')}" maxlength="200" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Gõ câu trả lời..." aria-label="Nhập đáp án" ${s.status!=='LIVE'||s.phase!=='OPEN'?'disabled':''}><button class="btn amber" ${s.status!=='LIVE'||s.phase!=='OPEN'?'disabled':''}>Gửi ↵</button></form><div class="keyboard-toolbar"><button class="btn small ghost" type="button" data-action="focus-keyboard">⌨️ Mở / đổi bàn phím</button>${s.card?.language==='ja'?`<button class="btn small outline-cyan" type="button" data-action="toggle-kana">あ Kana trên web</button>`:''}<span class="keyboard-tip">${s.card?.language==='ja'?'Gõ Hiragana':s.card?.language==='zh-CN'?'Gõ Pinyin':'Gõ tiếng Anh'} · Đổi ngôn ngữ bằng phím 🌐 trên bàn phím điện thoại.</span></div>${s.card?.language==='ja'?`<div class="kana-pad ${A.kanaVisible?'':'hidden'}" id="kanaPad" aria-label="Bàn phím Hiragana trong website">${Array.from('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽっゃゅょー').map(k=>`<button type="button" class="kana-key" data-action="insert-kana" data-id="${k}">${k}</button>`).join('')}<button type="button" class="kana-key kana-control" data-action="erase-kana">⌫ Xóa</button></div>`:''}`:`<div class="compact-feedback ${s.myAnswer.correct?'is-good':'is-wrong'}" role="status"><strong>${s.myAnswer.correct?'✓ Chính xác!':'✓ Đã nhận đáp án'}</strong><span>${s.myAnswer.correct?'+'+s.myAnswer.points+' điểm':'Chờ kết quả lượt chơi'} · Chờ thẻ tiếp theo…</span></div>`}<div class="game-hint">⏱️ Thời gian và điểm được quyết định bởi máy chủ. Mỗi thẻ nộp một lần.</div></section></div>`;
 }else if(s.status==='RESULTS'){
  let rank=me.rank||'—';htmlBody=`<main class="center-stage"><div class="waiting-emoji">🏆</div><div class="eyebrow">HOÀN THÀNH TRÒ CHƠI</div><h1>Xuất sắc, ${esc(me.nickname)}!</h1><p>Bạn đã hoàn thành ${s.count} thẻ từ vựng.</p><div class="grid grid-3 mt24"><div class="card"><div class="stat-number" style="color:#ffc566">#${rank}</div><small>Xếp hạng</small></div><div class="card"><div class="stat-number">${me.score.toLocaleString('vi-VN')}</div><small>Điểm số</small></div><div class="card"><div class="stat-number">${me.correct}/${s.count}</div><small>Câu đúng</small></div></div><div class="card mt24"><h3>🏅 Bảng xếp hạng</h3>${(s.standings||[]).slice(0,10).map(p=>`<div class="scoreboard-row"><span>#${p.rank} ${esc(p.nickname)}</span><strong>${p.score.toLocaleString('vi-VN')}</strong></div>`).join('')}</div><div class="mt24">${nav('/','Về trang chủ','btn primary')}</div></main>`;
 }else htmlBody=`<main class="center-stage">${empty('🛑','Phiên đã kết thúc','Bạn có thể tham gia buổi chơi mới.',nav('/','Về trang chủ','btn primary'))}</main>`;
 html(`<div class="game-shell">${liveTop(false,s)}${htmlBody}</div>`);
 if($('#answerForm')){$('#answerForm').onsubmit=async ev=>{ev.preventDefault();const inp=$('#answerInput');const value=inp?.value.trim();if(!value)return;inp.disabled=true;try{let r=await api(`/play/${s.id}/answer`,'POST',{roundIndex:s.index,answer:value},true);let st=await api(`/play/${s.id}/state`,'GET',undefined,true);receiveLive(st)}catch(e){niceError(e);inp.disabled=false}};}
 updateClock();
}
function updateClock(){
 const s=A.currentState,clock=A.liveClock;
 if(!s||!clock||!['LIVE','PAUSED'].includes(s.status)||!s.card)return;
 const duration=Math.max(1,s.durationMs||12000);
 let remain=s.status==='PAUSED'?clock.remaining:Math.max(0,clock.remaining-(performance.now()-clock.at));
 remain=Math.min(clock.lastRemain,remain);clock.lastRemain=remain;
 const pct=Math.max(0,Math.min(100,100*remain/duration));
 const fuse=$('#fuseBar');if(fuse)fuse.style.width=pct+'%';
 const fc=$('#fallCard'),stage=$('#gameArena');if(!fc||!stage)return;
 // Progress only advances downwards during an open round, never backwards.
 if(s.phase==='OPEN')A.liveVisualRatio=Math.max(A.liveVisualRatio,1-pct/100);
 const ratio=s.phase==='REVEAL'?A.liveVisualRatio:Math.max(0,Math.min(1,A.liveVisualRatio));
 const start=Math.max(68,stage.clientHeight*.20);
 const end=Math.max(start,stage.clientHeight-fc.offsetHeight-18);
 fc.style.top=start+'px';
 fc.style.transform=`translate3d(-50%, ${(end-start)*ratio}px, 0)`;
}
async function showReport(sid){let r=await api(`/sessions/${sid}/report`);
 const participantRows=r.participants.map(p=>`<tr><td>#${p.rank}</td><td>${esc(p.nickname)}</td><td><strong>${p.score}</strong></td><td>${p.correct_count}</td><td>${Math.round(p.latency_total/1000)}s</td></tr>`).join('');
 const roundRows=r.rounds.map(round=>`<tr><td>${round.index}</td><td>${esc(round.term)}</td><td>${esc(round.mode)}</td><td>${round.correct}/${round.responseCount}</td><td>${round.accuracyPct}%</td></tr>`).join('');
 const details=`<div class="mb16"><span class="pill">${date(r.finishedAt)}</span><span class="pill">${r.participants.length} người</span></div><h3>Bảng điểm</h3><div class="table-wrap mb24"><table class="table"><thead><tr><th>Hạng</th><th>Biệt danh</th><th>Điểm</th><th>Đúng</th><th>Phản hồi</th></tr></thead><tbody>${participantRows}</tbody></table></div><h3>Chi tiết theo từ</h3><div class="table-wrap"><table class="table"><thead><tr><th>STT</th><th>Từ</th><th>Chế độ</th><th>Đúng</th><th>Tỉ lệ</th></tr></thead><tbody>${roundRows}</tbody></table></div><p class="sub mt12">Giáo viên có quyền xem chi tiết từng đáp án trong báo cáo JSON; người chơi không được truy cập API này.</p>`;
 modal('▤ Báo cáo · '+r.title,details,async()=>{});$('#modalForm .modalfoot').style.display='none';
}
async function downloadCsv(sid){let resp=await fetch(`/api/sessions/${sid}/report.csv`,{credentials:'same-origin'});if(!resp.ok)throw Error('Không tải được CSV');let blob=await resp.blob(),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='lexiverse-'+sid.slice(0,8)+'.csv';a.click();URL.revokeObjectURL(u)}
async function confirmTask(message,task){if(!window.confirm(message))return;await task();toast('Thao tác thành công');await render()}
async function handleAction(type,id,element){switch(type){
 case 'login':return openLogin();
 case 'practice-entry':if(A.user)return goto('/app/practice');A.postLogin='/app/practice';return openLogin();
 case 'practice-start':return startPractice(id,$('#practiceMode')?.value||'mixed',$('#practiceSpeed')?.value||'normal');
 case 'practice-again':return startPractice(A.practice?.lid,A.practice?.mode,A.practice?.speed);
 case 'practice-sound':return speakPractice();
 case 'practice-retry':return retryPractice();
 case 'practice-reset':return startPractice(A.practice?.lid,A.practice?.mode,A.practice?.speed);
 case 'practice-stop':return goto('/app/practice');
 case 'logout':return confirmTask('Đăng xuất khỏi LexiVerse?',async()=>{await api('/auth/logout','POST',{});A.user=null;goto('/')});
 case 'new-book':return bookForm();
 case 'edit-book':return bookForm(id);
 case 'delete-book':return confirmTask('Xóa sách và tất cả bài/từ? Báo cáo lịch sử vẫn được giữ.',()=>api(`/books/${id}`,'DELETE'));
 case 'new-lesson':return lessonForm(id);
 case 'edit-lesson':return lessonForm(A.activeBook?.id,id);
 case 'delete-lesson':return confirmTask('Xóa bài học và toàn bộ từ vựng?',()=>api(`/lessons/${id}`,'DELETE'));
 case 'new-word':return wordForm(id);
 case 'edit-word':return wordForm(A.activeLesson?.id,id);
 case 'delete-word':return confirmTask('Xóa từ vựng này?',()=>api(`/words/${id}`,'DELETE'));
 case 'new-class':return classForm();
 case 'edit-class':return classForm(id);
 case 'delete-class':return confirmTask('Xóa lớp học?',()=>api(`/classes/${id}`,'DELETE'));
 case 'members':return membersModal(id);
 case 'copy-class':{let c=(await getClasses()).find(x=>x.id===id);await navigator.clipboard.writeText(location.origin+'/class/'+c.invite_code);return toast('Đã sao chép liên kết mời lớp')}
 case 'reset-code':return confirmTask('Đổi mã mời sẽ làm link cũ mất hiệu lực. Tiếp tục?',async()=>{await api(`/classes/${id}/reset-invite`,'POST',{});$('#modal-root').innerHTML='';await membersModal(id)});
 case 'remove-member':{let [cid,mid]=id.split('|');return confirmTask('Loại thành viên này khỏi lớp?',async()=>{await api(`/classes/${cid}/members/${mid}`,'DELETE');$('#modal-root').innerHTML='';await membersModal(cid)})}
 case 'new-session':return newSession(id||null);
 case 'legacy-import':return importLegacy();
 case 'download-template':return downloadTemplate(id);
 case 'bulk-import':return bulkImportWords(id);
 case 'play-audio':return replayAudio();
 case 'focus-keyboard':{const input=$('#answerInput');if(input&&!input.disabled){input.focus({preventScroll:true});input.scrollIntoView({block:'nearest'});}return;}
 case 'toggle-kana':{A.kanaVisible=!A.kanaVisible;const pad=$('#kanaPad');if(pad)pad.classList.toggle('hidden',!A.kanaVisible);return;}
 case 'insert-kana':{const input=$('#answerInput');if(!input||input.disabled)return;const a=input.selectionStart??input.value.length,b=input.selectionEnd??a;input.value=input.value.slice(0,a)+id+input.value.slice(b);input.setSelectionRange(a+id.length,a+id.length);return;}
 case 'erase-kana':{const input=$('#answerInput');if(!input||input.disabled)return;const a=input.selectionStart??input.value.length,b=input.selectionEnd??a;const start=a===b?Math.max(0,a-1):a;input.value=input.value.slice(0,start)+input.value.slice(b);input.setSelectionRange(start,start);return;}
 case 'copy-join':{let data=await api(`/sessions/${id}`);await navigator.clipboard.writeText(location.origin+'/join/'+data.joinToken);return toast('Đã sao chép link phòng chơi')}
 case 'lock':{let s=A.currentState;await api(`/sessions/${id}/lock`,'POST',{locked:!s.locked});return refreshLive()}
 case 'kick':return confirmTask('Loại người chơi khỏi phòng? Tài khoản này sẽ không thể tiếp tục.',async()=>{await api(`/sessions/${A.sid}/kick/${id}`,'POST',{});await refreshLive()});
 case 'start':await api(`/sessions/${id}/start`,'POST',{});return refreshLive();
 case 'pause':await api(`/sessions/${id}/pause`,'POST',{});return refreshLive();
 case 'resume':await api(`/sessions/${id}/resume`,'POST',{});return refreshLive();
 case 'end':return confirmTask('Kết thúc phiên cho toàn bộ người chơi?',async()=>{await api(`/sessions/${id}/end`,'POST',{});await refreshLive()});
 case 'report':return showReport(id);
 case 'csv':return downloadCsv(id);
 default:return;
}}
async function refreshLive(){if(A.sid){let s=await api(`/sessions/${A.sid}`);receiveLive(s)}}
document.addEventListener('click',async ev=>{const node=ev.target.closest('[data-nav],[data-action]');if(!node)return;
 if(node.dataset.nav){ev.preventDefault();if(node.dataset.nav.startsWith('/static/')){location.href=node.dataset.nav;return}goto(node.dataset.nav);return;}
 if(node.dataset.action){ev.preventDefault();try{await handleAction(node.dataset.action,node.dataset.id||'',node)}catch(e){niceError(e)}}
});
initialize();
