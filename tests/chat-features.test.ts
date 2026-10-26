import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryLabel, moveMentions, searchWords, type Receipt } from "../packages/shared/src/index";
const createdAt="2026-01-01T10:00:00.123456Z";
const person:Receipt={userId:"recipient",name:"Recipient",joinedAt:"2026-01-01T09:00:00.000000Z",deliveredAt:"1970-01-01T00:00:00.000000Z",readAt:"2026-01-01T09:00:00.000000Z"};
test("delivery is acknowledged by recipients, including partial group reads",()=>{
  assert.equal(deliveryLabel([person],"author",createdAt),"Отправлено");
  assert.equal(deliveryLabel([{...person,deliveredAt:createdAt}],"author",createdAt),"Доставлено");
  assert.equal(deliveryLabel([{...person,readAt:createdAt}],"author",createdAt),"Прочитано");
  assert.equal(deliveryLabel([{...person,readAt:createdAt},{...person,userId:"other"}],"author",createdAt),"Прочитано 1 из 2");
  assert.equal(deliveryLabel([{...person,joinedAt:"2026-01-02T00:00:00.000000Z",readAt:"2026-01-02T00:00:00.000000Z"}],"author",createdAt),"Отправлено");
  assert.equal(deliveryLabel([{...person,deliveredAt:"2026-01-01T10:00:00.123455Z"}],"author",createdAt),"Отправлено");
});
test("mention offsets survive insertion and discard edited names, including UTF-16 emoji",()=>{
  const text="👋 @Тест Два привет";
  const m={userId:"id",start:3,length:9};
  assert.deepEqual(moveMentions(text,"Да "+text,[m]),[{...m,start:6}]);
  assert.deepEqual(moveMentions(text,text+"!",[m]),[m]);
  assert.deepEqual(moveMentions(text,text.replace("Два","Три"),[m]),[]);
  assert.deepEqual(moveMentions(text,text.replace("👋 ",""),[m]),[{...m,start:0}]);
});
test("search normalizes Cyrillic without interpreting tsquery operators",()=>{
  assert.deepEqual(searchWords("Ёлка, ПРИГЛАШ & ! :*"),["елка","приглаш"]);
  assert.deepEqual(searchWords("' OR 1=1; --"),["or","1","1"]);
});
