const test = require("node:test");
const assert = require("node:assert/strict");
const {repair, repairState} = require("../public/agent/text-encoding");
test("repairs UTF-8 read as Latin-1 or Windows-1252 without changing healthy text", () => {
  assert.equal(repair("Ana GarcÃ­a Robles"), "Ana García Robles");
  assert.equal(repair("DirecciÃ³n Mutua"), "Dirección Mutua");
  assert.equal(repair("PoliclÃ­nica Nuestra SeÃ±ora"), "Policlínica Nuestra Señora");
  assert.equal(repair("GarcÃƒÂ­a"), "García");
  for (const text of ["García", "João", "Ángela", "😀", "Ã", "Â", "正常"])
    assert.equal(repair(text), text);
});
test("repairs names and their relationships consistently and leaves IDs and file payloads intact", () => {
  const state = {clients:[{id:"id-Ã­a",name:"PoliclÃ­nica",files:{cv:{name:"GarcÃ­a.pdf",data:"opaque"}}}],jobs:[{title:"DirecciÃ³n",client:"PoliclÃ­nica"}]};
  repairState(state);
  assert.equal(state.clients[0].name, "Policlínica");
  assert.equal(state.jobs[0].client, state.clients[0].name);
  assert.equal(state.clients[0].id, "id-Ã­a");
  assert.equal(state.clients[0].files.cv.name,"GarcÃ­a.pdf");
  assert.deepEqual(repairState(structuredClone(state)),state);
});
