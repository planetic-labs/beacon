import {useQuery} from '@tanstack/react-query';
import {localGeneration,localAccount} from '../offline';
import type {MaterialCatalog,Material} from '@beacon/shared';
class MaterialError extends Error{constructor(message:string,public status:number){super(message);}}
export async function materialApi<T>(path='',method='GET',body?:unknown,keepalive=false,signal?:AbortSignal):Promise<T>{
 const generation=localGeneration();
 const response=await fetch('/api/materials'+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',keepalive,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 const data=await response.json();if(generation!==localGeneration())throw new DOMException('Account changed','AbortError');if(!response.ok)throw new MaterialError(data.error??'Не удалось загрузить материалы',response.status);return data;
}
export function useMaterialCatalog(){
 const query=useQuery({queryKey:['materials',localAccount(),localGeneration(),'catalog'],enabled:!!localAccount(),queryFn:async({signal})=>{const data=await materialApi<MaterialCatalog>('','GET',undefined,false,signal);if(!Array.isArray(data.materials)||!Array.isArray(data.playlists))throw Error('Некорректный ответ каталога');return data;},refetchInterval:q=>q.state.data?.checking?2000:30000});
 return{materials:query.data?.materials??[],playlists:query.data?.playlists??[],checking:query.data?.checking??0,error:query.error?.message??'',loading:query.isPending,refresh:()=>query.refetch()};
}
export function useMaterialDetail(id:string|undefined){return useQuery({queryKey:['materials',localAccount(),localGeneration(),'file',id],enabled:!!localAccount()&&!!id,queryFn:({signal})=>materialApi<Material>('/'+id,'GET',undefined,false,signal),refetchInterval:q=>q.state.data?.checking?2000:30000});}
