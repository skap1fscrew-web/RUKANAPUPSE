import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const token='test-token',secret='test-secret';
globalThis.Deno={env:{get:k=>({TG_BOT_TOKEN:token,TG_WEBHOOK_SECRET:secret,SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-key'})[k]}};
const compiled=await build({entryPoints:[fileURLToPath(new URL('../supabase/functions/tg-tick/index.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'neutral',plugins:[{name:'server',setup(b){b.onResolve({filter:/^https:/},()=>({path:'server',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const serve=handler=>{globalThis.tickHandler=handler;};',loader:'js'}));}}]});
await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-11-28T10:00:00Z');Date.now=()=>now;
let stored,jobs,sends,writes,historyReads,pages,fail;
const base={id:'a',title:'Задача',date:null,stage:'wait',done:false,assignees:['p1'],createdBy:'p2'};
function reset(){stored={seen:{a:['p1']},due:{}};jobs=[structuredClone(base)];sends=[];writes=0;historyReads=0;pages=0;fail=false;}
globalThis.fetch=async(url,init={})=>{
 const u=new URL(url);
 if(u.host==='api.telegram.org'){sends.push(JSON.parse(init.body));return Response.json({ok:true});}
 if(u.pathname.endsWith('/jobs')){
  const selection=u.searchParams.get('select');
  if(selection==='log:data->log'){historyReads++;return Response.json([{log:[{kind:'assignee',by:'p2'}]}]);}
  assert.ok(!selection.includes('files'));assert.ok(!selection.includes('log'));assert.ok(selection.includes('title:data->title'));
  pages++;if(fail)return Response.json({error:'unavailable'},{status:503});
  const offset=Number(u.searchParams.get('offset')||0);return Response.json(jobs.slice(offset,offset+1000));
 }
 if(u.pathname.endsWith('/settings')){
  if(init.method==='POST'){writes++;stored=JSON.parse(init.body).value;return new Response(null,{status:204});}
  const key=u.searchParams.get('key').slice(3);
  const value={tgLinks:{p1:1,p2:2},profiles:[{id:'p1',name:'Один'},{id:'p2',name:'Два'}],tgState:stored}[key];
  return Response.json(value?[{value}]:[]);
 }
 throw new Error('Unexpected request '+u.pathname);
};
const run=()=>globalThis.tickHandler(new Request('https://test.invalid/tick',{method:'POST',headers:{'x-tick-secret':secret}}));
test('Нет изменений: нет уведомлений, истории и записи состояния',async()=>{reset();stored={due:{},seen:{a:['p1']}};assert.equal((await run()).status,200);assert.equal(sends.length,0);assert.equal(writes,0);assert.equal(historyReads,0);});
test('Первый запуск сохраняет базу без уведомлений',async()=>{reset();stored=null;await run();assert.equal(sends.length,0);assert.equal(writes,1);});
test('Назначение исполнителя читает историю только нужной задачи',async()=>{reset();stored.seen.a=[];await run();assert.equal(historyReads,1);assert.equal(sends.length,1);assert.ok(sends[0].text.includes('Вам поручена задача'));});
test('Самоназначение не уведомляет автора',async()=>{reset();stored.seen.a=['p1'];jobs[0].assignees=['p1','p2'];await run();assert.equal(historyReads,1);assert.equal(sends.length,0);});
test('Срок сегодня: одно напоминание и дедупликация',async()=>{reset();jobs[0].date='2026-11-28';await run();assert.equal(sends.length,1);await run();assert.equal(sends.length,1);});
test('Ошибка чтения не стирает состояние',async()=>{reset();fail=true;assert.equal((await run()).status,500);assert.equal(writes,0);assert.equal(sends.length,0);});
test('Каталог больше 1000 задач читается полностью',async()=>{reset();stored=null;jobs=Array.from({length:1001},(_,i)=>({...base,id:'job-'+i}));await run();assert.equal(pages,2);assert.equal(Object.keys(stored.seen).length,1001);});
