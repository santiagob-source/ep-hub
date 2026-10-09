(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.EPWorkspace=factory();})(globalThis,function(){
  const states=['Pendiente','Abierto','Standby','Cubierto','Cancelado'];
  const labels={Pendiente:'Pendiente de iniciar',Abierto:'En búsqueda',Standby:'En pausa',Cubierto:'Cubierta',Cancelado:'Cancelada'};
  const colors={Pendiente:'#64748b',Abierto:'#2563eb',Standby:'#b45309',Cubierto:'#15803d',Cancelado:'#475569'};
  function status(job){const value=job.processStatus||job.jobStatus||job.status||'Abierto';return value==='Facturado'?'Cubierto':value==='En proceso'?'Abierto':states.includes(value)?value:'Pendiente';}
  function area(job){return job.businessArea||'Expansion Business';}
  function active(job){return ['Pendiente','Abierto','Standby'].includes(status(job));}
  function missing(client){const absent=key=>!String(client[key]||'').trim()||['-','—'].includes(String(client[key]).trim());return {
    contact:[['contact','Persona de contacto'],['phone','Teléfono'],['email','Email']].filter(([k])=>absent(k)),
    billing:[['razonSocial','Razón social'],['cif','CIF'],['dirFac','Dirección fiscal'],['emailFac','Email de facturación'],['contactFac','Contacto de facturación']].filter(([k])=>absent(k))
  };}
  return {states,labels,colors,status,area,active,missing};
});
