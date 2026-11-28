// JSONB не сохраняет порядок ключей. Сравниваем содержимое, сохраняя порядок массивов.
export function stableJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.keys(item).sort().reduce((sorted, key) => { sorted[key] = item[key]; return sorted; }, Object.create(null));
  });
}
