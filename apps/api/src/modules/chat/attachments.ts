import { sql } from "drizzle-orm";
import { member, rows, type Actor } from "./service";
import { HttpError } from "../../lib/http";
import { messageLinks, type AttachmentCategory, type AttachmentPage, type PhotoAlbum } from "@beacon/shared";
const photoIds=(content:Record<string,any>):string[]=>content.fileIds??(content.fileId?[content.fileId]:[]);
export async function chatAttachments(chatId:string,actor:Actor,kind:AttachmentCategory,cursor?:{id:string;at:string}):Promise<AttachmentPage> {
  await member(chatId,actor);
  const filter=kind==="links"?sql`m.type in ('text','photo','file','video') and (m.content->>'text') ~* 'https?://'`
    :kind==="video"?sql`m.type in ('video','circle')`:kind==="audio"?sql`m.type='audio'`:sql`m.type=${kind}`;
  const messages=await rows(sql`select m.id,m.type,m.content,u.name as "authorName",to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
    from message m join "user" u on u.id=m.author_id where m.chat_id=${chatId} and m.deleted_at is null and ${filter}
    and exists(select 1 from chat_member cm where cm.chat_id=m.chat_id and cm.user_id=${actor.id})
    ${cursor?sql`and (m.created_at,m.id)<(${cursor.at}::timestamptz,${cursor.id}::uuid)`:sql``}
    order by m.created_at desc,m.id desc limit 31`);
  const page=messages.slice(0,30),ids=[...new Set(page.flatMap(m=>photoIds(m.content)))];
  const files=ids.length?await rows(sql`select id,mime,size,original_name as name from media_file where id in (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`):[];
  const last=page.at(-1);
  return {items:page.map(m=>({messageId:m.id,type:m.type,text:m.content.text??"",authorName:m.authorName,createdAt:m.createdAt,duration:m.content.duration,
    files:photoIds(m.content).map(id=>files.find(f=>f.id===id)).filter(Boolean) as any[],links:kind==="links"?messageLinks(m.content.text??""):[]})),
    ...(messages.length>30&&last?{next:{id:last.id,at:last.createdAt}}:{})};
}
export async function photoAlbum(chatId:string,messageId:string,actor:Actor):Promise<PhotoAlbum> {
  await member(chatId,actor);
  const [message]=await rows(sql`select m.id,m.content,u.name as "authorName",to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
    (select id from message p where p.chat_id=m.chat_id and p.type='photo' and p.deleted_at is null and (p.created_at,p.id)<(m.created_at,m.id) order by p.created_at desc,p.id desc limit 1) as "previousMessageId",
    (select id from message n where n.chat_id=m.chat_id and n.type='photo' and n.deleted_at is null and (n.created_at,n.id)>(m.created_at,m.id) order by n.created_at,n.id limit 1) as "nextMessageId"
    from message m join "user" u on u.id=m.author_id where m.id=${messageId} and m.chat_id=${chatId} and m.type='photo' and m.deleted_at is null
    and exists(select 1 from chat_member cm where cm.chat_id=m.chat_id and cm.user_id=${actor.id})`);
  if(!message)throw new HttpError(404,"Фото больше недоступно");
  const ids=photoIds(message.content);
  const files=ids.length?await rows(sql`select id,mime,size from media_file where id in (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`):[];
  if(!files.length)throw new HttpError(404,"Фото больше недоступно");
  return {messageId:message.id,authorName:message.authorName,createdAt:message.createdAt,text:message.content.text??"",files:ids.map(id=>files.find(f=>f.id===id)).filter(Boolean) as PhotoAlbum["files"],previousMessageId:message.previousMessageId??undefined,nextMessageId:message.nextMessageId??undefined};
}
