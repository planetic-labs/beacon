import { test } from "node:test";
import assert from "node:assert/strict";
import { messageLinks } from "../packages/shared/src/index";
test("shared links accept only explicit credential-free web URLs and trim punctuation",()=>{
 assert.deepEqual(messageLinks("Сайт (https://example.com/a). Ещё https://example.com/a и javascript:alert(1)"),["https://example.com/a"]);
 assert.deepEqual(messageLinks("https://example.com/a(b) https://example.com/second!"),["https://example.com/a(b)","https://example.com/second"]);
 assert.deepEqual(messageLinks("http://user:secret@example.com/ https://example.com/<script>"),["https://example.com/"]);
 assert.equal(messageLinks(Array.from({length:25},(_,i)=>`https://example.com/${i}`).join(" ")).length,20);
});

test("link cleanup handles long punctuation and closing-bracket tails",()=>{
 const tail="!".repeat(100000);
 assert.deepEqual(messageLinks(`https://example.com/path${tail}`),["https://example.com/path"]);
 assert.deepEqual(messageLinks(`https://example.com/a(b)${")".repeat(100000)}`),["https://example.com/a(b)"]);
 assert.deepEqual(messageLinks("https://example.com/path)]} https://example.com/ok"),["https://example.com/path","https://example.com/ok"]);
});
