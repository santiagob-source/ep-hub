const test=require('node:test');
const assert=require('node:assert/strict');
const W=require('../public/agent/workspace');
test('legacy vacancies use Business and billed vacancies remain closed without mutating financial records',()=>{
 const job={id:'legacy',status:'En proceso',jobStatus:'Facturado',fee:1200};
 assert.equal(W.area(job),'Expansion Business');assert.equal(W.status(job),'Placement');assert.equal(W.active(job),false);
 assert.deepEqual(job,{id:'legacy',status:'En proceso',jobStatus:'Facturado',fee:1200});
 assert.equal(W.status({status:'En proceso'}),'Abierto');
 assert.equal(W.status({...job,processStatus:'Abierto'}),'Abierto');
});
test('client completeness distinguishes operational and fiscal data and names missing fields',()=>{
 const c={contact:'Alba',phone:'+34612345678',email:'alba@example.com',cif:'—'};
 assert.deepEqual(W.missing(c).contact,[]);
 assert.ok(W.missing(c).billing.some(([key])=>key==='cif'));
 assert.equal(W.missing(c).billing.length,5);
});

test('legacy forecasts belong to Business in 2026 and explicit years and areas stay independent',()=>{
 const legacy={title:'Histórica',amount:1000,month:'Enero'};
 assert.equal(W.forecastArea(legacy),'Expansion Business');
 assert.equal(W.year(legacy),2026);
 assert.equal(W.forecastArea({businessArea:'Expansion People'}),'Expansion People');
 assert.equal(W.year({year:2027}),2027);
 assert.deepEqual(legacy,{title:'Histórica',amount:1000,month:'Enero'});
});

test('audit counts unique active candidates and ignores closed processes',()=>{
 const state={clients:[{id:'c',name:'Clínica'}],jobs:[{id:'j',title:'Médico',client:'Clínica',owner:'Santi',pipeline:[{candidateId:'a',name:'Ana'},{candidateId:'a',name:'Ana'},{candidateId:'b',name:'B',label:'Rechazado'}]},{id:'closed',status:'Cerrado',pipeline:[]}]};
 const before=JSON.stringify(state),result=W.audit(state);assert.equal(result.clients.length,1);assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].count,1);assert.equal(JSON.stringify(state),before);
});

test('job lifecycle follows active candidates while retaining manual closed, standby and placement states',()=>{
 const job={status:'Pendiente',pipeline:[]};assert.equal(W.status(job),'Abierto');
 job.pipeline.push({name:'Ana',label:'En proceso'});assert.equal(W.status(job),'En proceso');
 job.pipeline[0].label='Rechazado';assert.equal(W.status(job),'Abierto');
 job.pipeline[0].label='Placement';assert.equal(W.status(job),'Placement');assert.equal(W.active(job),false);
 job.processStatus='Standby';assert.equal(W.status(job),'Standby');
 job.processStatus='Cerrado';assert.equal(W.status(job),'Cerrado');assert.equal(W.active(job),false);
 job.processStatus='Placement';job.pipeline=[];assert.equal(W.status(job),'Placement');
 assert.equal(W.status({status:'Cubierto'}),'Placement');assert.equal(W.status({status:'Cancelado'}),'Cerrado');
 assert.deepEqual(W.states,['En proceso','Abierto','Standby','Placement','Cerrado']);
});

test('jobs sort by requested lifecycle priority without changing stored order',()=>{
 const jobs=[{title:'Closed',status:'Cerrado'},{title:'Placed',status:'Placement'},{title:'Paused',status:'Standby'},{title:'Open',pipeline:[]},{title:'Working',pipeline:[{name:'Ana'}]}];
 const before=JSON.stringify(jobs);assert.deepEqual(W.sortJobs(jobs).map(W.status),['En proceso','Abierto','Standby','Placement','Cerrado']);assert.equal(JSON.stringify(jobs),before);
});
test('candidate ordering uses live pipelines, advancement and notes before inactive candidates',()=>{
 const candidates=[{id:'new',name:'New',status:'CV Recibido'},{id:'closed',name:'Closed',status:'Descartado'},{id:'search',name:'Search',status:'CV Recibido'},{id:'offer',name:'Offer',status:'CV Recibido'},{id:'notes',name:'Notes',status:'CV Recibido',callNotes:[{text:'Called',date:'2026-10-09'}]}];
 const jobs=[{pipeline:[{candidateId:'search',name:'Search',stage:'Busqueda'},{candidateId:'offer',name:'Offer',stage:'Oferta'}]}];
 const before=JSON.stringify(candidates);assert.deepEqual(W.sortCandidates(candidates,jobs).map(c=>c.id),['offer','search','notes','new','closed']);assert.equal(JSON.stringify(candidates),before);
 jobs[0].processStatus='Cerrado';assert.equal(W.candidateActivity(candidates[2],jobs).rank,1);
});
