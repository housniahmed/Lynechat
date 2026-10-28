const{SQSClient:Q,SendMessageCommand:M}=require("@aws-sdk/client-sqs");const C=require("crypto");const q=new Q({}),U=process.env.QUEUE_URL,K=process.env.SECRET;
const sg=(s)=>C.createHmac("sha256",K).update(s).digest("base64url").slice(0,22);
const ok=(a,b)=>{const x=Buffer.from(a||""),y=Buffer.from(b);return x.length===y.length&&C.timingSafeEqual(x,y)};
const es=(s)=>String(s).replace(/[&<>"']/g,c=>"&#"+c.charCodeAt(0)+";");
const pg=(t,m,f)=>({statusCode:200,headers:{"content-type":"text/html; charset=utf-8"},body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+es(t)+'</title><body style="font-family:system-ui,sans-serif;max-width:480px;margin:12vh auto;padding:0 20px;text-align:center;color:#222"><h1 style="font-size:22px">'+es(t)+"</h1><p>"+es(m)+"</p>"+(f||"")+"</body>"});
const push=(o)=>q.send(new M({QueueUrl:U,MessageBody:JSON.stringify({...o,ts:new Date().toISOString()})}));
const CORS={"access-control-allow-origin":"*","access-control-allow-headers":"content-type","access-control-allow-methods":"POST,OPTIONS"};
exports.handler=async(ev)=>{const m=ev.requestContext.http.method,p=ev.rawPath||"/",g=ev.queryStringParameters||{};
let raw=ev.body||"";if(ev.isBase64Encoded)raw=Buffer.from(raw,"base64").toString();
const ct=(ev.headers&&ev.headers["content-type"])||"";let b={};
try{b=ct.includes("json")?JSON.parse(raw||"{}"):Object.fromEntries(new URLSearchParams(raw))}catch(e){}
if(m==="OPTIONS")return{statusCode:204,headers:CORS};
if(p==="/u"){const e=g.e||"",c=g.c||"",l=g.l||"fr";if(!ok(g.s,sg("u|"+e+"|"+c)))return pg("Lien invalide","Ce lien de désinscription est invalide ou incomplet.");
if(m==="POST"){await push({kind:"unsubscribe",email:e,campaign:c});return pg(l==="ar"?"تم إلغاء الاشتراك":"Désinscription confirmée",l==="ar"?"لن تتلقى رسائلنا بعد الآن.":"Vous ne recevrez plus nos e-mails.")}
return pg(l==="ar"?"إلغاء الاشتراك":"Se désinscrire",e,'<form method="post"><button style="font-size:16px;padding:12px 22px;border:0;border-radius:8px;background:#222;color:#fff;cursor:pointer">'+(l==="ar"?"تأكيد إلغاء الاشتراك":"Confirmer la désinscription")+"</button></form>")}
if(p==="/c"){const e=g.e||"",f=g.f||"";if(!ok(g.s,sg("c|"+e+"|"+f)))return pg("Lien invalide","Ce lien de confirmation est invalide.");
await push({kind:"confirm",email:e,form:f});if(g.r&&/^https:\/\//.test(g.r))return{statusCode:302,headers:{location:g.r}};return pg("Inscription confirmée","Merci ! Votre adresse est confirmée.")}
const fm=p.match(/^\/f\/([A-Za-z0-9_-]{1,64})$/);if(fm&&m==="POST"){if(b._hp)return{statusCode:204,headers:CORS};
const fields={};for(const[k,v]of Object.entries(b))if(!k.startsWith("_")&&Object.keys(fields).length<40)fields[k.slice(0,64)]=String(v).slice(0,2000);
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email||""))return{statusCode:400,headers:{...CORS,"content-type":"application/json"},body:'{"ok":false,"error":"email"}'};
await push({kind:"form",form:fm[1],fields});
if(b._redirect&&/^https:\/\//.test(b._redirect))return{statusCode:303,headers:{location:b._redirect}};
if(ct.includes("json"))return{statusCode:200,headers:{...CORS,"content-type":"application/json"},body:'{"ok":true}'};
return pg("Merci !","Votre inscription a bien été enregistrée.")}
return{statusCode:404,body:"Not found"}};
