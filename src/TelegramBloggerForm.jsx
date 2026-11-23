import { useEffect, useRef, useState } from 'react';
import './TelegramBloggerForm.css';
const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
const initial = () => ({productId:'',date:today(),bloggerId:'',format:'',link:'',integ:'',delivery:'',prod:'',buyoutOn:false,buyoutSum:'',reviewOn:false,reviewStatus:'не оставила отзыв',note:'',newBlogger:{name:'',inst:'',tg:'',tiktok:'',price:'',rating:'',image:''}});
const rub = n => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(n);
export default function TelegramBloggerForm() {
  const [form,setForm]=useState(initial), [catalog,setCatalog]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false), [result,setResult]=useState(null), [newMode,setNewMode]=useState(false), [query,setQuery]=useState('');
  const requestId=useRef(crypto.randomUUID()), initData=useRef(''), saving=useRef(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const api=async body=>{
    const base=import.meta.env.VITE_SUPABASE_URL;
    if(!base) throw new Error('Не настроено подключение сервиса');
    const r=await fetch(`${base}/functions/v1/tg-blogger`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,initData:initData.current})});
    const data=await r.json(); if(!r.ok) throw new Error(data.error||'Ошибка сервиса'); return data;
  };
  const load=async()=>{
    setError('');
    try {
      if(!window.Telegram?.WebApp) await new Promise((resolve,reject)=>{
        const s=document.createElement('script'); s.src='https://telegram.org/js/telegram-web-app.js'; s.onload=resolve; s.onerror=()=>reject(new Error('Не удалось загрузить Telegram. Откройте форму заново')); document.head.appendChild(s);
      });
      const tg=window.Telegram?.WebApp;
      if(!tg?.initData) throw new Error('Откройте эту форму кнопкой бота после команды /blogger в Telegram');
      initData.current=tg.initData; tg.ready(); tg.expand();
      setCatalog(await api({action:'bootstrap'}));
    } catch(e) {setError(e.message);}
  };
  useEffect(()=>{load();},[]);
  const submit=async e=>{
    e.preventDefault(); if(saving.current) return; saving.current=true; setBusy(true); setError('');
    try { const data=await api({action:'save',requestId:requestId.current,form:{...form,bloggerId:newMode?'':form.bloggerId}}); setResult(data.result); window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success'); }
    catch(e){setError(e.message);} finally {saving.current=false;setBusy(false);}
  };
  const field=(key,label,type='text',required=false)=><label className="tb-field" key={key}>{label}<input type={type} required={required} value={form[key]} onChange={e=>set(key,e.target.value)} maxLength={2000} {...(type==='text'&&['integ','delivery','prod','buyoutSum'].includes(key)?{inputMode:'decimal',placeholder:'0'}:{})}/></label>;
  const total=['integ','delivery','prod',...(form.buyoutOn?['buyoutSum']:[])].reduce((sum,k)=>sum+(Number(String(form[k]).replace(/\s/g,'').replace(',','.'))||0),0);
  return <main className="tb"><header><span className="tb-brand">Мелори · Одежда</span><h1>Добавить блогера в РНП</h1><p>Все данные интеграции в одной форме</p></header>
    {error&&<div role="alert" className="tb-error">{error}{!catalog&&<button type="button" onClick={load}>Повторить загрузку</button>}</div>}
    {result?<section className="tb-card"><h2>Добавлено в РНП</h2><p>{result.blogger}</p><p>{result.code} · {result.product}</p><p>{result.date.split('-').reverse().join('.')}</p><button className="tb-primary" onClick={()=>{requestId.current=crypto.randomUUID();setForm(initial());setResult(null);setNewMode(false);setQuery('');load();}}>Добавить ещё</button></section>:!catalog?<p aria-live="polite">{error?'':'Загрузка данных…'}</p>:<form onSubmit={submit}>
      <fieldset disabled={busy}><section className="tb-card"><h2>Интеграция</h2><label className="tb-field">Поиск товара<input type="search" placeholder="Название или артикул" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label className="tb-field">Товар *<select required value={form.productId} onChange={e=>set('productId',e.target.value)}><option value="">Выберите товар</option>{catalog.products.filter(p=>p.id===form.productId||`${p.code} ${p.name}`.toLowerCase().includes(query.toLowerCase())).map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
      {field('date','Дата интеграции *','date',true)}
      <div className="tb-row"><h3>Блогер *</h3><button type="button" onClick={()=>setNewMode(!newMode)}>{newMode?'Выбрать из базы':'+ Новый блогер'}</button></div>
      {newMode?<div className="tb-new">{[['name','Имя блогера *'],['inst','Instagram — ссылка'],['tg','Telegram — ссылка'],['tiktok','TikTok — ссылка'],['price','Стоимость поста, ₽'],['rating','Оценка (0–5)'],['image','Ссылка на фото']].map(([k,label])=><label className="tb-field" key={k}>{label}<input required={k==='name'} type={['inst','tg','tiktok','image'].includes(k)?'url':'text'} inputMode={['price','rating'].includes(k)?'decimal':undefined} value={form.newBlogger[k]} maxLength={2000} onChange={e=>set('newBlogger',{...form.newBlogger,[k]:e.target.value})}/></label>)}<small>Новый блогер получит статус «новый».</small></div>:<label className="tb-field"><select aria-label="Блогер" required value={form.bloggerId} onChange={e=>set('bloggerId',e.target.value)}><option value="">Выберите блогера</option>{catalog.bloggers.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      <label className="tb-field">Формат<select value={form.format} onChange={e=>set('format',e.target.value)}>{['','инста пост','инста сторис','рилс','тг пост','тикток'].map(v=><option key={v} value={v}>{v||'Не выбран'}</option>)}</select></label>{field('link','Ссылка на пост','url')}
      </section><section className="tb-card"><h2>Расходы</h2><div className="tb-costs">{field('integ','Интеграция, ₽')}{field('delivery','Доставка, ₽')}{field('prod','Товар, ₽')}</div>
      <label className="tb-toggle">Выкупит товар<input type="checkbox" role="switch" checked={form.buyoutOn} onChange={e=>set('buyoutOn',e.target.checked)}/></label>{form.buyoutOn&&field('buyoutSum','Сумма выкупа, ₽')}
      <label className="tb-toggle">Оставит отзыв<input type="checkbox" role="switch" checked={form.reviewOn} onChange={e=>set('reviewOn',e.target.checked)}/></label>{form.reviewOn&&<label className="tb-field">Статус отзыва<select value={form.reviewStatus} onChange={e=>set('reviewStatus',e.target.value)}>{['не оставила отзыв','отзыв прошёл','отзыв не прошёл'].map(v=><option key={v}>{v}</option>)}</select></label>}
      </section><section className="tb-card"><h2>Примечание</h2><textarea aria-label="Примечание" placeholder="Договорённости, сроки и детали" maxLength={10000} value={form.note} onChange={e=>set('note',e.target.value)}/></section>
      <footer><div className="tb-row"><span>Итого расходов</span><strong>{rub(total)}</strong></div><button type="submit" className="tb-primary">{busy?'Сохраняем…':'Добавить в РНП'}</button><small>Запись сохранится в проекте «Мелори»</small></footer></fieldset></form>}
  </main>;
}
