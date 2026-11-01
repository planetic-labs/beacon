import {writeFile} from 'node:fs/promises';
import {createChatFixtures} from './chat-fixtures';
import {createChat} from '../apps/api/src/modules/chat/service';
import {pool} from '../apps/api/src/db';
try{
 const fixtures=await createChatFixtures();
 const direct=await createChat({id:fixtures.users[0].id,role:'admin'},{kind:'direct',userIds:[fixtures.users[1].id]});
 await writeFile('/run/test/calls.json',JSON.stringify({...fixtures,directId:direct.id}),{mode:0o600});
 console.log('INFO isolated call browser fixtures ready');
}finally{await pool.end();}
