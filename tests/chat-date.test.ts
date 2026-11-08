import {test} from "node:test";
import assert from "node:assert/strict";
import {chatDate} from "../apps/web/src/lib/chat-date";
const local=(year:number,month:number,day:number,hour=12,minute=0)=>new Date(year,month-1,day,hour,minute);
test('chat dates use local calendar boundaries and full dates for other years',()=>{
 const now=local(2026,11,3,15,30);
 assert.equal(chatDate(local(2026,11,3,6,49).toISOString(),now),'06:49');
 assert.equal(chatDate(local(2026,11,2).toISOString(),now),'пн');
 assert.equal(chatDate(local(2026,10,28).toISOString(),now),'ср');
 assert.equal(chatDate(local(2026,10,27).toISOString(),now),'27 окт.');
 assert.equal(chatDate(local(2025,10,27).toISOString(),now),'27.10.2025');
 assert.equal(chatDate(local(2025,12,31).toISOString(),local(2026,1,1)),'31.12.2025');
 assert.equal(chatDate(local(2026,11,2,23,59).toISOString(),local(2026,11,3,0,1)),'пн');
 assert.equal(chatDate('invalid',now),'');assert.equal(chatDate(null,now),'');
});
