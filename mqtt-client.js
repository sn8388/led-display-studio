/* ============================================================
   MiniMQTT · MQTT 3.1.1 over WebSocket 最小客户端（零依赖）
   关键特性：跨消息分帧缓冲 —— broker 可能把 1 个 MQTT 包拆成
   多个 1 字节 WebSocket 帧，不做累积会永远收不到 CONNACK。
   另含：8s 连接超时、3s 自动重连、25s 心跳、QoS0 发布/订阅。
   ============================================================ */
(function(global){
'use strict';

function concatU8(a,b){const r=new Uint8Array(a.length+b.length);r.set(a,0);r.set(b,a.length);return r}
function strBytes(s){const b=new TextEncoder().encode(s);return[(b.length>>8)&255,b.length&255,...b]}
function remLen(n){const o=[];do{let d=n%128;n=Math.floor(n/128);if(n>0)d|=128;o.push(d)}while(n>0);return o}
function pkt(type,flags,body){return new Uint8Array([(type<<4)|flags,...remLen(body.length),...body])}

class MiniMQTT{
  constructor(opts){
    opts=opts||{};
    this.url=opts.url||'';
    this.filters=opts.filters||[];
    this.clientId=(opts.clientId||'vmx')+'-'+Math.random().toString(16).slice(2,10);
    this.onState=opts.onState||function(){};
    this.onLog=opts.onLog||function(){};
    this.onMessage=opts.onMessage||function(){};
    this.ws=null;this.connected=false;this.want=false;
    this.buf=null;this.pingT=null;this.retryT=null;this.connT=null;this.pktId=1;
  }
  log(m,c){this.onLog(m,c)}
  state(c,t){this.onState(c,t)}

  connect(url){
    if(url!==undefined)this.url=url;
    url=String(this.url).trim();
    if(!/^wss?:\/\//i.test(url)){this.log('MQTT 地址需以 ws:// 或 wss:// 开头','err');return}
    this.disconnect(true);
    this.want=true;this.buf=null;this.state('wait','连接中');
    this.log('正在连接 '+url.split('?')[0]+' …');
    let ws;
    try{ws=new WebSocket(url,'mqtt')}
    catch(e){this.state('err','地址无效');this.log('WebSocket 创建失败：'+e.message,'err');this.want=false;return}
    this.ws=ws;ws.binaryType='arraybuffer';
    const self=this;
    clearTimeout(this.connT);
    this.connT=setTimeout(()=>{
      if(!self.connected&&self.ws===ws){self.log('8s 内未收到 CONNACK，主动重连','warn');try{ws.close()}catch(e){}}
    },8000);
    ws.onopen=()=>{
      if(self.ws!==ws)return;
      const vh=[0,4,0x4D,0x51,0x54,0x54,4,0x02,0,30]; /* MQTT · L4 · clean session · keepalive 30 */
      try{ws.send(pkt(1,0,new Uint8Array([...vh,...strBytes(self.clientId)])))}
      catch(e){self.log('CONNECT 发送失败','err')}
    };
    ws.onmessage=ev=>{
      if(self.ws!==ws)return;
      const u8=ev.data instanceof ArrayBuffer?new Uint8Array(ev.data):new TextEncoder().encode(String(ev.data));
      self.parse(u8);
    };
    ws.onerror=()=>{self.log('WebSocket 错误（检查地址 / 网络）','err')};
    ws.onclose=e=>{
      if(self.ws!==ws)return;
      self.ws=null;self.buf=null;self.connected=false;
      clearInterval(self.pingT);clearTimeout(self.connT);
      self.log('连接关闭 code='+e.code+(e.reason?' · '+e.reason:''),'warn');
      if(self.want){
        self.state('err','已断开');self.log('3s 后自动重连','warn');
        clearTimeout(self.retryT);
        self.retryT=setTimeout(()=>{if(self.want)self.connect()},3000);
      }else self.state('off','未连接');
    };
  }

  disconnect(silent){
    this.want=false;clearTimeout(this.retryT);clearTimeout(this.connT);clearInterval(this.pingT);
    if(this.ws){const w=this.ws;w.onclose=w.onerror=w.onmessage=null;try{w.close()}catch(e){}this.ws=null}
    this.connected=false;this.buf=null;
    if(!silent){this.state('off','未连接');this.log('已手动断开','warn')}
  }

  /* 跨消息缓冲解析 */
  parse(u8){
    this.buf=this.buf?concatU8(this.buf,u8):new Uint8Array(u8);
    const buf=this.buf;let off=0;
    while(true){
      if(buf.length-off<2)break;
      let rl=0,mul=1,i=off+1,complete=true;
      while(true){
        if(i>=buf.length){complete=false;break}
        const b=buf[i++];rl+=(b&127)*mul;mul*=128;
        if(!(b&128))break;
      }
      if(!complete||buf.length-i<rl)break;
      try{this.packetIn(buf[off],buf.subarray(i,i+rl))}catch(e){}
      off=i+rl;
    }
    this.buf=off>0?(off<buf.length?buf.slice(off):null):buf;
  }

  packetIn(b1,body){
    const type=b1>>4,ws=this.ws,self=this;
    if(type===2){ /* CONNACK */
      if(body[1]===0){
        clearTimeout(this.connT);
        this.connected=true;this.state('ok','已连接');
        this.log('已连接 broker'+(this.filters.length?' · 订阅 '+this.filters.join(', '):''),'ok');
        this.filters.forEach(f=>this.subscribe(f));
        clearInterval(this.pingT);
        this.pingT=setInterval(()=>{
          if(ws&&ws.readyState===1){try{ws.send(pkt(12,0,new Uint8Array(0)))}catch(e){}}
        },25000);
      }else{
        this.want=false;this.state('err','拒绝('+body[1]+')');
        this.log('broker 拒绝连接，返回码 '+body[1],'err');
      }
    }
    else if(type===9){this.log('订阅成功 SUBACK','ok')}
    else if(type===3){ /* PUBLISH */
      const qos=(b1>>1)&3;
      const tl=(body[0]<<8)|body[1];
      const topic=new TextDecoder().decode(body.subarray(2,2+tl));
      let p=2+tl;if(qos>0)p+=2;
      const payload=new TextDecoder().decode(body.subarray(p));
      if(qos===1&&ws&&ws.readyState===1){
        try{ws.send(pkt(4,0,new Uint8Array([body[2+tl],body[3+tl]])))}catch(e){}
      }
      this.onMessage(topic,payload);
    }
    /* 4=PUBACK / 13=PINGRESP 忽略 */
  }

  subscribe(filter){
    if(!this.ws||this.ws.readyState!==1)return;
    this.pktId=(this.pktId+1)%65536||1;
    const id=this.pktId;
    try{this.ws.send(pkt(8,2,new Uint8Array([(id>>8)&255,id&255,...strBytes(filter),0])))}catch(e){}
  }

  /* QoS0 发布：仅 topic 有长度前缀，payload 为裸 UTF-8 字节 */
  publish(topic,payload){
    if(!this.connected||!this.ws||this.ws.readyState!==1){this.log('未连接 broker，投送失败','err');return false}
    try{
      const body=new Uint8Array([...strBytes(topic),...new TextEncoder().encode(String(payload))]);
      this.ws.send(pkt(3,0,body));
      this.log('PUBLISH '+topic+' · '+(body.length<1024?body.length+' B':(body.length/1024).toFixed(1)+' KB'),'ok');
      return true;
    }catch(e){this.log('发布失败：'+e.message,'err');return false}
  }
  publishJSON(topic,obj){return this.publish(topic,JSON.stringify(obj))}
}

MiniMQTT.util={concatU8,strBytes,remLen,pkt};
global.MiniMQTT=MiniMQTT;
})(window);
