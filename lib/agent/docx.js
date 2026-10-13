const {inflateRawSync}=require('node:zlib');
// Read only the central-directory entries containing Word text. No extraction to disk.
function text(bytes){
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50){end=p;break;}
 if(end<0)throw Error('Archivo Word dañado.');
 const count=bytes.readUInt16LE(end+10);let p=bytes.readUInt32LE(end+16),total=0;
 if(count>2000)throw Error('Archivo Word demasiado complejo.');
 const parts=[];
 for(let i=0;i<count;i++){
  if(p+46>bytes.length||bytes.readUInt32LE(p)!==0x02014b50)throw Error('Directorio Word inválido.');
  const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),compressed=bytes.readUInt32LE(p+20),size=bytes.readUInt32LE(p+24),nameSize=bytes.readUInt16LE(p+28),extra=bytes.readUInt16LE(p+30),comment=bytes.readUInt16LE(p+32),local=bytes.readUInt32LE(p+42);
  const name=bytes.subarray(p+46,p+46+nameSize).toString('utf8');p+=46+nameSize+extra+comment;
  if(!/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name))continue;
  if(flags&1||![0,8].includes(method)||size>4*1024*1024||(total+=size)>6*1024*1024)throw Error('Word protegido o demasiado grande para leer.');
  if(local+30>bytes.length||bytes.readUInt32LE(local)!==0x04034b50)throw Error('Contenido Word inválido.');
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);if(start+compressed>bytes.length)throw Error('Contenido Word incompleto.');
  const data=bytes.subarray(start,start+compressed),decoded=method===8?inflateRawSync(data,{maxOutputLength:4*1024*1024}):data;if(decoded.length!==size)throw Error('Tamaño del contenido Word inválido.');const xml=decoded.toString('utf8');
  parts.push(xml.replace(/<w:br\b[^>]*\/>/g,'\n').replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<\/w:p>/g,'\n').replace(/<\/w:tc>/g,'\t').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g,e=>{const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};if(named[e])return named[e];const n=e.startsWith('&#x')?parseInt(e.slice(3,-1),16):parseInt(e.slice(2,-1),10);return n<=0x10ffff?String.fromCodePoint(n):'';}));
 }
 const output=parts.join('\n').trim();if(!output)throw Error('No encontré texto legible en el Word. Podés exportarlo a PDF.');if(output.length>120000)throw Error('El Word tiene demasiado texto. Dividilo en documentos más pequeños.');return output;
}
module.exports={text};
