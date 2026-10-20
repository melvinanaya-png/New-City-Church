import PDFDocument from 'pdfkit';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=JSON.parse(await readFile(root+'fees.json','utf8'));
const doc=new PDFDocument({size:'LETTER',margin:48,info:{Title:'Building Usage Fees — New City Church St. Charles'}});
const chunks=[];doc.on('data',chunk=>chunks.push(chunk));
const completed=new Promise((resolve,reject)=>{doc.on('end',resolve);doc.on('error',reject);});
doc.font(root+'public/assets/fonts/Barlow-Regular.ttf');
function heading() {
  doc.image(root+'public/assets/new-city-logo.png',48,40,{width:180});
  doc.fillColor('#333132').fontSize(24).text('BUILDING USAGE FEES',48,116);
  doc.fillColor('#68676b').fontSize(10).text(`New City Church St. Charles · Updated ${data.updated}`,48,149);
}
function table(title,rateLabel,rows) {
  doc.fillColor('#333132').fontSize(16).text(title,48,185);
  let y=218;
  doc.rect(48,y,516,28).fill('#4f8cad');doc.fillColor('white').fontSize(11).text('Room / service',60,y+7).text(rateLabel,390,y+7,{width:162,align:'right'});y+=28;
  for(const [room,rate] of rows) {
    if(rate!==null && (!Number.isFinite(rate)||rate<0))throw Error('Invalid rate');
    doc.rect(48,y,516,28).fill((y-246)%56===0?'#fcfaed':'#ffffff');
    doc.fillColor('#333132').fontSize(11).text(room,60,y+7,{width:320}).text(rate===null?'Contact church for pricing':`$${rate}`,370,y+7,{width:182,align:'right'});y+=28;
  }
  return y;
}
heading();let y=table('Room usage fees for non-members','Hourly rate',data.hourlyNonMembers);
doc.fillColor('#68676b').fontSize(10).text('City Students, Pre K, Upper Elementary, Lower Elementary and Nursery are each $25 per hour for non-members. The church will confirm all applicable charges before payment.',48,y+18,{width:516});
doc.addPage();heading();y=table('Usage fees for members','Flat rate',data.flatMembers);
doc.fillColor('#333132').fontSize(12).text('Additional responsibilities',48,y+22);
doc.fontSize(10).text('Lost building key: $50. Damage charges are not a fixed fee; the church determines charges from the damage and repair or replacement costs.',48,y+43,{width:516});
doc.text('Kitchen use is optional with City Commons. Select Kitchen if you intend to use it. Your group handles setup, teardown and cleanup unless the church confirms assistance separately. This form does not automatically assign setup help.',48,y+82,{width:516});
doc.text('The original fee sheet lists both hourly and flat-rate sections. The church will confirm which charges apply to your request before payment. This form does not calculate or collect payment.',48,y+121,{width:516});
doc.end();await completed;await writeFile(root+'public/assets/building-usage-fees.pdf',Buffer.concat(chunks));
console.log('Updated fee sheet generated. Student and children’s rooms use the confirmed $25 rates.');
