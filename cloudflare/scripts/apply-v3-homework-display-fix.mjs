import fs from 'node:fs';

const [,, serverFile = 'src/v3.ts', htmlFile = 'public/index.html'] = process.argv;
let server = fs.readFileSync(serverFile, 'utf8');
let html = fs.readFileSync(htmlFile, 'utf8');

const occurrences=[];
let pos=0;
while((pos=html.indexOf('declareHomework',pos))>=0){occurrences.push(pos);pos+=1;}
console.log('RAW_DECLARE_HOMEWORK_COUNT',occurrences.length);
occurrences.forEach((index,i)=>{
  console.log(`RAW_DECLARE_CONTEXT_${i+1}_START`);
  console.log(html.slice(Math.max(0,index-1200),index+1800));
  console.log(`RAW_DECLARE_CONTEXT_${i+1}_END`);
});
if(!occurrences.length)throw new Error('No raw declareHomework occurrence found');
throw new Error('INSPECTION_ONLY');
