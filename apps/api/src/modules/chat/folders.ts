import {sql} from "drizzle-orm";
import {db} from "../../db";
import {HttpError} from "../../lib/http";
import {rows,writable,type Actor,type Tx} from "./service";
export async function folderList(actor:Actor){
  return rows(sql`select f.id,f.name,array(select i.chat_id from chat_folder_item i join chat_member m on m.chat_id=i.chat_id and m.user_id=f.user_id where i.folder_id=f.id order by i.chat_id) as "chatIds" from chat_folder f where f.user_id=${actor.id} order by f.created_at,f.id`);
}
async function changed(tx:Tx,userId:string){await tx.execute(sql`insert into outbox(kind,payload) values('folders.changed',${JSON.stringify({userIds:[userId]})}::jsonb)`);}
export async function saveFolder(actor:Actor,id:string|undefined,input:{name:string;chatIds:string[]}){
 return db.transaction(async tx=>{
  await writable(tx,actor);
  if(id){const found=await rows(sql`select id from chat_folder where id=${id} and user_id=${actor.id} for update`,tx);if(!found.length)throw new HttpError(404,"Папка не найдена");}
  else{const [{count}]=await rows(sql`select count(*)::int as count from chat_folder where user_id=${actor.id}`,tx);if(count>=20)throw new HttpError(400,"Можно создать до 20 папок");}
  const chatIds=[...new Set(input.chatIds)];
  if(chatIds.length){const allowed=await rows(sql`select m.chat_id from chat_member m join chat c on c.id=m.chat_id where m.user_id=${actor.id} and m.chat_id in (${sql.join(chatIds.map(chatId=>sql`${chatId}::uuid`),sql`,`)}) and c.kind<>'saved' for share of m`,tx);if(allowed.length!==chatIds.length)throw new HttpError(403,"Одна из переписок недоступна");}
  if(id)await tx.execute(sql`update chat_folder set name=${input.name} where id=${id}`);
  else{const [created]=await rows(sql`insert into chat_folder(user_id,name) values(${actor.id},${input.name}) returning id`,tx);id=created.id;}
  await tx.execute(sql`delete from chat_folder_item where folder_id=${id}`);
  for(const chatId of chatIds)await tx.execute(sql`insert into chat_folder_item(folder_id,chat_id) values(${id},${chatId})`);
  await changed(tx,actor.id);return {id:id!};
 });
}
export async function deleteFolder(actor:Actor,id:string){
 return db.transaction(async tx=>{await writable(tx,actor);const deleted=await rows(sql`delete from chat_folder where id=${id} and user_id=${actor.id} returning id`,tx);if(!deleted.length)throw new HttpError(404,"Папка не найдена");await changed(tx,actor.id);return {ok:true};});
}
