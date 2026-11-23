// Telegram WebAppData: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const encoder = new TextEncoder();
async function hmac(key: Uint8Array, value: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, encoder.encode(value)));
}
export async function telegramUser(initData: string, token: string, now = Date.now()) {
  if (!token || !initData || initData.length > 16384) throw new Error('Откройте форму через команду /blogger в Telegram');
  const params = new URLSearchParams(initData);
  if (new Set(params.keys()).size !== [...params.keys()].length) throw new Error('Некорректная подпись');
  const hash = params.get('hash') || '';
  params.delete('hash');
  const check = [...params].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
  const expected = [...await hmac(await hmac(encoder.encode('WebAppData'), token), check)].map(v => v.toString(16).padStart(2,'0')).join('');
  let difference = expected.length ^ hash.length;
  for (let i=0; i<expected.length; i++) difference |= expected.charCodeAt(i) ^ (hash.charCodeAt(i) || 0);
  if (difference) throw new Error('Некорректная подпись Telegram');
  const age = Math.floor(now / 1000) - Number(params.get('auth_date'));
  if (!Number.isFinite(age) || !params.get('auth_date') || age < -30 || age > 3600) throw new Error('Сессия истекла. Откройте форму заново командой /blogger');
  const user = JSON.parse(params.get('user') || '{}');
  if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Не найден пользователь Telegram');
  return user.id as number;
}
