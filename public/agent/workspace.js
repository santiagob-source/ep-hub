(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.EPWorkspace=factory();})(globalThis,function(){
  const states=['En proceso','Abierto','Standby','Placement','Cerrado'];
  const labels=Object.fromEntries(states.map(s=>[s,s]));
  const palette={sky:{background:'#e0f2fe',color:'#075985'},blue:{background:'#dbeafe',color:'#1d4ed8'},offer:{background:'#d1fae5',color:'#047857'},green:{background:'#dcfce7',color:'#166534'},yellow:{background:'#fef3c7',color:'#92400e'},red:{background:'#fee2e2',color:'#991b1b'},neutral:{background:'#f1f5f9',color:'#475569'}};
  function tone(status){
    const value=String(status||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
    if(value==='oferta')return 'offer';
    if(['placement','activo','cubierto','facturado'].includes(value))return 'green';
    if(['standby','pausado','en pausa','volver a contactar','media'].includes(value))return 'yellow';
    if(['descartado','rechazado','alta'].includes(value))return 'red';
    if(['en proceso','cv enviado','llamada','contactado','entrevista','entrevista c/c'].includes(value))return 'blue';
    if(['abierto','cv recibido','nuevo','busqueda'].includes(value))return 'sky';
    return 'neutral';
  }
  function statusPalette(status){return palette[tone(status)];}
  const colors=Object.fromEntries(states.map(s=>[s,statusPalette(s).color]));
  function candidates(job){return (job.pipeline||[]).filter(p=>!['Rechazado','No presentado','Placement'].includes(p.label)&&(p.candidateId||String(p.name||'').trim()));}
  function status(job){
    const value=job.processStatus||job.jobStatus||job.status||'Abierto';
    if(['Cerrado','Cancelado'].includes(value))return 'Cerrado';
    if(['Standby','En pausa'].includes(value))return 'Standby';
    if(['Placement','Cubierto','Facturado'].includes(value)||(job.pipeline||[]).some(p=>p.label==='Placement'))return 'Placement';
    return candidates(job).length?'En proceso':'Abierto';
  }
  function area(job){return job.businessArea||'Expansion Business';}
  function active(job){return ['Abierto','En proceso','Standby'].includes(status(job));}
  const collator=new Intl.Collator('es',{sensitivity:'base',numeric:true});
  function sortJobs(jobs){return [...jobs].sort((a,b)=>states.indexOf(status(a))-states.indexOf(status(b))||candidates(b).length-candidates(a).length||collator.compare(a.title||'',b.title||'')||collator.compare(a.client||'',b.client||''));}
  function candidateActivity(candidate,jobs){
    const key=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
    const links=jobs.flatMap(job=>(job.pipeline||[]).filter(p=>p.candidateId?p.candidateId===candidate.id:key(p.name)===key(candidate.name)).map(p=>({job,p})));
    const ongoing=links.filter(({job,p})=>['Abierto','En proceso'].includes(status(job))&&!['Rechazado','No presentado','Placement'].includes(p.label));
    const stages={'busqueda':1,'contactado':2,'entrevista':3,'entrevista c/c':4,'oferta':5};
    const own=key(candidate.status),inProcess=ongoing.length>0||['en proceso','entrevista','entrevista c/c','oferta'].includes(own);
    const rank=inProcess?0:['cerrado','descartado','rechazado','no presentado'].includes(own)?4:own==='placement'||links.some(({p})=>p.label==='Placement')?3:['standby','pausado'].includes(own)||links.some(({job})=>status(job)==='Standby')?2:1;
    const notes=(candidate.callNotes||[]).filter(n=>String(n.text||'').trim());
    const time=d=>{if(typeof d==='number')return d;if(typeof d!=='string')return 0;if(/^\d{4}-\d{2}-\d{2}/.test(d))return Date.parse(d);const m=d.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,?\s+(\d{2}):(\d{2}))?/);return m?Date.UTC(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0)):0;};
    const dates=[candidate.lastContact,candidate.updatedAt,...notes.map(n=>n.date)].map(time).filter(Number.isFinite);
    return {rank,progress:Math.max(stages[own]||0,...ongoing.map(({p})=>stages[key(p.stage)]||0)),links:ongoing.length,notes:notes.length,recent:Math.max(0,...dates)};
  }
  function sortCandidates(candidates,jobs){
    const ranked=candidates.map(candidate=>({candidate,activity:candidateActivity(candidate,jobs)}));
    ranked.sort((a,b)=>a.activity.rank-b.activity.rank||b.activity.progress-a.activity.progress||b.activity.links-a.activity.links||b.activity.notes-a.activity.notes||b.activity.recent-a.activity.recent||collator.compare(a.candidate.name||'',b.candidate.name||''));
    return ranked.map(r=>r.candidate);
  }
  function missing(client){const absent=key=>!String(client[key]||'').trim()||['-','—'].includes(String(client[key]).trim());return {
    contact:[['contact','Persona de contacto'],['phone','Teléfono'],['email','Email']].filter(([k])=>absent(k)),
    billing:[['razonSocial','Razón social'],['cif','CIF'],['dirFac','Dirección fiscal'],['emailFac','Email de facturación'],['contactFac','Contacto de facturación']].filter(([k])=>absent(k))
  };}
  function year(record){return Number(record.year)||2026;}
  function forecastArea(record){return record.businessArea||'Expansion Business';}
  function audit(state){
    const clients=(state.clients||[]).map(client=>({client,missing:missing(client)})).filter(r=>r.missing.contact.length||r.missing.billing.length);
    const jobs=(state.jobs||[]).filter(active).map(job=>{
      const unique=new Set(candidates(job).map(p=>p.candidateId||String(p.name||'').trim().toLowerCase()).filter(Boolean));
      const gaps=[['client','Cliente'],['owner','Responsable']].filter(([key])=>!String(job[key]||'').trim()).map(x=>x[1]);
      return {job,count:unique.size,gaps};
    }).filter(r=>r.count<3||r.gaps.length).sort((a,b)=>a.count-b.count);
    return {clients,jobs};
  }
  return {states,labels,colors,palette,tone,statusPalette,candidates,status,area,active,sortJobs,sortCandidates,candidateActivity,missing,year,forecastArea,audit};
});
