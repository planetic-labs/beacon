import type {FastifyInstance} from 'fastify';
import {fromNodeHeaders} from 'better-auth/node';
import {z} from 'zod';
import {HttpError} from '../../lib/http';
import {transaction,createNode,node,access,audit} from '../../modules/storage/service';
import {nodeName,maxUploadSize,guessedMime} from '../../modules/storage/validation';
import {integrationPrincipal,authorizeIntegrationUpload} from '../../modules/storage/integration-access';
import {tusRoutes} from './storage-upload';
export const integrationUploadPath='/api/integrations/v1/uploads';
export const integrationUploadInput=z.object({name:nodeName,size:z.number().int().min(0).max(maxUploadSize)}).strict();
export async function integrationUploadRoutes(app:FastifyInstance){
 await app.register(async scoped=>tusRoutes(scoped,{policy:{path:`${integrationUploadPath}/chunks`,authenticate:async headers=>(await integrationPrincipal(headers)).user,authorize:authorizeIntegrationUpload}}));
 app.route({method:['POST','GET','HEAD','PUT','PATCH','DELETE'],url:integrationUploadPath,handler:run});
 app.route({method:['GET','HEAD','PUT','PATCH','DELETE'],url:`${integrationUploadPath}/:id`,handler:run});
}
async function run(request:import('fastify').FastifyRequest,reply:import('fastify').FastifyReply){
 try{
  const headers=fromNodeHeaders(request.headers),{integration,user}=await integrationPrincipal(headers);
  const path=new URL(request.url,'http://request.invalid').pathname;
  if(request.method==='POST'&&path===integrationUploadPath){
   const value=integrationUploadInput.parse(Buffer.isBuffer(request.body)?JSON.parse(request.body.toString()):request.body);
   const n=await transaction(async c=>{const n=await createNode(c,user,{spaceId:integration.spaceId,parentId:integration.parentId,name:value.name,size:value.size,mime:guessedMime(value.name),state:'uploading',directory:false});await audit(c,user,`integration-upload:${integration.id}`,n);return n;});
   return reply.code(201).send({id:n.id,state:n.state,uploadEndpoint:`${integrationUploadPath}/chunks`,metadata:{nodeId:n.id}});
  }
  if(['GET','HEAD'].includes(request.method)&&path!==integrationUploadPath){
   const id=z.uuid().parse(path.split('/').pop());const n=await transaction(async c=>{const n=await node(c,id);await authorizeIntegrationUpload(headers,c,n);await access(c,n.space_id,n.id,user,true);return n;});
   return reply.send({id:n.id,name:n.name,size:Number(n.size),state:n.state});
  }
  return reply.code(405).header('Allow',path===integrationUploadPath?'POST':'GET, HEAD').send({error:'Интеграция поддерживает только новые загрузки и их состояние'});
 }catch(error){const status=error instanceof HttpError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:500;return reply.code(status).header('Cache-Control','no-store').send({error:status===500?'Не удалось выполнить запрос':error instanceof HttpError?error.message:'Проверьте параметры загрузки'});}
}
