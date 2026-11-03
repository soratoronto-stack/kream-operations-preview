// Network-only: never cache employee records, credentials, or API responses.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.mode==='navigate'&&new URL(event.request.url).origin===self.location.origin){
  event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kream Operations</title><body style="font:18px system-ui;padding:32px;background:#fffaf3;color:#32342d"><h1>Kream Operations</h1><p>인터넷 연결을 확인하고 다시 열어 주세요.<br>Please reconnect to the internet and reopen the app.</p>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
 }
});
