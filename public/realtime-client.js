/* Minimal browser WebSocket event client dedicated to THE DEAL. */
(function(){'use strict';
window.io=function io(options={}){
 const listeners=new Map(),callbacks=new Map();
 let ws=null,retry=0,serial=0;
 const client={connected:false,
  on(name,cb){const arr=listeners.get(name)||[];arr.push(cb);listeners.set(name,arr);return client;},
  emit(name,payload={},ack){
   if(!client.connected || !ws || ws.readyState!==1){if(ack)ack({ok:false,message:'لا يوجد اتصال بالسيرفر'});return;}
   const packet={event:name,payload};
   if(typeof ack==='function'){packet.ackId=++serial;callbacks.set(packet.ackId,ack);}
   ws.send(JSON.stringify(packet));
  }
 };
 function notify(name,payload){for(const fn of listeners.get(name)||[]){try{fn(payload);}catch(e){console.error(e);}}}
 function connect(){
  ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
  ws.onopen=()=>{client.connected=true;retry=0;notify('connect');};
  ws.onmessage=e=>{
   let msg;try{msg=JSON.parse(e.data);}catch{return;}
   if(Number.isSafeInteger(msg.ackId)){const cb=callbacks.get(msg.ackId);callbacks.delete(msg.ackId);if(cb)cb(msg.data);}
   else if(typeof msg.event==='string')notify(msg.event,msg.data);
  };
  ws.onclose=()=>{const was=client.connected;client.connected=false;callbacks.clear();if(was)notify('disconnect');retry++;setTimeout(connect,Math.min(5000,500*Math.pow(1.5,Math.min(retry,6))));};
  ws.onerror=()=>{};
 }
 connect();return client;
};
})();