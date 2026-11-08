// Synthetic API/account data only. Exercises the actual cache hooks and provider.
import {chromium,expect} from '@playwright/test';
import {createServer} from '../apps/web/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../apps/web/',import.meta.url));
const entry=`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{AppQueryProvider}from'/src/query-provider.tsx';
import{useStorageListing,useStorageMutation}from'/src/components/storage-queries.ts';
import{storageApi}from'/src/components/storage-api.ts';
import{acceptAccount,forgetAccount}from'/src/offline.ts';
window.setAccount=async id=>{window.owner=id;await acceptAccount({id,name:id,role:'admin'});};window.logout=forgetAccount;
await window.setAccount('account-a');
const h=React.createElement;
function App(){const[parent,setParent]=useState(null),one=useStorageListing('space',parent),two=useStorageListing('space',parent),mutation=useStorageMutation();return h('main',null,
...['root','slow','fast','denied'].map(name=>h('button',{key:name,onClick:()=>setParent(name==='root'?null:name)},name)),
h('button',{onClick:()=>one.fetchNextPage()},'more'),h('button',{onClick:()=>mutation.mutate(()=>storageApi('/test','POST',{}))},'rename'),h('button',{onClick:()=>one.refetch()},'retry'),
h('p',{id:'one'},one.nodes.map(n=>n.name).join(',')),h('p',{id:'two'},two.nodes.map(n=>n.name).join(',')),h('p',{id:'error'},one.error?.message));}
createRoot(document.getElementById('root')).render(h(AppQueryProvider,null,h(App)));
`;
const server=await createServer({root,configFile:root+'vite.config.ts',plugins:[{name:'query-fixture',resolveId:id=>id==='/query-entry.jsx'?'\0query-entry.jsx':undefined,load:id=>id==='\0query-entry.jsx'?entry:undefined,configureServer(server){server.middlewares.use('/__query',async(_req,res)=>{res.setHeader('content-type','text/html');res.end(await server.transformIndexHtml('/__query','<html><body><div id="root"></div><script type="module" src="/query-entry.jsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0}});await server.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors:string[]=[],calls=new Map<string,number>();let renamed=false,deny=true;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/storage**',async route=>{const url=new URL(route.request().url());if(route.request().method()==='POST'){renamed=true;await route.fulfill({json:{ok:true}});return;}
  const parent=url.searchParams.get('parentId')??'root',offset=Number(url.searchParams.get('offset')??0),owner=await page.evaluate(()=>(window as any).owner),key=`${owner}/${parent}/${offset}`;calls.set(key,(calls.get(key)??0)+1);
  if(parent==='slow')await new Promise(resolve=>setTimeout(resolve,500));
  if(parent==='denied'&&deny){await route.fulfill({status:403,json:{error:'Denied'}});return;}
  const name=parent==='root'?offset?'second':renamed?'renamed':'first':parent;
  await route.fulfill({json:{nodes:[{id:`${owner}/${parent}/${offset}`,name:`${owner}/${name}`,state:'ready'}],breadcrumbs:[],canWrite:true,nextOffset:parent==='root'&&!offset?1:null}}).catch(()=>{});
 });
 await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}/__query`);
 await expect(page.locator('#one')).toHaveText('account-a/first');await expect(page.locator('#two')).toHaveText('account-a/first');assert.equal(calls.get('account-a/root/0'),1,'Observers share one request');
 await page.getByRole('button',{name:'more',exact:true}).click();await expect(page.locator('#two')).toHaveText('account-a/first,account-a/second');
 await page.getByRole('button',{name:'rename',exact:true}).click();await expect(page.locator('#one')).toHaveText('account-a/renamed,account-a/second');
 await page.getByRole('button',{name:'slow',exact:true}).click();await page.getByRole('button',{name:'fast',exact:true}).click();await expect(page.locator('#two')).toHaveText('account-a/fast');
 await page.waitForTimeout(650);await expect(page.locator('#one')).toHaveText('account-a/fast');
 await page.getByRole('button',{name:'denied',exact:true}).click();await expect(page.locator('#error')).toHaveText('Denied');assert.equal(calls.get('account-a/denied/0'),1,'Forbidden requests are not retried');
 deny=false;await page.getByRole('button',{name:'retry',exact:true}).click();await expect(page.locator('#one')).toHaveText('account-a/denied');
 await page.getByRole('button',{name:'slow',exact:true}).click();await page.evaluate(()=>(window as any).setAccount('account-b'));await expect(page.locator('#one')).toHaveText('account-b/slow');await expect(page.locator('#two')).not.toContainText('account-a');
 await page.evaluate(()=>(window as any).logout());await expect(page.locator('#one')).toHaveText('');await expect(page.locator('#two')).toHaveText('');
 assert.deepEqual(errors,[]);await page.close();console.log('PASS Storage query deduplication, pagination, mutation refresh, navigation races, forbidden retries and account isolation');
}finally{await browser.close();await server.close();}
