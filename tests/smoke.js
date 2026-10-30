'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const crypto = require('node:crypto');
const PORT=3137, BASE=`http://127.0.0.1:${PORT}`;
const server=spawn(process.execPath,['server.js'],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,PORT:String(PORT),MARKET_SECONDS:'5',REVEAL_SECONDS:'2'},stdio:['ignore','pipe','pipe']});
server.stderr.on('data',b=>process.stderr.write(b));
class Client {
 constructor(){this.events=[];this.waiters=[];this.acks=new Map();this.index=0;this.ws=null;this.latest=null;}
 async connect(){this.ws=new WebSocket(`ws://127.0.0.1:${PORT}/ws`);await new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej;});this.ws.onmessage=e=>{
  const msg=JSON.parse(e.data);
  if(msg.ackId!==undefined){const fn=this.acks.get(msg.ackId);this.acks.delete(msg.ackId);if(fn)fn(msg.data);}
  else{this.events.push(msg);if(msg.event==='room:state')this.latest=msg.data;for(const w of [...this.waiters])if(w.event===msg.event&&w.test(msg.data)){this.waiters.splice(this.waiters.indexOf(w),1);w.resolve(msg.data);}}
 };}
 send(event,payload={}){return new Promise((resolve,reject)=>{const id=++this.index;this.acks.set(id,resolve);this.ws.send(JSON.stringify({event,payload,ackId:id}));setTimeout(()=>{if(this.acks.has(id)){this.acks.delete(id);reject(new Error(`Timeout ${event}`));}},3000);});}
 wait(event,test=()=>true,timeout=5000){const e=this.events.find(e=>e.event===event&&test(e.data));if(e)return Promise.resolve(e.data);return new Promise((resolve,reject)=>{const w={event,test,resolve};this.waiters.push(w);setTimeout(()=>{if(this.waiters.includes(w)){this.waiters.splice(this.waiters.indexOf(w),1);reject(new Error(`Wait timeout ${event}`));}},timeout);});}
 close(){this.ws?.close();}
}
(async()=>{
 let up=false;
 for(let i=0;i<35;i++){try{const r=await fetch(BASE+'/health');if(r.ok){up=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
 assert.ok(up,'Server started');
 const html=await (await fetch(BASE+'/')).text();assert.match(html,/الصفقة/);
 const js=await fetch(BASE+'/app.js');assert.equal(js.status,200);
 const clients=[new Client(),new Client(),new Client()];
 for(const c of clients)await c.connect();
 const ids=clients.map(()=>crypto.randomBytes(32).toString('hex'));
 const a=await clients[0].send('room:create',{name:'Tommy',emoji:'😎',token:ids[0]});assert.ok(a.ok);assert.match(a.code,/^[A-Z2-9]{6}$/);
 const b=await clients[1].send('room:join',{name:'Mona',emoji:'🐼',token:ids[1],code:a.code});assert.ok(b.ok);
 const c=await clients[2].send('room:join',{name:'Karim',emoji:'🦁',token:ids[2],code:a.code});assert.ok(c.ok);
 assert.equal(clients[0].latest.players.length,3,'All joined');
 await new Promise(r=>setTimeout(r,230));
 const start=await clients[0].send('game:start');assert.equal(start.ok,true);
 assert.equal(clients[0].latest.phase,'market');
 const initialBox=clients[0].latest.boxes.find(x=>x.mine);
 assert.ok(initialBox&&initialBox.value===null,'Hidden box value');
 const scam=await clients[0].send('box:scan',{boxId:initialBox.id});assert.equal(scam.ok,true);
 assert.equal(clients[0].latest.me.scans,1);
 const list=await clients[0].send('box:list',{boxId:initialBox.id,price:400,pitch:'صندوق فخم'});assert.equal(list.ok,true);
 assert.equal(clients[1].latest.boxes.find(x=>x.id===initialBox.id).value,null,'No leaked scanned value');
 const buy=await clients[1].send('box:buy',{boxId:initialBox.id});assert.equal(buy.ok,true);
 assert.equal(clients[1].latest.boxes.find(x=>x.id===initialBox.id).ownerId,ids[1]);
 await clients[0].wait('room:state',d=>d.me.cash===1600,1800);
 await clients[1].wait('room:state',d=>d.me.cash===800,1800);
 assert.equal(clients[0].latest.me.cash,1600);
 assert.equal(clients[1].latest.me.cash,800);
 const selfBuy=await clients[0].send('box:buy',{boxId:initialBox.id});assert.equal(selfBuy.ok,false);
 await clients[0].wait('room:state',d=>d.phase==='reveal',6500);
 assert.equal(clients[0].latest.phase,'reveal');
 assert.ok(clients[0].latest.boxes.every(x=>x.value!==null),'Reveal all');
 await clients[0].wait('room:state',d=>d.round===2&&d.phase==='market',3500);
 await clients[1].wait('room:state',d=>d.round===2&&d.phase==='market',3500);
 const box2=clients[1].latest.boxes.find(x=>x.mine);
 const offer=await clients[0].send('offer:send',{boxId:box2.id,amount:250});assert.equal(offer.ok,true);
 await clients[1].wait('room:state',d=>d.offers.some(o=>o.boxId===box2.id),2500);
 const offerId=clients[1].latest.offers.find(o=>o.boxId===box2.id)?.id;assert.ok(offerId);
 const accepted=await clients[1].send('offer:answer',{offerId,accept:true});assert.equal(accepted.ok,true);
 assert.equal(clients[0].latest.boxes.find(x=>x.id===box2.id).ownerId,ids[0]);
 console.log('✅ Smoke test passed: lobby, 3 devices, private scans, listings, purchase, offers, time transitions.');
 for(const x of clients)x.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{setTimeout(()=>server.kill('SIGTERM'),100);});