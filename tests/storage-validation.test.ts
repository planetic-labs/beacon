import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { v7 } from 'uuid';
import { LocalStorage } from '../apps/api/src/modules/files/storage';
import { nodeName, guessedMime, safeInlineTypes } from '../apps/api/src/modules/storage/validation';
test('file names remain data rather than filesystem paths',()=>{
 for(const name of ['../secret','a/b','a\\b','..','.','a\0b',''])assert.equal(nodeName.safeParse(name).success,false);
 assert.equal(nodeName.parse('  Семейное фото.jpg  '),'Семейное фото.jpg');
 assert.equal(guessedMime('test.HTML'),'application/octet-stream');assert.equal(safeInlineTypes.has('image/svg+xml'),false);
});
test('shared file adapter preserves exclusive writes and range reads',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'beacon-storage-'));const storage=new LocalStorage(root),key=v7();
 try{await storage.saveStream(key,Readable.from(['abcdef']));let result='';for await(const part of await storage.readStream(key,2,4))result+=part;assert.equal(result,'cde');assert.deepEqual(await storage.info(key),{size:6});await assert.rejects(storage.save(key,new Uint8Array([1])));await assert.rejects(storage.read('../secret'));await storage.remove(key);await storage.remove(key);assert.equal(await storage.info(key),null);await assert.rejects(storage.read(key));}finally{await rm(root,{recursive:true,force:true});}
});

import { configuredStorages } from '../apps/api/src/modules/storage/config';
test('storage configuration rejects invalid roots and duplicate IDs without revealing config',()=>{
 assert.equal(configuredStorages('[]').length,0);
 assert.throws(()=>configuredStorages(JSON.stringify([{id:'home',name:'Home',path:'/data/home',personal_parent:'users',personal_folders:{}}])));
 assert.equal(configuredStorages('[{"id":"team","name":"Общее","path":"/data/team"}]')[0].mode,'local');
 for(const raw of ['invalid','[{"id":"team","name":"Общее","path":"relative"}]','[{"id":"home","name":"Личное","path":"/data/home","personal_parent":"../escape"}]','[{"id":"a","name":"A","path":"/data/a"},{"id":"a","name":"B","path":"/data/b"}]'])assert.throws(()=>configuredStorages(raw),error=>error instanceof Error&&error.message.startsWith('Invalid STORAGES_JSON')&&!error.message.includes(raw));
});

import { MountedStorage } from '../apps/api/src/modules/storage/filesystem';
import { writeFile, readFile, lstat, symlink, mkdir } from 'node:fs/promises';
import type { PoolClient } from 'pg';
test('mounted files publish only after verification, refuse collisions and symlink traversal',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'beacon-mounted-'));
 const key=v7();let target='Ready.txt';
 const client={query:async()=>({rows:[{filesystem_path:target}]})} as unknown as PoolClient;
 const storage=new MountedStorage(root,client,v7());
 let release!:()=>void,started!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve;}),first=new Promise<void>(resolve=>{started=resolve;});
 async function* chunks(){yield Buffer.from('abc');started();await hold;yield Buffer.from('def');}
 try{
   const pending=storage.publish(key,Readable.from(chunks()),6);
   await first;await assert.rejects(lstat(path.join(root,target)),{code:'ENOENT'});
   assert.equal(await readFile(path.join(root,'.beacon-uploads',`${key}.part`),'utf8'),'abc');
   release();const result=await pending;assert.equal(result.sha256.length,64);
   assert.equal(await readFile(path.join(root,target),'utf8'),'abcdef');
   assert.equal((await storage.publish(key,Readable.from(['abcdef']),6)).sha256,result.sha256);
   await assert.rejects(lstat(path.join(root,'.beacon-uploads',`${key}.part`)),{code:'ENOENT'});
   await assert.rejects(storage.publish(key,Readable.from(['different']),9));
   assert.equal(await readFile(path.join(root,target),'utf8'),'abcdef');
   target='Incomplete.txt';await assert.rejects(storage.publish(key,Readable.from(['short']),50));
   await assert.rejects(lstat(path.join(root,target)),{code:'ENOENT'});
   await mkdir(path.join(root,'outside'));await writeFile(path.join(root,'outside','secret'),'unchanged');
   await symlink(path.join(root,'outside'),path.join(root,'alias'));
   target='alias/secret';await assert.rejects(storage.read(key));
   target='../outside/secret';await assert.rejects(storage.read(key));
 }finally{release();await rm(root,{recursive:true,force:true});}
});

test('completed Tus upload publishes the staged inode without a second full-file copy',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'beacon-direct-tus-')),key=v7();
 const client={query:async()=>({rows:[{filesystem_path:'Finished.txt'}]})} as unknown as PoolClient;
 const storage=new MountedStorage(root,client,v7());
 try{
  const directory=await storage.uploadDirectory();const staged=await storage.uploadFile(key);
  await writeFile(staged,'direct bytes');const before=await lstat(staged);
  await assert.rejects(storage.finishUpload(key,99));await assert.rejects(lstat(path.join(root,'Finished.txt')),{code:'ENOENT'});
  const result=await storage.finishUpload(key,12);assert.equal(result.sha256.length,64);
  assert.equal((await lstat(path.join(root,'Finished.txt'))).ino,before.ino);
  assert.equal((await lstat(staged)).ino,before.ino);
  await writeFile(path.join(directory,`${key}.json`),'{}');
  await storage.cleanupUpload(key);await storage.cleanupUpload(key);
  await assert.rejects(lstat(staged),{code:'ENOENT'});assert.equal(await readFile(path.join(root,'Finished.txt'),'utf8'),'direct bytes');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('mounted publication detects staged byte corruption before publishing',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'beacon-corrupted-')),key=v7();
 const client={query:async()=>({rows:[{filesystem_path:'Ready.txt'}]})} as unknown as PoolClient;
 const storage=new MountedStorage(root,client,v7());
 async function* chunks(){
  yield Buffer.from('original');
  await writeFile(path.join(root,'.beacon-uploads',`${key}.part`),'modified');
 }
 try{
  await assert.rejects(storage.publish(key,chunks() as unknown as Readable,8),/Upload checksum mismatch/);
  await assert.rejects(lstat(path.join(root,'Ready.txt')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
