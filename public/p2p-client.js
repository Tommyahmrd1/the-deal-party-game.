/* Multiplayer without a paid server: host phone runs THE DEAL engine.
 * Signaling: public PeerJS server. Game packets: encrypted WebRTC data channels.
 * Host must keep this browser tab open. Rooms disappear when host disconnects.
 */
(function(){'use strict';
const PREFIX='thedeal-party-room-v3-';
const listeners=new Map(), pending=new Map();
let signaling=null, hostPeer=null, hostEngine=null, localSocket=null, guestConn=null;
let mode='idle', nextAck=0, dialing=null, guestRoom=null;
const client={
 connected:false,
 on(event,cb){const arr=listeners.get(event)||[];arr.push(cb);listeners.set(event,arr);return client;},
 emit(event,payload={},callback){
  if(!client.connected)return finish(callback,{ok:false,message:'مش متصل بالإنترنت. حاول تاني بعد الاتصال.'});
  if(event==='room:create')return createRoom(payload,callback);
  if(event==='room:join')return joinRoom(payload,callback);
  if(mode==='host'&&localSocket)return localSocket.dispatch({event,payload},callback);
  if(mode==='guest'&&guestConn?.open)return sendToHost({event,payload},callback);
  finish(callback,{ok:false,message:'اتقطع الاتصال بصاحب القعدة. افتح الغرفة من جديد.'});
 }
};
function fire(evt,data){for(const fn of listeners.get(evt)||[]){try{fn(data);}catch(e){console.error(e);}}}
function finish(fn,data){if(typeof fn==='function')fn(data);}
function packet(conn,obj){if(!conn?.open)return false;try{conn.send(obj);return true;}catch{return false;}}
function buildSocket(connection,registry){
 const sock={id:crypto.randomUUID(),data:{},conn:connection,rooms:new Set(),handlers:new Map(),
  on(evt,fn){this.handlers.set(evt,fn);return this;},
  join(id){this.rooms.add(id);},leave(id){this.rooms.delete(id);},
  emit(evt,data){if(connection){packet(connection,{event:evt,data});}else fire(evt,data);},
  dispatch(msg,callback){
   const fn=this.handlers.get(msg.event);
   if(!fn)return finish(callback,{ok:false,message:'الإجراء مش متاح.'});
   const reply=res=>{if(callback)callback(res);else if(Number.isSafeInteger(msg.ackId))packet(connection,{ackId:msg.ackId,data:res});};
   try{fn(msg.payload,reply);}catch(error){console.error('Game engine:',error);reply({ok:false,message:'حصل خطأ في اللعبة.'});}
  },disconnect(){this.handlers.get('disconnect')?.();}
 };
 registry.set(sock.id,sock);
 if(connection){
  connection.on('data',msg=>sock.dispatch(msg));
  connection.on('close',()=>{sock.disconnect();registry.delete(sock.id);});
  connection.on('error',()=>{sock.disconnect();registry.delete(sock.id);});
 }
 return sock;
}
function createEngine(){
 const registry=new Map();
 const io={
  sockets:{sockets:registry},
  on(event,cb){if(event==='connection')this.onConnection=cb;},
  to(id){return {emit(event,data){for(const sock of registry.values())if(sock.id===id||sock.rooms.has(id))sock.emit(event,data);}};},
  add(conn){const sock=buildSocket(conn,registry);this.onConnection?.(sock);return sock;}
 };
 hostEngine=window.createDealEngine(io);localSocket=io.add(null);
 return io;
}
function stopHost(){if(hostPeer){try{hostPeer.destroy();}catch{}hostPeer=null;}hostEngine=null;localSocket=null;}
function stopGuest(){if(guestConn){try{guestConn.close();}catch{}guestConn=null;}guestRoom=null;}
function createRoom(payload,ack){
 if(typeof window.Peer!=='function')return finish(ack,{ok:false,message:'مش قادر أحمل خدمة اللعب الجماعي. حدّث الصفحة.'});
 if(mode==='guest')stopGuest();
 if(mode==='host')stopHost();
 mode='host';
 const io=createEngine();
 localSocket.dispatch({event:'room:create',payload},res=>{
  if(!res?.ok)return finish(ack,res);
  const roomCode=res.code;
  hostPeer=new window.Peer(PREFIX+roomCode.toLowerCase());
  let replied=false;
  const timeout=setTimeout(()=>{
   if(replied)return;replied=true;
   finish(ack,{ok:false,message:'فتح الغرفة اتأخر. جرّب تاني.'});
  },14000);
  const respond=(value)=>{if(replied)return;replied=true;clearTimeout(timeout);finish(ack,value);};
  hostPeer.on('connection',conn=>io.add(conn));
  hostPeer.on('open',()=>respond(res));
  hostPeer.on('error',e=>{
   console.warn('Peer room error:',e?.type||e);
   if(!replied)respond({ok:false,message:'تعذر فتح الغرفة. جرّب إنشاء غرفة تانية.'});
   else fire('room:notice','اتقطع اتصال الغرفة. اتأكد إن الإنترنت شغال.');
  });
  hostPeer.on('disconnected',()=>fire('room:notice','اتقطع اتصال تسجيل الغرفة. بنحاول نرجعه.'));
 });
}
function sendToHost(p,ack){
 if(ack){p.ackId=++nextAck;const id=nextAck;
  const timer=setTimeout(()=>{const cb=pending.get(id);pending.delete(id);cb?.({ok:false,message:'الاتصال اتأخر. جرّب تاني.'});},12000);
  pending.set(id,res=>{clearTimeout(timer);finish(ack,res);});
 }
 if(!packet(guestConn,p)&&p.ackId){const cb=pending.get(p.ackId);pending.delete(p.ackId);cb?.({ok:false,message:'اتقطع الاتصال. حاول تاني.'});}
}
function deliver(msg){
 if(!msg||typeof msg!=='object')return;
 if(Number.isSafeInteger(msg.ackId)){
  const cb=pending.get(msg.ackId);pending.delete(msg.ackId);cb?.(msg.data);
 }else if(typeof msg.event==='string')fire(msg.event,msg.data);
}
function joinRoom(payload,ack){
 const code=String(payload?.code||'').trim().toUpperCase();
 if(!/^[A-Z0-9]{6}$/.test(code))return finish(ack,{ok:false,message:'اكتب كود غرفة صحيح من 6 حروف.'});
 if(mode==='host'&&hostPeer?.id===PREFIX+code.toLowerCase())return localSocket.dispatch({event:'room:join',payload},ack);
 if(mode==='host')stopHost();
 if(mode==='guest'&&guestConn?.open&&guestRoom===code)return sendToHost({event:'room:join',payload},ack);
 if(mode==='guest'&&guestRoom!==code)stopGuest();
 if(dialing)return finish(ack,{ok:false,message:'جاري الاتصال بالغرفة...'});
 stopGuest();mode='guest';dialing=code;
 const conn=signaling.connect(PREFIX+code.toLowerCase(),{reliable:true,serialization:'json'});
 guestConn=conn;guestRoom=code;
 let completed=false;
 const timeout=setTimeout(()=>{
  if(completed)return;completed=true;dialing=null;
  finish(ack,{ok:false,message:'الغرفة مش متاحة. اتأكد إن صاحب القعدة فاتح اللعبة.'});
  try{conn.close();}catch{}
 },13000);
 conn.on('open',()=>{
  if(completed)return;completed=true;clearTimeout(timeout);dialing=null;
  sendToHost({event:'room:join',payload},ack);
 });
 conn.on('data',deliver);
 conn.on('close',()=>{
  if(conn!==guestConn)return;
  if(!completed){completed=true;clearTimeout(timeout);dialing=null;finish(ack,{ok:false,message:'مش قادر أوصل للغرفة.'});}
  for(const cb of pending.values())cb({ok:false,message:'صاحب القعدة فصل.'});pending.clear();
  guestConn=null;guestRoom=null;mode='idle';fire('disconnect');
 });
 conn.on('error',err=>{
  console.warn('Room error:',err?.type||err);
  if(!completed){completed=true;clearTimeout(timeout);dialing=null;finish(ack,{ok:false,message:'مقدرناش نوصل للغرفة. حاول تاني.'});}
 });
}
function init(){
 if(typeof window.Peer!=='function'){fire('room:notice','تعذر تحميل الاتصال الجماعي. افتح الصفحة في Chrome وحاول تاني.');return;}
 signaling=new window.Peer();
 signaling.on('open',()=>{client.connected=true;fire('connect');});
 signaling.on('disconnected',()=>{client.connected=false;fire('disconnect');setTimeout(()=>{try{if(signaling&&!signaling.destroyed)signaling.reconnect();}catch{}},1800);});
 signaling.on('error',err=>{
  console.warn('PeerJS signaling:',err?.type||err);
  if(['network','server-error','socket-error'].includes(err?.type)){client.connected=false;fire('disconnect');}
  if(err?.type==='peer-unavailable')fire('room:notice','كود الغرفة غير موجود أو صاحبها قافل اللعبة.');
 });
}
window.io=function(){setTimeout(init,0);return client;};
})();