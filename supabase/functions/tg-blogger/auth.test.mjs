import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { telegramUser } from './auth.ts';
const token='test-token';
function signed(date=Math.floor(Date.now()/1000),id=123){
 const p=new URLSearchParams({auth_date:String(date),query_id:'test',user:JSON.stringify({id})});
 const check=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const key=createHmac('sha256','WebAppData').update(token).digest();
 p.set('hash',createHmac('sha256',key).update(check).digest('hex')); return p.toString();
}
test('валидная подпись Telegram',async()=>assert.equal(await telegramUser(signed(),token),123));
test('подмена пользователя запрещена',async()=>assert.rejects(()=>telegramUser(signed().replace('123','999'),token)));
test('сессия старше часа запрещена',async()=>assert.rejects(()=>telegramUser(signed(Math.floor(Date.now()/1000)-3601),token)));
test('будущая дата запрещена',async()=>assert.rejects(()=>telegramUser(signed(Math.floor(Date.now()/1000)+100),token)));
test('нет подписи или токена',async()=>{await assert.rejects(()=>telegramUser('',token));await assert.rejects(()=>telegramUser(signed(),''));});
test('дубли параметров запрещены',async()=>assert.rejects(()=>telegramUser(signed()+'&user={}',token)));
