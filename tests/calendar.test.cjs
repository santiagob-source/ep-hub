const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const calendar=require('../lib/calendar/service'),session=require('../lib/gmail/session');
process.env.GMAIL_TOKEN_ENCRYPTION_KEY='34'.repeat(32);
test('Madrid day bounds respect both DST transitions and reject impossible dates',()=>{
 assert.equal(calendar.midnight('2026-10-13'),'2026-10-12T22:00:00.000Z');
 assert.equal(Date.parse(calendar.midnight('2026-03-30'))-Date.parse(calendar.midnight('2026-03-29')),23*3600000);
 assert.equal(Date.parse(calendar.midnight('2026-10-26'))-Date.parse(calendar.midnight('2026-10-25')),25*3600000);
 assert.throws(()=>calendar.midnight('2026-02-30'));
 assert.throws(()=>calendar.validateEvent({title:'Meeting',start:'2026-10-13T10:00:00',end:'2026-10-13T11:00:00'}));
 assert.throws(()=>calendar.validateEvent({title:'Meeting',start:'2026-10-13T10:00:00+02:00',end:'2026-10-13T09:00:00+02:00'}));
});
test('selected calendars include recurring and all-day events, deduplicate shared meetings, report partial failures',async()=>{
 const original=global.fetch,urls=[];
 global.fetch=async url=>{urls.push(String(url));const path=new URL(url).pathname;if(path.endsWith('/calendarList'))return {ok:true,json:async()=>({items:[{id:'main',summary:'Personal',primary:true},{id:'team',summary:'Equipo',selected:true},{id:'bad',summary:'Sin acceso',selected:true},{id:'hidden',summary:'Oculto',selected:false}]})};if(path.includes('/bad/'))return {ok:false,status:403,json:async()=>({error:{}})};return {ok:true,json:async()=>({items:[{id:'meeting',iCalUID:'shared',summary:'Reunión',start:{dateTime:'2026-10-13T10:00:00+02:00'},end:{dateTime:'2026-10-13T11:00:00+02:00'}},...(path.includes('/main/')?[{id:'day',summary:'Día completo',start:{date:'2026-10-13'},end:{date:'2026-10-14'}},{id:'cancelled',status:'cancelled'}]:[])]})};};
 try{const out=await calendar.listEvents('token',{date_from:'2026-10-13',date_to:'2026-10-14'});assert.equal(out.events.length,2);assert.equal(out.partial,true);assert.equal(out.unavailable.length,1);assert.equal(out.events[0].all_day,true);assert.ok(!urls.some(u=>u.includes('/hidden/')));const request=new URL(urls.find(u=>u.includes('/main/')));assert.equal(request.searchParams.get('timeMin'),'2026-10-12T22:00:00.000Z');assert.equal(request.searchParams.get('timeMax'),'2026-10-13T22:00:00.000Z');assert.equal(request.searchParams.get('singleEvents'),'true');}finally{global.fetch=original;}
});
test('Calendar errors never become an empty agenda and explain a disabled API',async()=>{
 const original=global.fetch;global.fetch=async()=>({ok:false,status:403,json:async()=>({error:{errors:[{reason:'accessNotConfigured'}]}})});
 try{await assert.rejects(calendar.listEvents('token',{calendar_id:'primary'}),/habilitar Google Calendar API/);}finally{global.fetch=original;}
});
test('event creation keeps the same provider ID on replay and invitations are explicit',async()=>{
 const original=global.fetch,posts=[];let count=0;
 global.fetch=async(url,opts)=>{if(opts.method==='POST'){posts.push({url:String(url),body:JSON.parse(opts.body)});if(count++)return {ok:false,status:409,json:async()=>({error:{}})};}return {ok:true,json:async()=>({id:'stable',summary:'Meeting',start:{dateTime:'2026-10-13T10:00:00+02:00'},end:{dateTime:'2026-10-13T11:00:00+02:00'}})};};
 try{const event={...calendar.validateEvent({title:'Meeting',start:'2026-10-13T10:00:00+02:00',end:'2026-10-13T11:00:00+02:00',attendees:['eva@example.com'],google_meet:true}),calendar:'Principal'};assert.equal((await calendar.createEvent('token',event,'stable')).ok,true);assert.equal((await calendar.createEvent('token',event,'stable')).ok,true);assert.equal(posts[0].body.id,posts[1].body.id);assert.equal(posts[0].body.conferenceData.createRequest.requestId,'stable');assert.equal(new URL(posts[0].url).searchParams.get('sendUpdates'),'all');}finally{global.fetch=original;}
});
test('Calendar OAuth adds scopes on the existing callback and writes require account-bound review',async()=>{
 const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),now=Math.floor(Date.now()/1000);
 const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'calendar-test'})).toString('base64url'),b=Buffer.from(JSON.stringify({aud:'ep-hub-7c4b9',iss:'https://securetoken.google.com/ep-hub-7c4b9',sub:'calendar-user',iat:now,exp:now+3600})).toString('base64url');
 const jwt=h+'.'+b+'.'+crypto.sign('RSA-SHA256',Buffer.from(h+'.'+b),privateKey).toString('base64url');
 const original=global.fetch;process.env.GOOGLE_CLIENT_ID='test';process.env.GOOGLE_CLIENT_SECRET='test';let writes=0,fullScopes=false;
 global.fetch=async(url,opts)=>{if(String(url).includes('/metadata/x509/'))return {ok:true,json:async()=>({'calendar-test':publicKey.export({type:'spki',format:'pem'})})};if(String(url).includes('oauth2.googleapis.com'))return {ok:true,json:async()=>({access_token:'access',refresh_token:'new-refresh',scope:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose',...(fullScopes?calendar.SCOPES:[])].join(' ')})};if(String(url).endsWith('/profile'))return {ok:true,json:async()=>({emailAddress:'me@example.com'})};if(opts.method==='POST'){writes++;return {ok:true,json:async()=>({id:JSON.parse(opts.body).id,summary:'Meeting'})};}return {ok:true,json:async()=>({id:'me@example.com',summary:'Personal',accessRole:'owner',conferenceProperties:{allowedConferenceSolutionTypes:['hangoutsMeet']}})};};
 const handler=require('../api/gmail');const account=(calendarAccess,email='me@example.com')=>'ep_gmail='+session.seal({kind:'mailbox',uid:'calendar-user',email,calendar:calendarAccess,refresh:'refresh',expires:Date.now()+60000});
 async function invoke(body,cookie=account(true),auth=jwt){const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(data){this.data=data;}};await handler({method:'POST',headers:{authorization:'Bearer '+auth,cookie},body},res);return res;}
 const args={title:'Meeting',start:'2026-10-13T10:00:00+02:00',end:'2026-10-13T11:00:00+02:00',attendees:['eva@example.com']};
 try{
  assert.equal((await invoke({action:'status',service:'calendar'},account(false))).data.connected,false);
  assert.equal((await invoke({action:'execute',tool:'calendar_list_events'},account(false))).code,403);
  const connection=await invoke({action:'connect',service:'calendar'},account(false));const url=new URL(connection.data.url);assert.equal(url.searchParams.get('redirect_uri'),'https://expansion-people-recruiter.vercel.app/api/gmail');for(const scope of calendar.SCOPES)assert.ok(url.searchParams.get('scope').includes(scope));assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const stateCookie=connection.headers['Set-Cookie'].split(';')[0];
  async function callback(){const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(data){this.data=data;},end(){}};await handler({method:'GET',url:'/api/gmail?state='+url.searchParams.get('state')+'&code=code',headers:{cookie:stateCookie}},res);return res;}
  assert.equal((await callback()).code,403);fullScopes=true;const connected=await callback();assert.equal(connected.statusCode,303);const cookieValue=connected.headers['Set-Cookie'][0].split(';')[0].slice('ep_gmail='.length);assert.equal(session.open(cookieValue,'mailbox','calendar-user').calendar,true);

  assert.equal((await invoke({action:'execute',tool:'calendar_create_event',args})).code,401);assert.equal(writes,0);
  const prepared=await invoke({action:'prepare',tool:'calendar_create_event',args});assert.equal(prepared.code,200);assert.equal(writes,0);assert.match(prepared.data.review.effects,/invitaciones/);assert.match(prepared.data.review.arguments.start,/13 de octubre de 2026/);
  const request={action:'execute',tool:'calendar_create_event',args,capability:prepared.data.capability};
  assert.equal((await invoke({...request,args:{...args,title:'Different'}})).code,409);assert.equal((await invoke(request,account(true,'other@example.com'))).code,409);assert.equal((await invoke(request,account(true),jwt+'broken')).code,401);assert.equal(writes,0);
  assert.equal((await invoke(request)).code,200);assert.equal(writes,1);
 }finally{global.fetch=original;delete process.env.GOOGLE_CLIENT_ID;delete process.env.GOOGLE_CLIENT_SECRET;}
});

test('uncertain calendar writes are never retried automatically',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Network timeout after sending');};
 try{const event={...calendar.validateEvent({title:'Meeting',start:'2026-10-13T10:00:00+02:00',end:'2026-10-13T11:00:00+02:00'}),calendar:'Personal'};await assert.rejects(calendar.createEvent('token',event,'stable'),/Revisá Google Calendar/);assert.equal(calls,1);}finally{global.fetch=original;}
});
