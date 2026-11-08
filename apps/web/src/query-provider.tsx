import {useEffect,useMemo,useSyncExternalStore,type ReactNode} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {localGeneration} from './offline';

function subscribe(changed:()=>void){
 window.addEventListener('beacon:device-data',changed);
 window.addEventListener('beacon:account-changed',changed);
 return()=>{window.removeEventListener('beacon:device-data',changed);window.removeEventListener('beacon:account-changed',changed);};
}
// Each login generation owns a separate in-memory cache. Never persist private
// Storage responses or reuse them after logout, even for the same account.
export function AppQueryProvider({children}:{children:ReactNode}){
 const generation=useSyncExternalStore(subscribe,localGeneration);
 const client=useMemo(()=>new QueryClient({defaultOptions:{queries:{staleTime:15000,gcTime:300000,retry:(count,error)=>{const status=(error as Error&{status?:number}).status;return count<1&&(!status||status>=500);}},mutations:{retry:false}}}),[generation]);
 useEffect(()=>()=>client.clear(),[client]);
 return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
