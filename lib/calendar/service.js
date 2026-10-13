const { randomBytes } = require('node:crypto');
const { GmailError: CalendarError } = require('../gmail/service');
const TIMEZONE = 'Europe/Madrid';
const SCOPES = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'];
async function call(token,path,options={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
  try {
    const r=await fetch('https://www.googleapis.com/calendar/v3/'+path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:controller.signal});
    const data=await r.json();
    if(!r.ok) {
      if(options.method==='POST'&&(r.status>=500||r.status===408))throw new CalendarError(r.status,'No pude confirmar si Google creó la reunión. Revisá Google Calendar antes de intentar crearla de nuevo.');
      const disabled=(data.error?.errors||[]).some(e=>['accessNotConfigured','serviceDisabled'].includes(e.reason))||JSON.stringify(data.error?.details||[]).includes('SERVICE_DISABLED');
      throw new CalendarError(r.status,disabled?'Falta habilitar Google Calendar API en el proyecto de Google Cloud que usa la app.':({401:'La conexión de Google Calendar venció. Volvé a conectar Calendar.',403:'Google Calendar no permitió la operación. Revisá los permisos de la cuenta y del calendario.',404:'No se encontró ese calendario o evento.',409:'El evento ya existe.',429:'Google Calendar alcanzó su límite. Intentá de nuevo en un momento.'}[r.status]||'Google Calendar no pudo completar la operación.'));
    }
    return data;
  } catch(e) {
    if(e.status)throw e;
    throw new CalendarError(controller.signal.aborted?504:502,options.method==='POST'?'No pude confirmar si Google creó la reunión. Revisá Google Calendar antes de intentar crearla de nuevo.':'No pude consultar Google Calendar. Intentá de nuevo.');
  } finally {clearTimeout(timer);}
}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new CalendarError(400,'Indicá fechas válidas en formato YYYY-MM-DD.');return value;}
function midnight(value){date(value);const utc=Date.parse(value+'T00:00:00Z');let guess=utc;const format=new Intl.DateTimeFormat('en-GB',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});for(let i=0;i<3;i++){const p=Object.fromEntries(format.formatToParts(guess).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));guess+=utc-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);}return new Date(guess).toISOString();}
function today(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return p.year+'-'+p.month+'-'+p.day;}
function nextDay(d){return new Date(Date.parse(d)+86400000).toISOString().slice(0,10);}
function calendarPath(id){if(typeof id!=='string'||!id.trim()||id.length>300)throw new CalendarError(400,'Calendario inválido.');return encodeURIComponent(id);}
async function calendars(token){const data=await call(token,'users/me/calendarList?maxResults=250');return {calendars:(data.items||[]).filter(c=>!c.deleted).map(c=>({id:c.id,name:c.summaryOverride||c.summary||c.id,primary:!!c.primary,selected:!!c.selected,access_role:c.accessRole,timezone:c.timeZone})),has_more:!!data.nextPageToken};}
function eventView(e,c){return {id:e.id,calendar_id:c.id,calendar:c.name,title:e.summary||'Sin título',start:e.start?.dateTime||e.start?.date,end:e.end?.dateTime||e.end?.date,all_day:!!e.start?.date,location:e.location||'',description:String(e.description||'').slice(0,2000),meet_url:e.hangoutLink||e.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri||'',html_url:e.htmlLink||'',attendees:(e.attendees||[]).map(a=>({email:a.email,response:a.responseStatus,self:!!a.self}))};}
async function listEvents(token,args={}){
  const from=date(args.date_from||today()),to=date(args.date_to||nextDay(from));
  if(to<=from||Date.parse(to)-Date.parse(from)>93*86400000)throw new CalendarError(400,'Elegí un rango de hasta 93 días; la fecha final es exclusiva.');
  const limit=args.limit===undefined?50:args.limit;if(!Number.isInteger(limit)||limit<1||limit>100)throw new CalendarError(400,'El límite debe estar entre 1 y 100.');
  if(args.query!==undefined&&(typeof args.query!=='string'||args.query.length>200))throw new CalendarError(400,'Búsqueda inválida.');
  let chosen,partial=false;
  if(args.calendar_id){calendarPath(args.calendar_id);chosen=[{id:args.calendar_id,name:args.calendar_id}];}
  else{const list=await calendars(token);chosen=list.calendars.filter(c=>c.primary||c.selected);partial=list.has_more||chosen.length>10;chosen=chosen.slice(0,10);if(!chosen.length)chosen=[{id:'primary',name:'Principal'}];}
  const results=await Promise.all(chosen.map(async c=>{try{const q=new URLSearchParams({timeMin:midnight(from),timeMax:midnight(to),singleEvents:'true',orderBy:'startTime',maxResults:'250',timeZone:TIMEZONE});if(args.query)q.set('q',args.query);return {c,data:await call(token,'calendars/'+calendarPath(c.id)+'/events?'+q)};}catch(e){return {c,error:e};}}));
  if(results.every(r=>r.error))throw results[0].error;
  const seen=new Set(),events=[];for(const r of results){if(r.error)continue;for(const e of r.data.items||[]){if(e.status==='cancelled')continue;const key=(e.iCalUID||r.c.id+':'+e.id)+':'+(e.start?.dateTime||e.start?.date);if(seen.has(key))continue;seen.add(key);events.push(eventView(e,r.c));}}
  events.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  return {events:events.slice(0,limit),count:events.length,date_from:from,date_to:to,timezone:TIMEZONE,calendars_checked:results.filter(r=>!r.error).map(r=>r.c.name),partial:partial||results.some(r=>r.error),unavailable:results.filter(r=>r.error).map(r=>({calendar:r.c.name,error:r.error.message})),has_more:events.length>limit||results.some(r=>r.data?.nextPageToken)};
}
function validateEvent(args){
  if(typeof args.title!=='string'||!args.title.trim()||args.title.length>200)throw new CalendarError(400,'Indicá un título de hasta 200 caracteres.');
  for(const name of ['start','end'])if(typeof args[name]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(args[name])||!Number.isFinite(Date.parse(args[name])))throw new CalendarError(400,'Indicá inicio y fin con fecha, hora y prefijo de zona horaria.');
  date(args.start.slice(0,10));date(args.end.slice(0,10));
  if(Date.parse(args.end)<=Date.parse(args.start)||Date.parse(args.end)-Date.parse(args.start)>7*86400000)throw new CalendarError(400,'La reunión debe terminar después del inicio y durar hasta 7 días.');
  const attendees=args.attendees||[];if(!Array.isArray(attendees)||attendees.length>50||attendees.some(e=>typeof e!=='string'||!/^[^\s<>(),;:\"@]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(e)||e.length>254))throw new CalendarError(400,'Revisá los correos de los invitados.');
  if(args.google_meet!==undefined&&typeof args.google_meet!=='boolean')throw new CalendarError(400,'Google Meet inválido.');
  for(const field of ['description','location'])if(args[field]!==undefined&&(typeof args[field]!=='string'||args[field].length>(field==='description'?5000:500)))throw new CalendarError(400,'Descripción o ubicación demasiado larga.');
  return {calendar_id:args.calendar_id||'primary',title:args.title.trim(),start:args.start,end:args.end,timezone:TIMEZONE,description:args.description||'',location:args.location||'',attendees:[...new Set(attendees)],google_meet:!!args.google_meet};
}
async function prepareEvent(token,args){const event=validateEvent(args);const c=await call(token,'users/me/calendarList/'+calendarPath(event.calendar_id));if(!['owner','writer'].includes(c.accessRole))throw new CalendarError(403,'Tu cuenta no puede crear eventos en ese calendario.');if(event.google_meet&&!c.conferenceProperties?.allowedConferenceSolutionTypes?.includes('hangoutsMeet'))throw new CalendarError(400,'Este calendario no permite crear enlaces de Google Meet.');return {...event,calendar_id:c.id,calendar:c.summaryOverride||c.summary||c.id};}
async function createEvent(token,event,eventId){
  const body={id:eventId,summary:event.title,description:event.description,location:event.location,start:{dateTime:event.start,timeZone:TIMEZONE},end:{dateTime:event.end,timeZone:TIMEZONE},attendees:event.attendees.map(email=>({email}))};
  if(event.google_meet)body.conferenceData={createRequest:{requestId:eventId,conferenceSolutionKey:{type:'hangoutsMeet'}}};
  const path='calendars/'+calendarPath(event.calendar_id)+'/events',q=new URLSearchParams({sendUpdates:event.attendees.length?'all':'none',conferenceDataVersion:'1'});
  let data;try{data=await call(token,path+'?'+q,{method:'POST',body:JSON.stringify(body)});}catch(e){if(e.status!==409)throw e;data=await call(token,path+'/'+eventId);}
  return {ok:true,created:true,event:eventView(data,{id:event.calendar_id,name:event.calendar}),meet_pending:event.google_meet&&!data.hangoutLink};
}
module.exports={SCOPES,TIMEZONE,call,midnight,calendars,listEvents,validateEvent,prepareEvent,createEvent,newEventId:()=>randomBytes(20).toString('hex')};
