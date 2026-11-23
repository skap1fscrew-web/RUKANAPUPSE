import { rest, getSetting, TOKEN } from '../_shared/tg.ts';
import { telegramUser } from './auth.ts';
const origin = 'https://skap1fscrew-web-rukanapupse-09ae.twc1.net';
const headers = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Headers':'content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Vary':'Origin' };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers });
const formats=['','инста пост','инста сторис','рилс','тг пост','тикток'];
const reviews=['не оставила отзыв','отзыв прошёл','отзыв не прошёл'];
function text(value: unknown, max=2000) { if (typeof value !== 'string' || value.length > max) throw new Error('Проверьте текстовые поля'); return value.trim(); }
function money(value: unknown) { const n = Number(String(value ?? '').replace(/\s/g,'').replace(',','.')); if (!Number.isFinite(n) || n<0 || n>100000000) throw new Error('Проверьте суммы расходов'); return n; }
function link(value: unknown) { const s=text(value ?? '',2000); if (s && !/^https?:\/\//i.test(s)) throw new Error('Ссылка должна начинаться с https://'); return s; }
const uuid=(v: unknown) => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
Deno.serve(async req => {
  if (req.method==='OPTIONS') return new Response(null,{headers});
  if (req.method!=='POST') return json({error:'Метод недоступен'},405);
  try {
    const raw=await req.text(); if(raw.length>32768) return json({error:'Слишком большой запрос'},413);
    const body=JSON.parse(raw);
    let user: number;
    try { user=await telegramUser(body.initData,TOKEN); } catch(e) { return json({error:(e as Error).message},401); }
    const links=await getSetting('tgLinks') || {};
    const ids=Object.keys(links).filter(k=>links[k]===user);
    const profiles=await getSetting('profiles') || [];
    const profile=profiles.find((p: {id:string,email:string})=>ids.includes(p.id));
    if (!profile?.email) return json({error:'Сначала привяжите аккаунт: Настройки → Telegram'},403);
    const allowed=await rest(`allowed_emails?email=eq.${encodeURIComponent(profile.email.toLowerCase())}&select=email`);
    if(!allowed.ok || !(await allowed.json()).length) return json({error:'Доступ к сервису закрыт'},403);
    if(body.action==='bootstrap') {
      const response=await rest('products?select=id,data&order=id&limit=1000');
      if(!response.ok) throw new Error('Не удалось загрузить товары');
      const rows=await response.json();
      // Пагинация обязательна: каталог может быть больше стандартного лимита PostgREST.
      for(let offset=1000; rows.length===offset; offset+=1000) {
        const page=await rest(`products?select=id,data&order=id&limit=1000&offset=${offset}`);
        if(!page.ok) throw new Error('Не удалось загрузить каталог');
        rows.push(...await page.json());
      }
      const products=rows.filter((r: any)=>!r.data?.deletedAt).map((r: any)=>({id:r.id,name:r.data.name||'',code:r.data.code||''}));
      const bloggers=(await getSetting('bloggerDB')||[]).filter((b: any)=>!b.deletedAt).map((b:any)=>({id:b.id,name:b.name}));
      return json({products,bloggers});
    }
    if(body.action!=='save') throw new Error('Неизвестное действие');
    const f=body.form || {};
    if(!uuid(body.requestId)||!uuid(f.productId)) throw new Error('Выберите товар');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(f.date)||!Number.isFinite(Date.parse(f.date))||new Date(f.date).toISOString().slice(0,10)!==f.date) throw new Error('Укажите корректную дату');
    if(!formats.includes(f.format||'')) throw new Error('Проверьте формат');
    const entry={format:f.format||'',link:link(f.link),integ:money(f.integ),delivery:money(f.delivery),prod:money(f.prod),buyoutOn:f.buyoutOn===true,buyoutSum:f.buyoutOn===true?money(f.buyoutSum):0,reviewOn:f.reviewOn===true,reviewStatus:f.reviewOn===true&&reviews.includes(f.reviewStatus)?f.reviewStatus:reviews[0],note:text(f.note||'',10000)};
    let blogger: Record<string,unknown>;
    if(f.bloggerId) blogger={id:text(f.bloggerId,200)};
    else {
      const b=f.newBlogger||{};
      blogger={name:text(b.name||'',200),status:'новый',inst:link(b.inst),tg:link(b.tg),tiktok:link(b.tiktok),price:money(b.price),rating:Math.min(5,Math.max(0,money(b.rating))),image:link(b.image)};
      if(!blogger.name) throw new Error('Укажите имя блогера');
    }
    const saved=await rest('rpc/save_telegram_blogger',{method:'POST',body:JSON.stringify({p_actor:profile.id,p_request:body.requestId,p_product:f.productId,p_date:f.date,p_entry:entry,p_blogger:blogger})});
    if(!saved.ok) { console.error('blogger save failed',saved.status); throw new Error('Не удалось сохранить. Проверьте товар и блогера и повторите попытку'); }
    return json({result:await saved.json()});
  } catch(e) { return json({error:(e as Error).message || 'Ошибка сохранения'},400); }
});
