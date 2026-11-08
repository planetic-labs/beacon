import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {pool} from '../../db';
import {HttpError} from '../../lib/http';
import type {PoolClient} from 'pg';
import type {Node} from './service';
export const integrationCapabilities=['files:create','files:update','files:delete'] as const;
const definitions=z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),tokenSha256:z.string().regex(/^[a-f0-9]{64}$/),userId:z.uuid(),spaceId:z.uuid(),parentId:z.uuid().nullable().default(null),capabilities:z.array(z.enum(integrationCapabilities)).default(['files:create'])}).strict()).max(20);
export async function integrationPrincipal(headers:Headers,capability:typeof integrationCapabilities[number]='files:create',client?:PoolClient){
 const token=headers.get('authorization')?.match(/^Bearer ([^\s]{32,512})$/i)?.[1];
 if(!token)throw new HttpError(401,'Требуется ключ интеграции');
 const digest=createHash('sha256').update(token).digest();
 const entries=definitions.parse(JSON.parse(process.env.UPLOAD_INTEGRATIONS_JSON||'[]'));
 const integration=entries.find(entry=>timingSafeEqual(digest,Buffer.from(entry.tokenSha256,'hex')));
 if(!integration)throw new HttpError(401,'Неверный ключ интеграции');
 if(!integration.capabilities.includes(capability))throw new HttpError(403,'Операция недоступна интеграции');
 const user=(await (client??pool).query('select id,role,banned from "user" where id=$1',[integration.userId])).rows[0];
 if(!user||user.banned)throw new HttpError(401,'Интеграция отключена');
 return{integration,user};
}
export async function authorizeIntegrationUpload(headers:Headers,c:PoolClient,n:Node){
 const {integration,user}=await integrationPrincipal(headers,'files:create',c);
 const owned=(await c.query('select 1 from storage_audit where node_id=$1 and user_id=$2 and action=$3 limit 1',[n.id,user.id,`integration-upload:${integration.id}`])).rowCount;
 if(!owned||n.space_id!==integration.spaceId||n.parent_id!==integration.parentId||n.created_by!==user.id||n.deleted_at)throw new HttpError(404,'Загрузка не найдена');
}
