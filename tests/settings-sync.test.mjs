import { test } from 'node:test';
import assert from 'node:assert/strict';
import {stableJson} from '../src/lib/stableJson.js';
test('Порядок полей JSONB не вызывает повторную запись',()=>{
 const tab={rnp:{startDate:'2026-11-01',days:30},unitConst:{tax:'8',cny:'12',nested:{b:2,a:1}}};
 const db={unitConst:{nested:{a:1,b:2},cny:'12',tax:'8'},rnp:{days:30,startDate:'2026-11-01'}};
 assert.equal(stableJson(tab),stableJson(db));
});
test('Реальное изменение и порядок массива сохраняются',()=>{
 assert.notEqual(stableJson({tax:8}),stableJson({tax:9}));
 assert.notEqual(stableJson([{id:1},{id:2}]),stableJson([{id:2},{id:1}]));
});
test('Эхо двух вкладок стабилизируется без следующей записи',()=>{
 let database={days:30,startDate:'2026-11-01'};
 const local={startDate:'2026-11-01',days:30};
 let writes=0;
 for(let echo=0;echo<100;echo++) if(stableJson(database)!==stableJson(local)){writes++;database=structuredClone(local);}
 assert.equal(writes,0);
 local.days=60;
 for(let echo=0;echo<100;echo++) if(stableJson(database)!==stableJson(local)){writes++;database=structuredClone(local);}
 assert.equal(writes,1);
});
