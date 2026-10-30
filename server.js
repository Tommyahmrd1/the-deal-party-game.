'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Server } = require('./lib/realtime');

const PORT = Number(process.env.PORT || 3000);
const MARKET_SECONDS = Math.max(5, Number(process.env.MARKET_SECONDS || 105));
const REVEAL_SECONDS = Math.max(2, Number(process.env.REVEAL_SECONDS || 13));
const TOTAL_ROUNDS = 5;
const START_CASH = 1200;
const MAX_PLAYERS = 10;
const publicDir = path.join(__dirname, 'public');

const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const webServer = http.createServer((req,res)=>{
  if(!req.url || !['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch {res.writeHead(400).end();return;}
  if(pathname === '/health'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true}));return;}
  const file = path.resolve(publicDir, '.' + (pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(publicDir+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404).end('Not found');return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
  if(req.method==='HEAD'){res.end();return;}
  fs.createReadStream(file).pipe(res);
});
const io = new Server(webServer);
const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMOJIS = ['😎','🦊','🐼','🦁','🤖','🐯','👽','🐸','🐺','😈'];
const PRIZES = [
  {value:-250,kind:'curse',label:'الفخّ',weight:4},
  {value:0,kind:'empty',label:'صندوق فاضي',weight:8},
  {value:100,kind:'small',label:'فكة',weight:11},
  {value:250,kind:'small',label:'مكسب بسيط',weight:13},
  {value:450,kind:'medium',label:'مكسب حلو',weight:17},
  {value:700,kind:'medium',label:'صفقة ناجحة',weight:16},
  {value:1000,kind:'big',label:'كنز',weight:14},
  {value:1500,kind:'big',label:'كنز كبير',weight:11},
  {value:2200,kind:'legend',label:'الجائزة الكبرى',weight:6}
];
const safeStr=(v,n)=>String(v??'').replace(/[<>\u0000-\u001F]/g,'').trim().slice(0,n);
const uid=()=>crypto.randomUUID();
const rand=n=>crypto.randomInt(n);
const randomCode=()=>Array.from({length:6},()=>ALPHABET[rand(ALPHABET.length)]).join('');
const choosePrize=()=>{const pool=PRIZES.reduce((a,x)=>a+x.weight,0);let d=rand(pool);return PRIZES.find(p=>((d-=p.weight)<0));};
const clock=()=>Date.now();
const playerById=(room,id)=>room.players.find(p=>p.id===id);
const myRoom=(socket)=>rooms.get(socket.data.code);
const myPlayer=(socket)=>myRoom(socket)&&playerById(myRoom(socket),socket.data.playerId);
function event(room,text,kind='news'){
  room.events.unshift({id:uid(),text:safeStr(text,140),kind,at:clock()});
  room.events=room.events.slice(0,24);
}
function pushState(room){
  for(const p of room.players){
    if(!p.socketId)continue;
    const allBoxes=room.boxes.map(b=>({
      id:b.id,serial:b.serial,ownerId:b.ownerId,
      originalOwnerId:b.originalOwnerId,
      listing:b.listing,
      mine:b.ownerId===p.id,
      value:(room.phase==='reveal'||room.phase==='final'||b.peekedBy.includes(p.id))?b.prize.value:null,
      prizeLabel:(room.phase==='reveal'||room.phase==='final'||b.peekedBy.includes(p.id))?b.prize.label:null,
      kind:(room.phase==='reveal'||room.phase==='final'||b.peekedBy.includes(p.id))?b.prize.kind:null,
      soldCount:b.soldCount
    }));
    io.to(p.socketId).emit('room:state',{
      code:room.code,phase:room.phase,round:room.round,totalRounds:TOTAL_ROUNDS,
      endsAt:room.endsAt,serverNow:clock(),hostId:room.hostId,demo:room.demo,
      me:{id:p.id,name:p.name,emoji:p.emoji,cash:p.cash,scans:p.scans,connected:p.connected},
      players:room.players.map(x=>({id:x.id,name:x.name,emoji:x.emoji,cash:x.cash,connected:x.connected,bot:x.bot,host:x.id===room.hostId})),
      boxes:allBoxes,
      offers:room.offers.filter(o=>o.status==='pending'&&(o.fromId===p.id||o.toId===p.id)).map(o=>({...o})),
      events:room.events, history:room.history.slice(-3),
      minPlayers:3
    });
  }
}
function createPlayer(id,name,emoji,socketId,bot=false){return {id,name,emoji,socketId,connected:true,bot,cash:START_CASH,scans:2};}
function bind(socket,room,p){
  if(p.socketId&&p.socketId!==socket.id){io.to(p.socketId).emit('room:notice','اتفتحت اللعبة من جهاز تاني.');io.sockets.sockets.get(p.socketId)?.leave(room.code);}
  p.socketId=socket.id;p.connected=true;
  socket.data.code=room.code;socket.data.playerId=p.id;
  socket.join(room.code);
}
function tokenOK(token){return typeof token==='string' && token.length>=24&&token.length<=120&&/^[a-zA-Z0-9_-]+$/.test(token);}
function roomOfCode(raw){return rooms.get(safeStr(raw,6).toUpperCase());}
function haveValidAct(socket,phases=['market']){
  const r=myRoom(socket), p=myPlayer(socket);
  if(!r||!p||!phases.includes(r.phase)||p.bot||p.socketId!==socket.id)return [null,null,'الإجراء مش متاح دلوقتي.'];
  return [r,p,null];
}
function response(cb,err,data){if(typeof cb==='function')cb(err?{ok:false,message:err}:{ok:true,...data});}
function checkThrottle(socket){const now=clock(); if((socket.data.lastAction||0)+180>now)return false;socket.data.lastAction=now;return true;}
function startGame(room){
  room.phase='market';room.round=0;room.history=[];room.events=[];room.offers=[];
  for(const p of room.players){p.cash=START_CASH;p.scans=2;}
  startRound(room);
}
function startRound(room){
  room.round++;room.phase='market';room.endsAt=clock()+MARKET_SECONDS*1000;room.offers=[];
  room.boxes=room.players.map((p,i)=>({id:uid(),serial:String((room.round*10)+(i+1)).padStart(2,'0'),ownerId:p.id,originalOwnerId:p.id,prize:choosePrize(),peekedBy:[],listing:null,soldCount:0}));
  event(room,`بدأت الجولة ${room.round}! الصناديق مقفولة... مين هيعمل أحسن صفقة؟`,'round');
  pushState(room);
  if(room.demo)activateBots(room);
}
function settleRound(room){
  if(room.phase!=='market')return;
  room.phase='reveal';room.endsAt=clock()+REVEAL_SECONDS*1000;
  for(const b of room.boxes){const p=playerById(room,b.ownerId); if(p)p.cash+=b.prize.value;}
  room.history.push({round:room.round,boxes:room.boxes.map(b=>({serial:b.serial,ownerId:b.ownerId,originalOwnerId:b.originalOwnerId,value:b.prize.value,kind:b.prize.kind,label:b.prize.label})),standings:room.players.map(p=>({id:p.id,cash:p.cash})).sort((a,b)=>b.cash-a.cash)});
  event(room,'اتفتحت الصناديق! 🎁 شوفوا مين كسب ومين اتنصب عليه!','reveal');
  io.to(room.code).emit('room:fx',{type:'reveal'});
  pushState(room);
}
function nextStage(room){
  if(room.phase==='market')return settleRound(room);
  if(room.phase==='reveal'){
    if(room.round>=TOTAL_ROUNDS){room.phase='final';room.endsAt=0;room.offers=[];event(room,'انتهت اللعبة! مبروك لصاحب أكبر ثروة 👑','win');pushState(room);io.to(room.code).emit('room:fx',{type:'win'});}
    else startRound(room);
  }
}
function transfer(room,box,buyer,price){
  const seller=playerById(room,box.ownerId);
  if(!seller||buyer.id===seller.id||buyer.cash<price)return 'مش ممكن تتم الصفقة. راجع رصيدك.';
  buyer.cash-=price;seller.cash+=price;
  box.ownerId=buyer.id;box.listing=null;box.soldCount++;
  for(const o of room.offers){if(o.boxId===box.id&&o.status==='pending')o.status='cancelled';}
  event(room,`${buyer.emoji} ${buyer.name} اشترى صندوق #${box.serial} من ${seller.name} بـ ${price.toLocaleString('en-US')} 💸`,'sale');
  io.to(room.code).emit('room:fx',{type:'sale',buyer:buyer.name,seller:seller.name,price,serial:box.serial});
  pushState(room);
  return null;
}
function botPlayer(room,name,emoji){const p=createPlayer('bot-'+uid(),name,emoji,null,true);room.players.push(p);return p;}
function activateBots(room){
  for(const p of room.players.filter(x=>x.bot)){
    const t=4000+rand(7000);
    setTimeout(()=>{
      if(rooms.get(room.code)!==room||room.phase!=='market')return;
      const owned=room.boxes.filter(b=>b.ownerId===p.id);
      if(owned.length){const b=owned[rand(owned.length)];b.listing={price:[300,500,750,950,1200,1600][rand(6)],pitch:['صندوق مضمون 100% 😉','عرض مش هيتكرر','اللي هيشتريه مش هيندم 💎','أنا مش هقولك إيه جواه 👀','السعر لقطة يا جماعة'][rand(5)]};event(room,`${p.name} نزل صندوق #${b.serial} للبيع`,'list');pushState(room);}
    },t);
    const t2=16000+rand(19000);
    setTimeout(()=>{
      if(rooms.get(room.code)!==room||room.phase!=='market')return;
      const items=room.boxes.filter(b=>b.ownerId!==p.id&&b.listing&&b.listing.price<=Math.min(p.cash,1100));
      if(items.length&&rand(100)<75){const b=items[rand(items.length)];transfer(room,b,p,b.listing.price);}
    },t2);
  }
  setTimeout(()=>{
    if(rooms.get(room.code)!==room||room.phase!=='market')return;
    const botOffers=room.offers.filter(o=>o.status==='pending'&&playerById(room,o.toId)?.bot);
    for(const o of botOffers){const b=room.boxes.find(b=>b.id===o.boxId),buyer=playerById(room,o.fromId);if(b&&buyer&&b.ownerId===o.toId&&buyer.cash>=o.amount){if(o.amount>=420||rand(100)<35){o.status='accepted';transfer(room,b,buyer,o.amount);}else o.status='declined';}}
    pushState(room);
  },23000);
}

io.on('connection',socket=>{
  socket.on('room:create',(payload={},cb)=>{
    if(!checkThrottle(socket))return response(cb,'جرّب تاني بعد لحظة.');
    const name=safeStr(payload.name,16), token=payload.token, emoji=EMOJIS.includes(payload.emoji)?payload.emoji:'😎';
    if(name.length<2)return response(cb,'اكتب اسم من حرفين على الأقل.');
    if(!tokenOK(token))return response(cb,'تعذر تأكيد الجهاز. حدّث الصفحة.');
    if(rooms.size>500)return response(cb,'السيرفر مشغول، جرّب كمان شوية.');
    let code;do{code=randomCode();}while(rooms.has(code));
    const p=createPlayer(token,name,emoji,socket.id);
    const r={code,hostId:p.id,players:[p],boxes:[],offers:[],history:[],events:[],phase:'lobby',round:0,endsAt:0,demo:!!payload.demo,createdAt:clock(),lastSeen:clock()};
    rooms.set(code,r);bind(socket,r,p);
    if(r.demo){botPlayer(r,'فوفو','🦊');botPlayer(r,'مستر إكس','🤖');botPlayer(r,'لولو','🐼');startGame(r);}
    else {event(r,`${p.name} أنشأ القعدة. لمّوا الشلة!`,'join');pushState(r);}
    response(cb,null,{code});
  });
  socket.on('room:join',(payload={},cb)=>{
    if(!checkThrottle(socket))return response(cb,'جرّب تاني بعد لحظة.');
    const r=roomOfCode(payload.code),token=payload.token;
    if(!r)return response(cb,'كود الغرفة مش موجود. اتأكد من الكود.');
    if(!tokenOK(token))return response(cb,'تعذر تأكيد الجهاز. حدّث الصفحة.');
    let p=playerById(r,token);
    if(!p){
      if(r.phase!=='lobby')return response(cb,'الجولة بدأت! مش ممكن تدخل كلاعب جديد دلوقتي.');
      if(r.players.length>=MAX_PLAYERS)return response(cb,'الغرفة كاملة (10 لاعبين).');
      const name=safeStr(payload.name,16);
      if(name.length<2)return response(cb,'اكتب اسم من حرفين على الأقل.');
      if(r.players.some(x=>x.name===name))return response(cb,'الاسم ده موجود، اختار اسم تاني.');
      const emoji=EMOJIS.includes(payload.emoji)?payload.emoji:'😎';
      p=createPlayer(token,name,emoji,socket.id);r.players.push(p);
      event(r,`${emoji} ${name} دخل القعدة!`,'join');
    }
    bind(socket,r,p);r.lastSeen=clock();pushState(r);response(cb,null,{code:r.code});
  });
  socket.on('room:leave',(payload={},cb)=>{
    const r=myRoom(socket),p=myPlayer(socket);
    if(!r||!p)return response(cb,null,{});
    socket.leave(r.code);
    if(r.phase==='lobby'){r.players=r.players.filter(x=>x.id!==p.id);if(r.hostId===p.id)r.hostId=r.players[0]?.id;event(r,`${p.name} خرج من الغرفة`,'join');if(r.players.length===0)rooms.delete(r.code);}
    else {p.connected=false;p.socketId=null;event(r,`${p.name} خرج مؤقتًا`,'join');}
    delete socket.data.code;delete socket.data.playerId;pushState(r);response(cb,null,{});
  });
  socket.on('game:start',(payload,cb)=>{
    const [r,p,err]=haveValidAct(socket,['lobby','final']);if(err)return response(cb,err);
    if(p.id!==r.hostId)return response(cb,'صاحب الغرفة بس يقدر يبدأ.');
    if(r.players.filter(x=>x.connected).length<3)return response(cb,'محتاجين 3 لاعبين على الأقل. جرّب طور البوتات لو لوحدك.');
    if(!checkThrottle(socket))return response(cb,'استنى لحظة.');
    startGame(r);io.to(r.code).emit('room:fx',{type:'start'});response(cb,null,{});
  });
  socket.on('box:scan',(payload={},cb)=>{
    const [r,p,err]=haveValidAct(socket);if(err)return response(cb,err);
    const b=r.boxes.find(x=>x.id===payload.boxId);
    if(!b||b.ownerId!==p.id)return response(cb,'الصندوق ده مش بتاعك.');
    if(b.peekedBy.includes(p.id))return response(cb,'أنت كشفت الصندوق ده بالفعل.');
    if(p.scans<=0)return response(cb,'خلصت فرص الأشعة بتاعتك.');
    p.scans--;b.peekedBy.push(p.id);pushState(r);response(cb,null,{value:b.prize.value});
  });
  socket.on('box:list',(payload={},cb)=>{
    const [r,p,err]=haveValidAct(socket);if(err)return response(cb,err);
    const b=r.boxes.find(x=>x.id===payload.boxId);
    if(!b||b.ownerId!==p.id)return response(cb,'الصندوق مبقاش بتاعك.');
    const price=Number(payload.price);
    if(!Number.isInteger(price)||price<25||price>5000)return response(cb,'السعر لازم يبقى من 25 إلى 5000.');
    const pitch=safeStr(payload.pitch,85)||'مش هقولك إيه جواه... 😉';
    b.listing={price,pitch};event(r,`${p.name} عرض صندوق #${b.serial} للبيع بـ ${price} 💰`,'list');pushState(r);response(cb,null,{});
  });
  socket.on('box:unlist',(payload={},cb)=>{
    const [r,p,err]=haveValidAct(socket);if(err)return response(cb,err);
    const b=r.boxes.find(x=>x.id===payload.boxId);
    if(!b||b.ownerId!==p.id)return response(cb,'مش صندوقك.');
    b.listing=null;pushState(r);response(cb,null,{});
  });
  socket.on('box:buy',(payload={},cb)=>{
    const [r,p,err]=haveValidAct(socket);if(err)return response(cb,err);
    const b=r.boxes.find(x=>x.id===payload.boxId);
    if(!b||!b.listing||b.ownerId===p.id)return response(cb,'الصفقة دي مش متاحة.');
    const error=transfer(r,b,p,b.listing.price);
    response(cb,error,{});
  });
  socket.on('offer:send',(payload={},cb)=>{
    const [r,p,err]=haveValidAct(socket);if(err)return response(cb,err);
    const b=r.boxes.find(x=>x.id===payload.boxId);
    if(!b||b.ownerId===p.id)return response(cb,'مينفعش تعمل عرض على صندوقك.');
    const amount=Number(payload.amount);
    if(!Number.isInteger(amount)||amount<25||amount>5000||amount>p.cash)return response(cb,'العرض لازم يبقى من 25 إلى 5000 وفي حدود رصيدك.');
    if(r.offers.filter(o=>o.fromId===p.id&&o.status==='pending').length>=5)return response(cb,'عندك 5 عروض معلّقة.');
    const duplicate=r.offers.find(o=>o.fromId===p.id&&o.boxId===b.id&&o.status==='pending');
    if(duplicate){duplicate.amount=amount;duplicate.createdAt=clock();}
    else r.offers.push({id:uid(),fromId:p.id,toId:b.ownerId,boxId:b.id,serial:b.serial,amount,status:'pending',createdAt:clock()});
    const target=playerById(r,b.ownerId);
    const currentOffer=r.offers.find(o=>o.fromId===p.id&&o.boxId===b.id&&o.status==='pending');
    pushState(r);
    if(target?.bot && currentOffer){
      const offerId=currentOffer.id;
      setTimeout(()=>{
        if(rooms.get(r.code)!==r||r.phase!=='market')return;
        const o=r.offers.find(x=>x.id===offerId&&x.status==='pending');
        const box=o&&r.boxes.find(x=>x.id===o.boxId);
        const buyer=o&&playerById(r,o.fromId);
        if(!o||!box||box.ownerId!==o.toId||!buyer||buyer.cash<o.amount)return;
        if(o.amount>=550 || rand(100)<35){o.status='accepted';transfer(r,box,buyer,o.amount);}
        else{o.status='declined';pushState(r);}
      },1400+rand(1900));
    } else if(target?.socketId)io.to(target.socketId).emit('room:fx',{type:'offer'});
    response(cb,null,{});
  });
  socket.on('offer:answer',(payload={},cb)=>{
    const [r,p,err]=haveValidAct(socket);if(err)return response(cb,err);
    const o=r.offers.find(x=>x.id===payload.offerId && x.status==='pending');
    if(!o||o.toId!==p.id)return response(cb,'العرض مش موجود أو انتهى.');
    if(payload.accept!==true){o.status='declined';pushState(r);return response(cb,null,{});}
    const b=r.boxes.find(x=>x.id===o.boxId),buyer=playerById(r,o.fromId);
    if(!b||b.ownerId!==p.id||!buyer||buyer.cash<o.amount){o.status='cancelled';pushState(r);return response(cb,'الصفقة انتهت أو المشتري معهوش رصيد كفاية.');}
    o.status='accepted';const error=transfer(r,b,buyer,o.amount);response(cb,error,{});
  });
  socket.on('game:next',(payload={},cb)=>{
    const [r,p,err]=haveValidAct(socket,['market','reveal']);if(err)return response(cb,err);
    if(p.id!==r.hostId)return response(cb,'صاحب القعدة بس اللي يقدر يعدّي الجولة.');
    if(r.phase==='market'&&r.endsAt-clock()>15000)return response(cb,'استنى لآخر 15 ثانية قبل ما تخلّص الجولة بدري.');
    nextStage(r);response(cb,null,{});
  });
  socket.on('room:emoji',(payload={},cb)=>{
    const [r,p,err]=haveValidAct(socket,['market','reveal']);if(err)return response(cb,err);
    if(!['😂','😱','🔥','💸','🤡','👏'].includes(payload.emoji))return response(cb,'إيموجي غير متاح.');
    if((socket.data.lastEmoji||0)+1500>clock())return response(cb,'استنى شوية 😄');
    socket.data.lastEmoji=clock();io.to(r.code).emit('room:emoji',{from:p.name,emoji:payload.emoji,id:uid()});response(cb,null,{});
  });
  socket.on('disconnect',()=>{
    const r=myRoom(socket),p=myPlayer(socket);if(!r||!p||p.socketId!==socket.id)return;
    p.connected=false;p.socketId=null;r.lastSeen=clock();
    if(r.hostId===p.id){const next=r.players.find(x=>x.connected&&!x.bot);if(next)r.hostId=next.id;}
    pushState(r);
  });
});
setInterval(()=>{
  for(const [code,r] of rooms){
    if(r.endsAt && clock()>=r.endsAt && ['market','reveal'].includes(r.phase))nextStage(r);
    const empty=r.players.every(p=>p.bot||!p.connected);
    if(empty && clock()-r.lastSeen>20*60*1000)rooms.delete(code);
    if(clock()-r.createdAt>7*60*60*1000)rooms.delete(code);
  }
},500).unref();
webServer.listen(PORT,'0.0.0.0',()=>console.log(`THE DEAL game is running on http://localhost:${PORT}`));
module.exports={webServer,rooms};