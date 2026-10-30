'use strict';
const assert = require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const {EventEmitter}=require('node:events');
const path=require('node:path');
const peers=new Map();let idCount=0;
function Peer(name){
  this.id=name||'anonymous-'+(++idCount);this.destroyed=false;this.emitter=new EventEmitter();this.on=(n,fn)=>{this.emitter.on(n,fn);return this;};
  this.reconnect=()=>setTimeout(()=>this.emitter.emit('open',this.id),2);
  this.destroy=()=>{peers.delete(this.id);this.destroyed=true;};
  this.connect=(to)=>{
   const link={}; const a=connection(this,to,link), b=connection(null,this.id,link);
   link.a=a;link.b=b;
   setTimeout(()=>{const remote=peers.get(to);if(!remote){this.emitter.emit('error',{type:'peer-unavailable'});return;}b.owner=remote;remote.emitter.emit('connection',b);setTimeout(()=>{a.open=b.open=true;a.events.emit('open');b.events.emit('open');},12);},5);
   return a;
  };
  peers.set(this.id,this);setTimeout(()=>this.emitter.emit('open',this.id),8);
}
function connection(owner,to,link){const e=new EventEmitter();return {owner,to,link,events:e,open:false,
 on:(n,fn)=>{e.on(n,fn);},send(data){const other=link.a===this?link.b:link.a;setTimeout(()=>other.events.emit('data',JSON.parse(JSON.stringify(data))),3);},
 close(){this.open=false;this.events.emit('close');const other=link.a===this?link.b:link.a;if(other.open){other.open=false;other.events.emit('close');}}
};}
function device(){
 const storage=new Map(),window={Peer,crypto};const ctx=vm.createContext({window,crypto,setTimeout,clearTimeout,setInterval,console,Map,Date,Math,Number,String,JSON,Array,Uint32Array,Boolean,Promise});
 const engine=fs.readFileSync(path.join(__dirname,'../public/engine-p2p.js'),'utf8');
 const client=fs.readFileSync(path.join(__dirname,'../public/p2p-client.js'),'utf8');
 vm.runInContext(engine,ctx);vm.runInContext(client,ctx);const api=window.io();let latest;api.on('room:state',s=>latest=s);
 return {api,get latest(){return latest;}};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function emit(dev,name,payload){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout '+name)),3500);dev.api.emit(name,payload,(r)=>{clearTimeout(timer);resolve(r);});});}
(async()=>{
 const [a,b,c]=[device(),device(),device()];
 await wait(70);assert(a.api.connected&&b.api.connected&&c.api.connected);
 const ids=Array.from({length:3},()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
 const host=await emit(a,'room:create',{name:'تومي',token:ids[0],emoji:'😎'});assert(host.ok,JSON.stringify(host));
 const jr=await Promise.all([emit(b,'room:join',{name:'سليم',code:host.code,token:ids[1],emoji:'🦊'}),emit(c,'room:join',{name:'نور',code:host.code,token:ids[2],emoji:'🐼'})]);
 assert(jr.every(x=>x.ok),JSON.stringify(jr));await wait(280);assert.equal(a.latest.players.length,3);
 const start=await emit(a,'game:start');assert(start.ok,JSON.stringify(start));await wait(80);
 assert.equal(a.latest.phase,'market');assert.equal(b.latest.phase,'market');assert.equal(c.latest.phase,'market');await wait(230);
 const box=a.latest.boxes.find(x=>x.mine);assert(box&&box.value===null);
 assert((await emit(a,'box:list',{boxId:box.id,price:350,pitch:'لقطة'})).ok);
 await wait(50);assert.equal(b.latest.boxes.find(x=>x.id===box.id).listing.price,350);
 assert.equal(b.latest.boxes.find(x=>x.id===box.id).value,null);
 assert((await emit(b,'box:buy',{boxId:box.id})).ok);await wait(80);
 assert.equal(a.latest.me.cash,1550);assert.equal(b.latest.me.cash,850);
 assert.equal(b.latest.boxes.find(x=>x.id===box.id).ownerId,ids[1]);
 console.log('✅ P2P smoke passed: 3 phones, room, real-time state, private boxes and trading.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});