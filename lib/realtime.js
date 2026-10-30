'use strict';
/* Tiny WebSocket room transport for this game. Browser wire format is JSON events.
 * Handles RFC 6455 masked frames, ping/pong, fragmentation and 100 KB limits.
 * Not intended as a general-purpose socket.io replacement. */
const crypto=require('node:crypto');
const { EventEmitter }=require('node:events');
const MAX_PACKET=128*1024;
class RemoteSocket {
 constructor(id,conn,server){this.id=id;this.conn=conn;this.server=server;this.data={};this.rooms=new Set([id]);this.handlers=new Map();this.closed=false;}
 on(event,handler){this.handlers.set(event,handler);return this;}
 receive(msg){
  if(!msg||typeof msg!=='object'||typeof msg.event!=='string'||msg.event.length>80)return;
  const handler=this.handlers.get(msg.event);if(!handler)return;
  const callback=(data)=>{if(Number.isSafeInteger(msg.ackId))this.send({ackId:msg.ackId,data});};
  try{handler(msg.payload,callback);}catch(e){console.error('Event handler:',e);callback({ok:false,message:'حصل خطأ في السيرفر.'});}
 }
 emit(event,data){this.send({event,data});}
 send(payload){if(this.closed)return;let serialized;try{serialized=JSON.stringify(payload);}catch{return;}this.conn.frame(Buffer.from(serialized));}
 join(room){this.rooms.add(room);}
 leave(room){this.rooms.delete(room);}
 disconnect(){if(this.closed)return;this.closed=true;this.conn.close();this.handlers.get('disconnect')?.();this.server.sockets.sockets.delete(this.id);}
}
class WSConnection {
 constructor(conn,onPacket,onClose){this.conn=conn;this.onPacket=onPacket;this.onClose=onClose;this.buf=Buffer.alloc(0);this.closed=false;this.parts=[];this.total=0;this.lastPong=Date.now();
  conn.on('data',buf=>this.read(buf));conn.on('close',()=>this.close());conn.on('error',()=>this.close());
 }
 frame(data,opcode=1){if(this.closed||!this.conn.writable)return;const n=data.length;let header;
  if(n<126){header=Buffer.from([0x80|opcode,n]);}
  else if(n<65536){header=Buffer.alloc(4);header[0]=0x80|opcode;header[1]=126;header.writeUInt16BE(n,2);}
  else{header=Buffer.alloc(10);header[0]=0x80|opcode;header[1]=127;header.writeBigUInt64BE(BigInt(n),2);}
  this.conn.write(Buffer.concat([header,data]));
 }
 read(chunk){
  if(this.closed)return;
  if(this.buf.length+chunk.length>MAX_PACKET*2){this.conn.destroy();return;}
  this.buf=Buffer.concat([this.buf,chunk]);
  while(this.buf.length>=2){
   const a=this.buf[0],b=this.buf[1],fin=!!(a&0x80),opcode=a&15,masked=!!(b&128);
   let len=b&127,offset=2;
   if(len===126){if(this.buf.length<4)return;len=this.buf.readUInt16BE(2);offset=4;}
   if(len===127){if(this.buf.length<10)return;const big=this.buf.readBigUInt64BE(2);if(big>BigInt(MAX_PACKET)){this.conn.destroy();return;}len=Number(big);offset=10;}
   if(!masked||len>MAX_PACKET){this.conn.destroy();return;}
   if(this.buf.length<offset+4+len)return;
   const mask=this.buf.subarray(offset,offset+4);offset+=4;
   const data=Buffer.from(this.buf.subarray(offset,offset+len));for(let i=0;i<data.length;i++)data[i]^=mask[i%4];
   this.buf=this.buf.subarray(offset+len);
   if(opcode===8){this.close();return;}
   if(opcode===9){this.frame(data,10);continue;}
   if(opcode===10){this.lastPong=Date.now();continue;}
   if(opcode!==0&&opcode!==1){this.conn.destroy();return;}
   if(opcode===1&&this.parts.length){this.conn.destroy();return;}
   this.parts.push(data);this.total+=data.length;
   if(this.total>MAX_PACKET){this.conn.destroy();return;}
   if(fin){
    const raw=Buffer.concat(this.parts,this.total).toString('utf8');this.parts=[];this.total=0;
    try{this.onPacket(JSON.parse(raw));}catch{/* ignore invalid JSON */}
   }
  }
 }
 close(){if(this.closed)return;this.closed=true;this.onClose();if(!this.conn.destroyed)this.conn.destroy();}
}
class Server extends EventEmitter {
 constructor(httpServer){super();this.sockets={sockets:new Map()};
  httpServer.on('upgrade',(req,conn,head)=>{
   if(req.url!=='/ws' || req.headers.upgrade?.toLowerCase()!=='websocket' || req.headers['sec-websocket-version']!=='13' || !/^[A-Za-z0-9+/]{22}==$/.test(req.headers['sec-websocket-key']||'')){
    conn.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');conn.destroy();return;
   }
   const allowedHost=req.headers.host;
   // Browsers send Origin on WS connections. Reject cross-origin browser use.
   if(req.headers.origin){try{const o=new URL(req.headers.origin);if(o.host!==allowedHost){conn.destroy();return;}}catch{conn.destroy();return;}}
   const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
   conn.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
   let socket;const ws=new WSConnection(conn,msg=>socket?.receive(msg),()=>socket?.disconnect());
   const id=crypto.randomUUID();socket=new RemoteSocket(id,ws,this);this.sockets.sockets.set(id,socket);
   if(head?.length)ws.read(head);
   this.emit('connection',socket);
  });
  this.heartbeat=setInterval(()=>{
    for(const socket of this.sockets.sockets.values()){
     if(socket.conn.closed)continue;
     if(Date.now()-socket.conn.lastPong>95000){socket.disconnect();continue;}
     socket.conn.frame(Buffer.alloc(0),9);
    }
   },30000).unref();
 }
 to(room){return {emit:(event,data)=>{for(const socket of this.sockets.sockets.values())if(socket.rooms.has(room))socket.emit(event,data);}};}
}
module.exports={Server};