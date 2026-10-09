const test = require("node:test");
const assert = require("node:assert/strict");
const phone = require("../public/agent/phone");
test("phone defaults to Spain and preserves explicit international prefixes", () => {
  assert.equal(phone.normalize("612 345 678"), "+34612345678");
  assert.equal(phone.normalize("+56 9 1234 5678", "España"), "+56912345678");
  assert.equal(phone.normalize("0051 912345678"), "+51912345678");
  assert.equal(phone.normalize("912345678", "Chile"), "+56912345678");
  assert.equal(phone.normalize("912345678", "Perú"), "+51912345678");
  assert.throws(() => phone.normalize("123"), /internacional válido/);
  assert.throws(() => phone.normalize("912345678", "País desconocido"), /prefijo/);
  assert.equal(phone.display("+56912345678"), "🇨🇱 +56912345678");
  assert.equal(phone.display("+34612345678"), "🇪🇸 +34612345678");
});
