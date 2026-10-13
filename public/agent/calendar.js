(function(root){
 function create(env){
  let state={connected:false,configured:false,email:''};
  async function request(body){const user=env.user();if(!user)throw Error('Iniciá sesión en el Hub para conectar Calendar.');const r=await fetch('/api/gmail',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},body:JSON.stringify({...body,service:'calendar'})});let data;try{data=await r.json();}catch{throw Error('Google Calendar no respondió correctamente.');}if(!r.ok)throw Error(data.error||'Google Calendar no pudo completar la operación.');return data;}
  async function status(){state=await request({action:'status'});env.changed?.(state);return state;}
  const adapters={calendar_status:{execute:status}};
  for(const name of ['calendar_list_calendars','calendar_list_events','calendar_create_event'])adapters[name]={check:()=>{},stage:args=>name==='calendar_create_event'?request({action:'prepare',tool:name,args}):null,execute:(args,staged)=>request({action:'execute',tool:name,args,capability:staged?.capability})};
  return {adapters,status,context:()=>({...state}),connect:async()=>{const data=await request({action:'connect'});location.assign(data.url);}};
 }
 root.EPAgentCalendar={create};
})(globalThis);
