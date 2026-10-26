import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentLimits, attachmentName, messageTypes } from "../packages/shared/src/index";
test("attachment limits and display names are bounded independently",()=>{
 const input={text:"",fileId:"019a0000-0000-7000-8000-000000000001",name:"sample.zip",size:attachmentLimits.file+1,mime:"application/octet-stream"};
 assert.equal(messageTypes.file.validate.safeParse(input).success,false);
 assert.equal(messageTypes.video.validate.safeParse(input).success,true);
 assert.equal(messageTypes.video.validate.safeParse({...input,size:attachmentLimits.video+1}).success,false);
 assert.equal(attachmentName("../folder/Документ\r\n.html"),"Документ.html");
 assert.equal(attachmentName("C:\\private\\archive.zip"),"archive.zip");
 assert.doesNotThrow(()=>encodeURIComponent(attachmentName("😀".repeat(121))));
});
