import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftBuffer } from "../apps/web/src/lib/draft-buffer";
import { createComposerState } from "../apps/web/src/components/composer-state";

test("composer subscribers observe current text and cursor without redundant notifications", () => {
  const state=createComposerState();let updates=0;
  const unsubscribe=state.subscribe(()=>updates++);
  state.text("Привет");state.text("Привет");state.cursor(6);state.cursor(6);
  assert.deepEqual(state.getSnapshot(),{text:"Привет",cursor:6});assert.equal(updates,2);
  unsubscribe();state.text("");assert.equal(updates,2);
});
test("draft buffer coalesces edits and flushes latest values for all chats on exit", async () => {
  const writes:unknown[]=[];let backups=0;
  const buffer=createDraftBuffer((id,value)=>writes.push([id,value]),()=>backups++,15,40);
  buffer.change("first",{text:"а"});buffer.change("first",{text:"аб"});buffer.change("second",{text:"в"});
  assert.equal(writes.length,0);buffer.flush();
  assert.deepEqual(writes,[["first",{text:"аб"}],["second",{text:"в"}]]);assert.equal(backups,1);
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(writes.length,2);
});
test("continuous typing still receives a bounded local save", async () => {
  const writes:string[]=[];const buffer=createDraftBuffer<string>((_,value)=>writes.push(value),()=>{},30,45);
  const interval=setInterval(()=>buffer.change("chat",String(Date.now())),5);
  try { await new Promise(resolve=>setTimeout(resolve,100));assert.ok(writes.length>=1); }
  finally {clearInterval(interval);buffer.flush();}
});
