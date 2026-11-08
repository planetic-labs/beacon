import {useInfiniteQuery,useMutation,useQueries,useQuery,useQueryClient} from '@tanstack/react-query';
import {useMemo} from 'react';
import {localAccount,localGeneration} from '../offline';
import {storageApi,type Space,type FileNode,type Transfer} from './storage-api';
export type StorageListing={nodes:FileNode[];breadcrumbs:{id:string;name:string}[];canWrite:boolean;nextOffset:number|null};
export const storageKey=()=>['storage',localAccount()??null,localGeneration()] as const;
export const storageNodeKey=(id:string)=>[...storageKey(),'node',id] as const;
const working=(n:FileNode)=>['uploading','processing','copying','purging'].includes(n.state)||n.hash_state==='queued';
export function useStorageSpaces(){return useQuery({queryKey:[...storageKey(),'spaces'],enabled:!!localAccount(),queryFn:({signal})=>storageApi<Space[]>('/spaces','GET',undefined,signal),refetchInterval:30000});}
export function useStorageListing(spaceId:string,parentId:string|null,view='all'){
 const query=useInfiniteQuery({queryKey:[...storageKey(),'listing',spaceId,parentId,view],enabled:!!localAccount()&&!!spaceId,initialPageParam:0,
  queryFn:({signal,pageParam})=>storageApi<StorageListing>(`?${new URLSearchParams({spaceId,view,offset:String(pageParam),...(parentId?{parentId}:{})})}`,'GET',undefined,signal),
  getNextPageParam:last=>last.nextOffset??undefined,
  refetchInterval:query=>query.state.data?.pages.some(page=>page.nodes.some(working))?2000:false,
 });
 const listing=useMemo(()=>{const pages=query.data?.pages??[];return{nodes:Array.from(new Map(pages.flatMap(page=>page.nodes).map(n=>[n.id,n])).values()),breadcrumbs:pages[0]?.breadcrumbs??[],canWrite:pages[0]?.canWrite??false,nextOffset:pages.at(-1)?.nextOffset??null};},[query.data]);
 return{...query,...listing};
}
export function useStorageNode(id:string,enabled=true){return useQuery({queryKey:storageNodeKey(id),enabled:!!localAccount()&&enabled&&!!id,queryFn:({signal})=>storageApi<FileNode>(`/${id}`,'GET',undefined,signal),refetchInterval:query=>query.state.data&&working(query.state.data)?2000:false});}
export function useStorageTransferStatus(transfers:Transfer[]){return useQueries({queries:transfers.filter(t=>t.state==='processing').map(t=>({queryKey:storageNodeKey(t.id),enabled:!!localAccount(),queryFn:({signal}:{signal:AbortSignal})=>storageApi<FileNode>(`/${t.id}`,'GET',undefined,signal),refetchInterval:2000,staleTime:0}))});}
export function useStorageMutation(){
 const client=useQueryClient(),scope=storageKey();
 return useMutation({mutationFn:async(run:()=>Promise<unknown>)=>{if(!localAccount())throw new Error('Войдите в приложение');const generation=localGeneration();const result=await run();if(generation!==localGeneration())throw new DOMException('Account changed','AbortError');return result;},onSuccess:async()=>{await Promise.all([client.invalidateQueries({queryKey:scope}),client.invalidateQueries({queryKey:['materials']})]);}});
}
