// Native Responses input: PDF content and page images, or uploaded PNG/JPEG images.
function inputs(files,ErrorType){
 if(files===undefined)return [];
 if(!Array.isArray(files)||files.length>1)throw new ErrorType(400,'Adjuntá un solo PDF o imagen por mensaje, de hasta 2 MB.');
 return files.map(file=>{
  if(!file||!['application/pdf','image/png','image/jpeg'].includes(file.type)||typeof file.name!=='string'||!file.name.trim()||file.name.length>200||typeof file.data!=='string'||file.data.length>3*1024*1024)throw new ErrorType(400,'El adjunto debe ser PDF, PNG o JPG, de hasta 2 MB.');
  const prefix='data:'+file.type+';base64,';if(!file.data.startsWith(prefix))throw new ErrorType(400,'El formato del adjunto no coincide con su contenido.');
  const base64=file.data.slice(prefix.length);if(!base64||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new ErrorType(400,'El adjunto está dañado. Volvé a subirlo.');
  const bytes=Buffer.from(base64,'base64');if(!Number.isInteger(file.size)||bytes.length!==file.size||bytes.length>2*1024*1024||!bytes.length)throw new ErrorType(400,'El archivo está dañado o supera los 2 MB.');
  const pdf=bytes.subarray(0,1024).includes(Buffer.from('%PDF-')),png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!(file.type==='application/pdf'?pdf:file.type==='image/png'?png:jpg))throw new ErrorType(400,'El contenido no corresponde a un PDF o imagen válida.');
  const filename=file.name.replace(/[\x00-\x1f\x7f/\\]/g,'_');
  return file.type==='application/pdf'?{type:'input_file',filename:filename.toLowerCase().endsWith('.pdf')?filename:filename+'.pdf',file_data:file.data}:{type:'input_image',image_url:file.data,detail:'auto'};
 });
}
module.exports={inputs};
