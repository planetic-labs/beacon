import type {FastifyInstance} from 'fastify';
import swagger, {type FastifyStaticSwaggerOptions} from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {fromNodeHeaders} from 'better-auth/node';
import {actor,HttpError} from '../lib/http';
import {z} from 'zod';
import {integrationUploadInput,integrationUploadPath as base} from './controllers/integration-upload';

export async function apiDocumentation(app:FastifyInstance){
 const errors={'400':{description:'Некорректные параметры'},'401':{description:'Нужна авторизация'},'403':{description:'Операция запрещена'},'409':{description:'Конфликт загрузки'}};
 const options:FastifyStaticSwaggerOptions={
  mode:'static',
  specification:{
   document:{
    openapi:'3.0.3',
    info:{title:'Beacon Upload API',version:'1.0.0',description:'Создание новых файлов и продолжение загрузок. Файл с тайм-кодами можно загрузить отдельно, например JSON. Редактирование и удаление готовых файлов недоступны.'},
    servers:[{url:'/'}],
    security:[{IntegrationKey:[]}],
    components:{securitySchemes:{IntegrationKey:{type:'http',scheme:'bearer',description:'Ключ интеграции с разрешением files:create; не пользовательская сессия.'}}},
    paths:{
     [base]:{
      post:{
       operationId:'createUpload',summary:'Зарезервировать новый файл',
       description:'Папка и учётная запись заданы настройками ключа. Существующие файлы не заменяются.',
       requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(integrationUploadInput,{target:'openapi-3.0'}) as {type:'object'}}}},
       responses:{...errors,'201':{
        description:'UUID файла и параметры tus',
        content:{'application/json':{schema:{
         type:'object',required:['id','state','uploadEndpoint','metadata'],
         properties:{id:{type:'string',format:'uuid'},state:{type:'string'},uploadEndpoint:{type:'string'},metadata:{type:'object',properties:{nodeId:{type:'string',format:'uuid'}}}}
        }}}
       }}
      }
     },
     [base+'/{id}']:{
      get:{operationId:'uploadStatus',summary:'Состояние собственной загрузки',
       parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],
       responses:{...errors,'200':{description:'ID, имя, размер и состояние файла'},'404':{description:'Загрузка не найдена'}}
      }
     },
     [base+'/chunks']:{
      post:{operationId:'startTusUpload',summary:'Начать tus-загрузку',
       description:'Tus 1.0: Upload-Length равен размеру файла; Upload-Metadata содержит nodeId в Base64. Location возвращает адрес HEAD/PATCH. Используйте стандартный tus-клиент.',
       parameters:[
        {in:'header',name:'Tus-Resumable',required:true,schema:{type:'string',enum:['1.0.0']}},
        {in:'header',name:'Upload-Length',required:true,schema:{type:'integer',minimum:0}},
        {in:'header',name:'Upload-Metadata',required:true,schema:{type:'string'}}
       ],
       responses:{...errors,'201':{description:'Загрузка создана',headers:{Location:{schema:{type:'string'},description:'Адрес продолжения'}}}}
      }
     },
     [base+'/chunks/{id}']:{
      parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],
      head:{operationId:'tusOffset',summary:'Текущая позиция загрузки',responses:{...errors,'200':{description:'Upload-Offset и Upload-Length'}}},
      patch:{operationId:'appendUploadBytes',summary:'Продолжить незавершённую загрузку',
       description:'Добавление байтов новой загрузки. Готовые файлы изменять нельзя.',
       parameters:[
        {in:'header',name:'Tus-Resumable',required:true,schema:{type:'string',enum:['1.0.0']}},
        {in:'header',name:'Upload-Offset',required:true,schema:{type:'integer',minimum:0}}
       ],
       requestBody:{required:true,content:{'application/offset+octet-stream':{schema:{type:'string',format:'binary'}}}},
       responses:{...errors,'204':{description:'Часть файла принята'}}
      }
     }
    }
   }
  }
 };
 await app.register(swagger,options);
 // Encapsulation covers HTML, redirects, JSON/YAML and every static UI asset.
 await app.register(async secured=>{
  secured.addHook('onRequest',async(request,reply)=>{
   reply.header('Cache-Control','private, no-store');
   try{await actor(fromNodeHeaders(request.headers));}
   catch(error){return reply.code(error instanceof HttpError?error.status:500).send({error:'Для документации API войдите в Beacon'});}
  });
  await secured.register(swaggerUi,{routePrefix:'/api/docs',staticCSP:true,uiConfig:{persistAuthorization:false,supportedSubmitMethods:[],validatorUrl:null}});
 });
}
