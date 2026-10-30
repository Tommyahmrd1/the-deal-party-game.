/* THE DEAL — standalone mobile-first party game client */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const app = $('app');
const dialog = $('actionModal');
const socket = io({reconnection:true,reconnectionDelay:900,reconnectionDelayMax:4500,timeout:10000});
const EMOJIS = ['😎','🦊','🐼','🦁','🤖','🐯','👽','🐸','🐺','😈'];
let state=null;
let mode='create';
let name='';
let code='';
let avatar='😎';
let busy=false;
let soundOn=localStorage.getItem('thedeal_sound')!=='off';
let lastCountdown=null;
let lastRenderFingerprint='';
let serverDelta=0;
let activeModal=null;
let audio=null;
const money=v=>Number(v||0).toLocaleString('en-US');
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function key(){
  let token=localStorage.getItem('thedeal_player_token');
  if(!token || !/^[a-zA-Z0-9_-]{24,120}$/.test(token)){
    const random=new Uint8Array(32);crypto.getRandomValues(random);
    token=Array.from(random,x=>x.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('thedeal_player_token',token);
  }
  return token;
}
key();
const params=new URLSearchParams(location.search);
code=(params.get('room')||localStorage.getItem('thedeal_last_room')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
name=localStorage.getItem('thedeal_last_name')||'';
avatar=EMOJIS.includes(localStorage.getItem('thedeal_avatar'))?localStorage.getItem('thedeal_avatar'):'😎';
mode=params.has('room')?'join':'create';

function status(msg,err=false){
 const item=document.createElement('div');item.className='toast'+(err?' error':'');item.textContent=msg;
 $('toastArea').appendChild(item);setTimeout(()=>item.remove(),3500);
}
function buzz(type){
 if(!soundOn) return;
 try {
  audio=audio || new (window.AudioContext||window.webkitAudioContext)();
  if(audio.state==='suspended')audio.resume();
  const t=audio.currentTime;
  const note=(hz,when,len,shape='sine',volume=.05,to)=>{
   const o=audio.createOscillator(),v=audio.createGain();o.type=shape;
   o.frequency.setValueAtTime(hz,t+when);
   if(to)o.frequency.exponentialRampToValueAtTime(Math.max(20,to),t+when+len);
   v.gain.setValueAtTime(.001,t+when);
   v.gain.exponentialRampToValueAtTime(Math.max(.001,volume),t+when+.012);
   v.gain.exponentialRampToValueAtTime(.001,t+when+len);
   o.connect(v);v.connect(audio.destination);o.start(t+when);o.stop(t+when+len+.03);
  };
  if(type==='tap')note(580,0,.08,'sine',.03,410);
  if(type==='coin'){note(660,0,.13,'triangle',.07,950);note(1020,.12,.18,'sine',.06,1250);}
  if(type==='scan'){note(225,0,.47,'sawtooth',.035,780);note(880,.36,.16,'sine',.08,1300);}
  if(type==='win'){[523,659,784,1046].forEach((f,i)=>note(f,i*.13,.28,'triangle',.055));}
  if(type==='sale'){note(420,0,.09,'triangle',.05,640);note(790,.11,.16,'sine',.07,1080);}
  if(type==='reveal'){note(110,0,.54,'triangle',.08,70);note(550,.34,.25,'sawtooth',.03,1130);note(930,.6,.38,'sine',.07,1260);}
  if(type==='offer'){note(640,0,.07,'triangle',.04);note(860,.14,.12,'sine',.055);}
  if(type==='error')note(215,0,.22,'sawtooth',.035,120);
  if(type==='tick')note(500,0,.07,'sine',.035);
 } catch {/* sound is optional on older browsers */}
}
function send(event,payload={},onSuccess){
 if(!socket.connected){status('الاتصال بالسيرفر مقطوع، جرّب تاني.',true);return;}
 if(busy)return;
 busy=true;
 let done=false;
 const guard=setTimeout(()=>{if(done)return;done=true;busy=false;status('الطلب اتأخر. راجع اتصالك وحاول تاني.',true);},16000);
 socket.emit(event,payload,res=>{
  if(done)return;done=true;clearTimeout(guard);busy=false;
  if(!res?.ok){status(res?.message||'حصلت مشكلة، جرّب تاني.',true);buzz('error');return;}
  if(onSuccess)onSuccess(res);
 });
}
function chest(klass=''){
 return `<div class="chest ${klass}" aria-hidden="true"><div class="chest-top"></div><div class="chest-front"></div><div class="chest-side"></div><div class="chest-ribbon"></div><span class="chest-lock">🔒</span><span class="chest-shine">✦</span></div>`;
}
function renderLanding(){
 app.innerHTML=`<section class="landing-grid">
  <div class="landing-copy"><span class="kicker"><span class="spark">✦</span> BAR﻿TY GAME • تحدّي الصحاب</span>
   <h1>مين هيكسب<br><em>الصفـقــة؟</em> 🎁</h1>
   <p>صناديق غامضة، فلوس افتراضية، وكلام كله ثقة... أو كله نصب! بيع واشتري واتفاوض مع صحابك، بس محدش يعرف إيه اللي جوه الصندوق.</p>
   <div class="hero-tokens"><span class="mini-token">🧑‍🤝‍🧑 ٣–١٠ لاعبين</span><span class="mini-token">📱 كل واحد من موبايله</span><span class="mini-token">🎭 كدب مسموح!</span></div>
  </div>
  <div class="hero-art"><div class="hero-ring"></div><div class="hero-ring"></div><span class="floating-bit bit-a">💎</span><span class="floating-bit bit-b">💸</span><span class="floating-bit bit-c">🪙</span><span class="floating-bit bit-d">❔</span>${chest()}</div>
  <div class="panel landing-form" style="grid-column:1/-1;max-width:560px;width:100%;margin:0 auto">
   <div class="form-switcher"><button type="button" data-action="mode" data-mode="create" class="${mode==='create'?'active':''}">✦ اعمل قعدة</button><button type="button" data-action="mode" data-mode="join" class="${mode==='join'?'active':''}">↗ ادخل بكود</button></div>
   <div class="field"><label for="playerName">اسمك وسط الشلة</label><input id="playerName" data-field="name" maxlength="16" placeholder="مثلاً: تومي" value="${esc(name)}" autocomplete="nickname"></div>
   ${mode==='join'?`<div class="field"><label for="roomCodeInput">كود القعدة (6 حروف)</label><input id="roomCodeInput" data-field="code" maxlength="6" placeholder="ABC123" dir="ltr" style="text-align:center;text-transform:uppercase;letter-spacing:5px;font-weight:900" value="${esc(code)}"></div>`:''}
   <label>اختار شخصيتك</label><div class="avatar-picker">${EMOJIS.map(e=>`<button type="button" data-action="avatar" data-emoji="${e}" aria-label="شخصية ${e}" class="${avatar===e?'selected':''}">${e}</button>`).join('')}</div>
   <button class="btn primary full" data-action="submit" type="button">${mode==='create'?'🎲 أنشئ غرفة اللعب':'🚀 ادخل القعدة'}</button>
   <div class="decor-line">أو</div>
   <button class="btn outline full" data-action="demo" type="button">🤖 جرّب اللعبة مع 3 بوتات</button>
   <div class="form-foot">🔒 من غير تسجيل أو حساب • فلوس افتراضية فقط • صاحب القعدة لازم يفضل فاتح اللعبة</div>
  </div>
 </section><section class="steps-strip"><div class="step"><div class="step-icon">📦</div><b>1. خد صندوق</b><p>محدش عارف قيمته</p></div><div class="step"><div class="step-icon">🤝</div><b>2. بيع واتفاوض</b><p>أقنع صحابك يشتروا</p></div><div class="step"><div class="step-icon">💥</div><b>3. افتح واكسب</b><p>الأغنى يكسب الملك</p></div></section>`;
}
function player(p){return `<span class="face">${esc(p.emoji)}</span> ${esc(p.name)}`;}
function renderLobby(s){
 const seats=[...s.players];while(seats.length<Math.max(6,Math.min(10,s.players.length+2)))seats.push(null);
 const host=s.hostId===s.me.id;
 app.innerHTML=`<section class="lobby-wrap"><button class="backlink" data-action="leave">→ رجوع للرئيسية</button>
 <div class="lobby-header"><span class="kicker">✨ القعدة بتتجهّز</span><h1>اللمة ناقصها صحابك!</h1><p>ابعت الكود أو اللينك لأصحابك عشان يدخلوا من موبايلاتهم.</p></div>
 <div class="room-code-card"><div><small>كود الغرفة</small><div class="code">${esc(s.code)}</div></div><button class="btn accent" data-action="share">🔗 شارك اللينك</button></div>
 <div class="panel lobby-roster"><div class="section-title"><h2>🧑‍🤝‍🧑 اللي دخلوا القعدة</h2><div class="aside">${s.players.length}/10 لاعبين</div></div>
 <div class="roster">${seats.map(p=>`<div class="seat ${p?'occupied':'empty'}"><div class="face">${p?esc(p.emoji):'+'}</div><strong>${p?esc(p.name):'مستنيين لاعب'}</strong><small>${p?(p.host?'👑 صاحب القعدة':p.connected?'🟢 جاهز':'⚪ مفصول'):'اضغط مشاركة'}</small></div>`).join('')}</div></div>
 <div class="lobby-footer"><p>🎮 5 جولات — 105 ثانية لكل جولة — فرصتين لكشف الصناديق. اللعبة تبدأ من 3 لاعبين.</p>${host?`<button class="btn primary" data-action="start" ${s.players.length<3?'disabled':''}>🚀 ابدأ اللعبة (${s.players.length}/3)</button>`:`<span class="kicker">⏳ مستنيين صاحب القعدة يبدأ...</span>`}</div>
 <div class="panel rules-small"><b>إزاي نلعب؟</b><p>كل لاعب بيبدأ بـ ${money(1200)} كاش افتراضي وصندوق مقفول. يقدر يعرض صندوقه للبيع، يشتري صناديق غيره أو يبعت عرض سعر. معاك فرصتين أشعة طوال اللعبة لكشف قيمة صناديقك سرًا. في آخر كل جولة الصناديق بتتفتح، وقيمتها بتضاف لصاحبها الحالي — وممكن تطلع فخ! أعلى رصيد بعد 5 جولات يكسب.</p></div>
 </section>`;
}
function cardBox(b,s){
 const owner=s.players.find(p=>p.id===b.ownerId)||{name:'لاعب',emoji:'👤'};
 const mine=b.mine, peek=b.value!==null;
 const canPay=s.me.cash>=Number(b.listing?.price||0);
 const priceHtml=b.listing?`<div class="price-line"><span>🏷️ سعر البيع</span><b>${money(b.listing.price)} 💸</b></div>`:`<div class="price-line"><span>🔐 مش معروض للبيع</span><span>—</span></div>`;
 const actions=mine?
  `<button class="btn sm ${b.listing?'accent':'primary'}" data-action="list" data-box="${b.id}">${b.listing?'✏️ عدّل السعر':'💰 اعرض للبيع'}</button>${b.listing?`<button class="btn outline sm" data-action="unlist" data-box="${b.id}">إزالة</button>`:''}`:
  `<button class="btn sm ${b.listing?'mint':'outline'}" data-action="${b.listing?'buy':'bid'}" data-box="${b.id}" ${b.listing&&!canPay?'disabled':''}>${b.listing?'🛒 اشتري':'🤝 قدّم عرض'}</button>${b.listing?`<button class="btn sm outline" data-action="bid" data-box="${b.id}">فاوض</button>`:''}`;
 return `<article class="box-card ${mine?'my':''}">
  <div class="box-details"><div class="box-owner"><span class="face">${esc(owner.emoji)}</span><div><b>${esc(owner.name)}</b><small>${mine?'صندوقك الحالي':'صاحب الصندوق'}</small></div></div><span class="serial">#${esc(b.serial)}</span></div>
  <div class="mini-case ${peek?'open':''}"><span class="padlock">${peek?(b.kind==='curse'?'💀':b.kind==='empty'?'🫥':'💎'):'🔒'}</span></div>
  ${peek?`<div class="card-value ${b.value<0?'negative':''}">${b.value>0?'+':''}${money(b.value)} 💸</div>`:`<div class="card-value secret">❔ قيمة مجهولة</div>`}
  ${priceHtml}<div class="pitch" title="${esc(b.listing?.pitch||'')}">${b.listing?`“${esc(b.listing.pitch)}”`:'✦ تقدر تبعت عرض حتى لو مش للبيع'}</div>
  ${mine&&b.value===null&&s.me.scans>0?`<button class="btn mint sm full" style="margin-bottom:8px" data-action="scan" data-box="${b.id}">🔎 أشعة تكشف الحقيقة (${s.me.scans})</button>`:''}
  ${mine&&peek?`<div class="scan-indicator">👁️ السر عندك إنت بس — خد بالك!</div>`:''}
  <div class="box-actions">${actions}</div>
 </article>`;
}
function scoreboard(s){
 return [...s.players].sort((a,b)=>b.cash-a.cash).map((p,i)=>`<div class="leader-row ${p.id===s.me.id?'me':''}"><span class="rank">${i===0?'👑':i+1}</span><div class="identity"><span style="font-size:24px">${esc(p.emoji)}</span><div><b>${esc(p.name)}</b><small><i class="live-led ${!p.connected?'off':''}"></i> ${p.connected?'متصل':'غير متصل'}${p.bot?' • بوت':''}</small></div></div><strong class="money">${money(p.cash)}</strong></div>`).join('');
}
function reactionBar(){return `<div class="reaction-row">${['😂','😱','🔥','💸','🤡','👏'].map(e=>`<button class="reaction" data-action="react" data-emoji="${e}" type="button" aria-label="تفاعل ${e}">${e}</button>`).join('')}</div>`;}
function offerList(s){
 const pending=s.offers.filter(o=>o.status==='pending');
 if(!pending.length)return `<p style="font-size:11px;color:var(--muted)">لسه مفيش عروض خاصة. فاصل وكمل تفاوض 😎</p>`;
 return `<div class="offer-list">${pending.map(o=>{
  const incoming=o.toId===s.me.id;
  const other=s.players.find(p=>p.id===(incoming?o.fromId:o.toId));
  return `<div class="offer-item"><strong>${incoming?'📩 عرض جايلك':'📤 عرض بعته'}</strong><div>${incoming?'من':'إلى'} ${esc(other?.name||'لاعب')} • صندوق #${esc(o.serial)}</div><div><b>${money(o.amount)} 💸</b></div>${incoming?`<div class="btnrow"><button class="btn mint sm" data-action="accept" data-offer="${o.id}">✔ موافق</button><button class="btn outline sm" data-action="decline" data-offer="${o.id}">✕ ارفض</button></div>`:'<small class="muted">مستني الرد...</small>'}</div>`;
 }).join('')}</div>`;
}
function market(s){
 const mine=s.boxes.filter(b=>b.mine),other=s.boxes.filter(b=>!b.mine);
 app.innerHTML=`<div class="game-top"><div class="round-chip">🎲 الجولة ${s.round} <span style="color:#9d88bf">/ ${s.totalRounds}</span></div>
 <div class="wallet-chip">💸 رصيدك <b>${money(s.me.cash)}</b></div>
 <div class="room-chip"><span>غرفة <b dir="ltr">${esc(s.code)}</b></span><span class="timer" id="liveTimer">⏳ <strong id="countdown">--:--</strong></span><button class="btn ghost sm" data-action="share">🔗</button></div></div>
 <div class="game-layout"><div class="game-main">
 <div class="panel arena-head"><div class="arena-text"><span class="eyebrow">◉ السوق مفتوح — LET'S DEAL!</span><h1>اشتري صح... <span class="highlight">أو اتضحك عليك!</span></h1><p>اتفاوض مع أصحابك، وقول اللي إنت عايزه عن الصندوق — محدش ضامن الحقيقة 🤫</p><div class="bubbles"><span class="bubble">💰 رصيد البداية <strong>1,200</strong></span><span class="bubble">🔎 فرص الأشعة <strong>${s.me.scans}</strong></span><span class="bubble">🎁 ${s.boxes.length} صناديق</span></div></div><div class="arena-graphic">${chest()}</div></div>
 <div class="my-assets"><div class="section-title"><h2>💜 صناديقك ${mine.length?'('+mine.length+')':''}</h2><span class="aside">اعرف قيمتها لو عايز... بس بحساب!</span></div>${mine.length?`<div class="box-grid">${mine.map(b=>cardBox(b,s)).join('')}</div>`:`<div class="panel rules-small">بعت كل صناديقك! 💸 تقدر تشتري صندوق جديد من السوق تحت.</div>`}</div>
 <div class="section-title market-title"><h2>🔥 سوق الصناديق</h2><span class="aside">العروض بتتغير لحظيًا</span></div>
 ${other.length?`<div class="box-grid">${other.map(b=>cardBox(b,s)).join('')}</div>`:'<div class="panel rules-small">كل الصناديق عندك! 👑</div>'}
 <div class="panel rules-small"><b>📢 خلي بالك:</b> صندوق واحد ممكن يتباع أكتر من مرة قبل ما يفتح. الفلوس اللي بتدفعها بتروح للبائع، وقيمة الصندوق بتروح لصاحبه في نهاية الجولة. كل الأرقام افتراضية للّعب فقط.</div>
 </div><aside class="sidebar"><section class="panel side-card"><h3>🏆 الترتيب دلوقتي</h3>${scoreboard(s)}</section><section class="panel side-card"><h3>🤝 عروضك الخاصة ${s.offers.length?'('+s.offers.length+')':''}</h3>${offerList(s)}</section><section class="panel side-card"><h3>💬 اللي حصل في السوق</h3><div class="event-list">${s.events.slice(0,9).map(e=>`<div class="event ${esc(e.kind)}">${esc(e.text)}</div>`).join('')}</div></section><section class="panel side-card"><h3>🎉 رد فعل سريع</h3>${reactionBar()}</section></aside></div>
 <div style="margin:23px 0;display:flex;justify-content:center;gap:11px;align-items:center">${s.me.id===s.hostId?'<button class="btn ghost sm" data-action="next">⏭️ إنهاء آخر 15 ثانية</button>':''}<button class="btn ghost sm" data-action="leave">خروج</button></div>`;
 updateTimer();
}
function reveal(s){
 const current=s.history.find(h=>h.round===s.round)||{boxes:[],standings:[]};
 const sorted=[...current.boxes].sort((a,b)=>b.value-a.value);
 app.innerHTML=`<section class="reveal-wrap"><div class="game-top"><div class="round-chip">✨ نهاية الجولة ${s.round}/${s.totalRounds}</div><div class="wallet-chip">💸 رصيدك <b>${money(s.me.cash)}</b></div><div class="room-chip">الجولة الجاية بعد <span class="timer" id="liveTimer"><strong id="countdown">--:--</strong></span></div></div>
 <div class="reveal-banner"><span class="kicker">💥 الحقيقة ظهرت!</span><h1>الصناديق <span class="highlight">اتفتحت!</span></h1><p>اللي اشتريتوه بقى ملككم... يا مكسب يا خسارة 😂</p></div>
 <div class="reveal-results">${sorted.map((b,i)=>{const owner=s.players.find(p=>p.id===b.ownerId)||{};const neg=b.value<0;return `<div class="reveal-card ${b.ownerId===s.me.id?'mine':''}" style="animation-delay:${Math.min(i*0.08,.6)}s"><span class="prize-icon">${neg?'💀':b.value===0?'🫥':b.value>=1500?'💎':b.value>=700?'🏆':'🎁'}</span><small>الصندوق #${esc(b.serial)}</small><span class="num ${neg?'neg':''}">${b.value>0?'+':''}${money(b.value)}</span><b>${esc(b.label)}</b><small>بقى مع ${esc(owner.emoji||'👤')} ${esc(owner.name||'لاعب')}</small></div>`;}).join('')}</div>
 <div class="panel side-card" style="margin:18px 0"><h3>🏆 ترتيب ما بعد الجولة</h3>${scoreboard(s)}</div><div class="wait-next">⏳ ${s.round===s.totalRounds?'النتيجة النهائية قربت...':'استعد لجولة جديدة!'}<div style="margin:12px">${reactionBar()}</div>${s.hostId===s.me.id?'<button class="btn accent sm" data-action="next">التالي الآن ⏩</button>':''}</div></section>`;
 updateTimer();
}
function finalScreen(s){
 const standings=[...s.players].sort((a,b)=>b.cash-a.cash);
 const order=[standings[1],standings[0],standings[2]].filter(Boolean);
 app.innerHTML=`<section class="final-wrap"><span class="kicker">🎊 نهاية اللعبـة</span><h1>والملك المرة دي... <span class="highlight">${esc(standings[0]?.name||'')}!</span> 👑</h1><p class="muted">5 جولات من الصفقات والخدع والكنوز. مين ضحك على مين؟ 😂</p>
 <div class="podium">${order.map(p=>{const i=standings.indexOf(p);return `<div class="podium-card ${i===0?'first':''}"><div class="medal">${['🥇','🥈','🥉'][i]}</div><span class="bigface">${esc(p.emoji)}</span><span class="winner">${esc(p.name)}</span><span class="amount">${money(p.cash)} 💸</span><small class="muted">${i===0?'ملك الصفقات':i===1?'وصيف الصفقات':'المركز الثالث'}</small></div>`;}).join('')}</div>
 <div class="remaining-rows">${standings.slice(3).map((p,i)=>`<div class="leader-row"><span>${i+4}. ${esc(p.emoji)} ${esc(p.name)}</span><strong class="money">${money(p.cash)} 💸</strong></div>`).join('')||'<span class="muted">دي كل الشلة اللي لعبت!</span>'}</div>
 <div class="pills" style="justify-content:center"><span class="pill">🎁 5 جولات</span><span class="pill">🧑‍🤝‍🧑 ${s.players.length} لاعبين</span><span class="pill">🎭 خداع ومفاوضات</span></div>
 <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:11px;margin-top:25px">${s.hostId===s.me.id?`<button class="btn primary" data-action="restart">🔄 العبوا تاني</button>`:'<span class="kicker">⏳ صاحب القعدة يقدر يبدأ ماتش جديد</span>'}<button class="btn outline" data-action="leave">↩️ الرئيسية</button><button class="btn accent" data-action="share">🔗 ابعت للشلة</button></div>
 <p class="muted" style="font-size:11px;margin-top:25px">مفيش فلوس حقيقية — كلها نقاط لعب افتراضية.</p></section>`;
}
function render(){if(!state){renderLanding();return;}switch(state.phase){case 'lobby':renderLobby(state);break;case 'market':market(state);break;case 'reveal':reveal(state);break;case 'final':finalScreen(state);break;default:renderLanding();}}
function updateTimer(){
 if(!state?.endsAt)return;
 const c=$('countdown');if(!c)return;
 const diff=Math.max(0,Math.ceil((state.endsAt-(Date.now()+serverDelta))/1000));
 const n=Math.floor(diff/60),ss=diff%60;
 c.textContent=`${String(n).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
 $('liveTimer')?.classList.toggle('low',diff<=10);
 if(lastCountdown!==diff){if(diff>0 && diff<=5 && state.phase==='market')buzz('tick');lastCountdown=diff;}
}
setInterval(updateTimer,250);
function confetti(){
 for(let i=0;i<56;i++){
  const el=document.createElement('span');el.className='confetti';el.style.left=`${Math.random()*100}%`;
  el.style.backgroundColor=['#ff6c9b','#a57eff','#ffe086','#63dfdb','#e0dcff'][i%5];
  el.style.animationDelay=`${Math.random()*1.2}s`;el.style.animationDuration=`${2+Math.random()*2}s`;
  $('floatEmoji').appendChild(el);setTimeout(()=>el.remove(),4700);
 }
}
function emote(emoji){
 const el=document.createElement('span');el.className='floating-reaction';el.textContent=emoji;
 el.style.left=`${10+Math.random()*77}%`;$('floatEmoji').appendChild(el);setTimeout(()=>el.remove(),2100);
}
function shareLink(){
 if(!state)return;
 const url=`${location.origin}${location.pathname}?room=${encodeURIComponent(state.code)}`;
 if(navigator.share){navigator.share({title:'الصفقة — تعال العب معانا!',text:`ادخل غرفة الصفقة بكود ${state.code}`,url}).then(()=>buzz('tap')).catch(()=>{});}
 else if(navigator.clipboard?.writeText){navigator.clipboard.writeText(url).then(()=>status('اتنسخ لينك القعدة! ابعته لأصحابك 📋')).catch(()=>window.prompt('انسخ لينك القعدة:',url));}
 else window.prompt('انسخ لينك القعدة:',url);
}
function openDialog(kind,box){
 if(!state)return;
 const owner=state.players.find(p=>p.id===box?.ownerId)||{};
 activeModal={kind,boxId:box?.id};
 let html='',title='',subtitle='',submit='تأكيد';
 if(kind==='list'){
  title='اعرض صندوقك للبيع 💰';subtitle=`صندوق #${box.serial} • تقدر تقول أي حاجة عشان تقنع الشلة!`;submit=box.listing?'حدّث العرض':'انشر العرض';
  html=`<div class="field"><label for="dealPrice">السعر المطلوب (نقاط)</label><input id="dealPrice" inputmode="numeric" type="number" min="25" max="5000" required value="${box.listing?.price||650}"></div><div class="field"><label for="dealPitch">كلمة تقنع بيها صحابك 👀</label><input id="dealPitch" maxlength="85" placeholder="جواه مفاجأة... والله!" value="${esc(box.listing?.pitch||'')}" /></div><p class="modal-desc">⚠️ محدش يقدر يشوف القيمة الحقيقية غير لما تفتح الصناديق، أو تكشف صندوقك بالأشعة.</p>`;
 } else if(kind==='bid'){
  title='فاوض على الصندوق 🤝';subtitle=`صندوق #${box.serial} • بتقدّم عرض لـ ${owner.emoji||''} ${owner.name||''}`;submit='📤 ابعت العرض';
  html=`<div class="field"><label for="dealPrice">عرضك (حد أقصى ${money(state.me.cash)} نقطة)</label><input id="dealPrice" inputmode="numeric" type="number" min="25" max="${Math.min(5000,Math.max(25,state.me.cash))}" value="${Math.min(500,Math.max(25,state.me.cash))}" required></div><p class="modal-desc">صاحب الصندوق يقدر يوافق أو يرفض. متدفعش كتير في حاجة محدش عارفها!</p>`;
 } else if(kind==='buy'){
  title='متأكد من الصفقة؟ 🛒';subtitle=`بتشتري صندوق #${box.serial} من ${owner.emoji||''} ${owner.name||''}`;submit=`ادفع ${money(box.listing.price)} 💸`;
  html=`<div class="scan-indicator" style="font-size:20px;padding:20px">🔒 صندوق مقفول<br><b style="color:#fff">${money(box.listing.price)} نقطة</b></div><p class="modal-desc">هتدفع فلوسك الافتراضية للبائع فورًا، والصندوق هيبقى ملكك. ممكن يكسبك أو يخسرك!</p>`;
 }else if(kind==='rules'){
  title='قوانين الصفقة 🎲';subtitle='كلها نقاط افتراضية — مفيش فلوس حقيقية';submit='فهمت!';
  html=`<div class="rules-small" style="margin:0"><p>🎁 كل لاعب بياخد صندوق مقفول في بداية كل جولة.</p><p>💸 بيع صندوقك، اشتري من غيرك أو ابعت عرض سعر خاص.</p><p>🔎 معاك فرصتين أشعة لكل الماتش تكشف بيهم القيمة الحقيقية لصناديقك فقط.</p><p>😎 مسموح تتفاوض وتقول أي حاجة؛ قيم الصناديق بتفضل سرية.</p><p>⏰ في نهاية الجولة، كل صندوق بيتفتح وتتضاف قيمته لرصيد مالكه الحالي، وممكن القيمة تكون بالسالب.</p><p>🏆 بعد 5 جولات، صاحب أعلى رصيد يكسب.</p></div>`;
 }
 $('modalKicker').textContent=subtitle;
 $('modalTitle').textContent=title;
 $('modalContent').innerHTML=html;
 $('modalSubmit').textContent=submit;
 $('modalSubmit').style.display=kind==='rules'?'none':'';
 if(!dialog.open)dialog.showModal();
 const f=$('dealPrice');if(f)f.focus();
}
function closeDialog(){if(dialog.open)dialog.close();activeModal=null;}
function takeAction(button){
 const action=button.dataset.action;
 buzz('tap');
 if(action==='mode'){mode=button.dataset.mode;renderLanding();return;}
 if(action==='avatar'){avatar=button.dataset.emoji;localStorage.setItem('thedeal_avatar',avatar);renderLanding();return;}
 if(action==='submit'||action==='demo'){
  name=($('playerName')?.value||name).trim();code=($('roomCodeInput')?.value||code).trim().toUpperCase();
  if(name.length<2){status('اكتب اسمك الأول (حرفين على الأقل).',true);return;}
  if(action==='submit'&&mode==='join'&&!/^[A-Z0-9]{6}$/.test(code)){status('اكتب كود القعدة المكوّن من 6 حروف.',true);return;}
  localStorage.setItem('thedeal_last_name',name);
  const creating=action==='demo'||mode==='create';
  send(creating?'room:create':'room:join',{name,emoji:avatar,token:key(),...(creating?{demo:action==='demo'}:{code})},res=>{
   code=res.code;localStorage.setItem('thedeal_last_room',code);
   history.replaceState(null,'',location.pathname+'?room='+code);status('أهلًا بيك في الصفقة! 🎉');buzz('win');
  });
  return;
 }
 if(!state)return;
 if(action==='share'){shareLink();return;}
 if(action==='leave'){
  if(state.phase==='market'&&!confirm('متأكد إنك عايز تخرج من الجولة؟'))return;
  send('room:leave',{},()=>{state=null;localStorage.removeItem('thedeal_last_room');code='';mode='create';history.replaceState(null,'',location.pathname);renderLanding();});return;
 }
 if(action==='start'||action==='restart'){send('game:start',{},()=>{buzz('win');status('جاهزين! السوق هيفتح 🎲');});return;}
 if(action==='next'){send('game:next',{},()=>{});return;}
 if(action==='react'){socket.emit('room:emoji',{emoji:button.dataset.emoji},res=>{if(res&&!res.ok)status(res.message,true);});return;}
 const box=state.boxes.find(b=>b.id===button.dataset.box);
 if(action==='list'||action==='bid'||action==='buy'){if(box)openDialog(action,box);return;}
 if(action==='rules'){openDialog('rules');return;}
 if(action==='scan'){if(!box)return;send('box:scan',{boxId:box.id},res=>{buzz('scan');status(`الأشعة قالت: الصندوق ده قيمته ${money(res.value)} نقطة! 🔎`);});return;}
 if(action==='unlist'){if(box)send('box:unlist',{boxId:box.id},()=>status('اتشال عرض الصندوق من السوق.'));return;}
 if(action==='accept'||action==='decline'){send('offer:answer',{offerId:button.dataset.offer,accept:action==='accept'},()=>{if(action==='accept')buzz('sale');status(action==='accept'?'الصفقة تمت! 🤝':'رفضت العرض.');});return;}
}
app.addEventListener('click',e=>{const btn=e.target.closest('button[data-action]');if(btn)takeAction(btn);});
app.addEventListener('input',e=>{
 if(e.target.dataset.field==='name')name=e.target.value;
 if(e.target.dataset.field==='code')code=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
 if(e.target.dataset.field==='code')e.target.value=code;
});
$('modalClose').addEventListener('click',closeDialog);
$('modalCancel').addEventListener('click',closeDialog);
dialog.addEventListener('click',e=>{if(e.target===dialog)closeDialog();});
$('modalForm').addEventListener('submit',e=>{
 e.preventDefault();if(!activeModal||!state)return;
 const {kind,boxId}=activeModal;
 if(kind==='rules'){closeDialog();return;}
 const box=state.boxes.find(x=>x.id===boxId);if(!box){closeDialog();status('الصندوق مبقاش متاح.',true);return;}
 let evt,payload={boxId};
 if(kind==='list'){evt='box:list';payload.price=Number($('dealPrice')?.value);payload.pitch=$('dealPitch')?.value||'';}
 if(kind==='bid'){evt='offer:send';payload.amount=Number($('dealPrice')?.value);}
 if(kind==='buy')evt='box:buy';
 if(kind==='list'&&(!Number.isInteger(payload.price)||payload.price<25||payload.price>5000)){status('السعر من 25 إلى 5000.',true);return;}
 if(kind==='bid'&&(!Number.isInteger(payload.amount)||payload.amount<25||payload.amount>state.me.cash)){status('عرضك أكبر من رصيدك أو أقل من 25.',true);return;}
 send(evt,payload,()=>{closeDialog();buzz(kind==='buy'?'coin':kind==='list'?'sale':'offer');status(kind==='buy'?'مبروك! الصندوق بقى بتاعك 🔒':kind==='bid'?'اتبعت عرضك، استنى رد صاحب الصندوق. ✉️':'اتنشر عرض صندوقك في السوق! 💰');});
});
$('soundBtn').addEventListener('click',()=>{soundOn=!soundOn;localStorage.setItem('thedeal_sound',soundOn?'on':'off');$('soundBtn').textContent=soundOn?'🔊':'🔇';if(soundOn)buzz('coin');});
$('soundBtn').textContent=soundOn?'🔊':'🔇';
socket.on('connect',()=>{
 $('netText').textContent='متصل';$('netDot').classList.add('online');
 const saved=localStorage.getItem('thedeal_last_room');
 const directRoom=params.get('room');
 const last=state?.code || (saved && name.length>=2 && (!directRoom||directRoom===saved) ? saved : null);
 if(last){socket.emit('room:join',{code:last,name:name||'لاعب',emoji:avatar,token:key()},res=>{
  if(!res?.ok){if(state){status('لم نقدر نرجع للغرفة بعد قطع الاتصال.',true);state=null;}localStorage.removeItem('thedeal_last_room');renderLanding();}
 });}
 else if(!state)renderLanding();
});
socket.on('disconnect',()=>{$('netText').textContent='فصل الاتصال';$('netDot').classList.remove('online');status('الاتصال اتقطع... بنحاول نرجّعك.',true);});
socket.on('room:notice',t=>status(t,true));
socket.on('room:state',incoming=>{
 const prev=state;
 serverDelta=incoming.serverNow-Date.now();
 state=incoming;code=incoming.code;localStorage.setItem('thedeal_last_room',code);
 if(!prev||prev.phase!==incoming.phase||prev.round!==incoming.round){lastCountdown=null;}
 if(prev&&prev.phase!==incoming.phase){if(incoming.phase==='final'){buzz('win');confetti();}else if(incoming.phase==='reveal'){buzz('reveal');confetti();}else if(incoming.phase==='market')buzz('sale');}
 const signature=[incoming.code,incoming.phase,incoming.round,JSON.stringify(incoming.players),JSON.stringify(incoming.boxes),JSON.stringify(incoming.offers),incoming.events[0]?.id||''].join('|');
 if(signature!==lastRenderFingerprint){lastRenderFingerprint=signature;render();}
});
socket.on('room:emoji',data=>emote(data.emoji));
socket.on('room:fx',data=>{
 if(data.type==='sale'){buzz('coin');status(`${data.buyer} اشترى صندوق #${data.serial} بـ ${money(data.price)}! 💸`);}
 if(data.type==='offer'){buzz('offer');status('📩 جالك عرض على صندوقك!');}
 if(data.type==='win'&&state?.phase!=='final')confetti();
});
if(!state)renderLanding();
})();