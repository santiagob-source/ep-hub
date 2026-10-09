(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.EPWorkspace=factory();})(globalThis,function(){
  const states=['Abierto','En proceso','Placement','Standby','Cerrado'];
  const labels=Object.fromEntries(states.map(s=>[s,s]));
  const colors={Abierto:'#2563eb','En proceso':'#7c3aed',Placement:'#15803d',Standby:'#b45309',Cerrado:'#64748b'};
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
  return {states,labels,colors,candidates,status,area,active,missing,year,forecastArea,audit};
});
