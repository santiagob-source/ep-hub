const test=require('node:test');
const assert=require('node:assert/strict');
const W=require('../public/agent/workspace');
test('legacy vacancies use Business and billed vacancies remain closed without mutating financial records',()=>{
 const job={id:'legacy',status:'En proceso',jobStatus:'Facturado',fee:1200};
 assert.equal(W.area(job),'Expansion Business');assert.equal(W.status(job),'Cubierto');assert.equal(W.active(job),false);
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
