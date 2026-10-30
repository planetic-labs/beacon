import { useEffect, useRef, useState, type ReactNode, type FormEvent, type DragEvent } from "react";
import { Clock3, Folder, FolderPlus, HardDrive, Menu, Search, Star, Trash2, Upload, X, MoreHorizontal, ChevronRight, Pause, Play, Download, RefreshCw, ChevronDown, CheckCheck } from "lucide-react";
import { storageApi, fileLabel, uploadFile, type Space, type FileNode, type Transfer } from "./storage-api";
import "../storage.css";
import { StorageFileIcon } from "./storage-file-icon";
const storageDragType='application/x-beacon-storage-node';
const sections=[{id:'all',title:'Все файлы',icon:Folder},{id:'recent',title:'Недавние',icon:Clock3},{id:'favorites',title:'Избранное',icon:Star},{id:'trash',title:'Корзина',icon:Trash2}] as const;
function size(value:number){return capacity(value); }
function capacity(value:number){const units=['Б','КБ','МБ','ГБ','ТБ','ПБ'];const index=Math.max(0,Math.min(units.length-1,Math.floor(Math.log2(Math.max(1,value))/10)));return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value/1024**index)} ${units[index]}`;}
function diskUsage(s:Space){const known=s.online!==false&&s.free!=null&&s.total!=null&&s.total>0;return{label:s.online===false?'Хранилище недоступно':known?`Свободно ${capacity(s.free!)} из ${capacity(s.total!)}`:'Нет данных об объёме',percent:known?Math.max(0,Math.min(100,Math.round((1-s.free!/s.total!)*100))):null};}
export function Storage(){
  const [spaces,setSpaces]=useState<Space[]>([]),[spaceId,setSpaceId]=useState(''),[parentId,setParentId]=useState<string|null>(null),[view,setView]=useState('all'),[menuOpen,setMenuOpen]=useState(false);
  const [nodes,setNodes]=useState<FileNode[]>([]),[breadcrumbs,setBreadcrumbs]=useState<{id:string;name:string}[]>([]),[canWrite,setCanWrite]=useState(false),[search,setSearch]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[nextOffset,setNextOffset]=useState<number|null>(null);
  const [selected,setSelected]=useState<FileNode|null>(null),[preview,setPreview]=useState<FileNode|null>(null),[details,setDetails]=useState<FileNode|null>(null),[transfers,setTransfers]=useState<Transfer[]>([]),[destination,setDestination]=useState<{node:FileNode;copy:boolean}|null>(null);
  const listingKey=`${spaceId}:${parentId??''}:${view}`,listingScope=useRef(listingKey);listingScope.current=listingKey;
  const [notice,setNotice]=useState('');
  const [uploadDragging,setUploadDragging]=useState(false),[draggedId,setDraggedId]=useState<string|null>(null),[dropTarget,setDropTarget]=useState<string|null>(null),[moving,setMoving]=useState(false);
  const draggedNode=useRef<FileNode|null>(null),dragDepth=useRef(0);
  function clearDrag(){draggedNode.current=null;dragDepth.current=0;setUploadDragging(false);setDraggedId(null);setDropTarget(null);}
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')clearDrag();};window.addEventListener('dragend',clearDrag);window.addEventListener('drop',clearDrag);window.addEventListener('blur',clearDrag);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('dragend',clearDrag);window.removeEventListener('drop',clearDrag);window.removeEventListener('blur',clearDrag);window.removeEventListener('keydown',escape);};},[]);
  useEffect(()=>{clearDrag();},[spaceId,parentId,view]);
  function externalFiles(event:DragEvent<HTMLElement>){return !event.dataTransfer.types.includes(storageDragType)&&event.dataTransfer.types.includes('Files');}
  function startDrag(event:DragEvent<HTMLElement>,node:FileNode){
    if(!canWrite||view!=='all'||moving||node.state!=='ready'){event.preventDefault();return;}
    draggedNode.current=node;setDraggedId(node.id);setSelected(null);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData(storageDragType,JSON.stringify({id:node.id,spaceId}));
  }
  function acceptsMove(target:string|null){const source=draggedNode.current;return !!source&&source.space_id===spaceId&&canWrite&&view==='all'&&!moving&&source.id!==target&&source.parent_id!==target;}
  function dragOverFolder(event:DragEvent<HTMLElement>,target:string|null){
    if(!event.dataTransfer.types.includes(storageDragType))return;
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=acceptsMove(target)?'move':'none';setDropTarget(acceptsMove(target)?target??'root':null);
  }
  async function dropOnFolder(event:DragEvent<HTMLElement>,target:string|null){
    if(!event.dataTransfer.types.includes(storageDragType))return;
    event.preventDefault();event.stopPropagation();const source=draggedNode.current,allowed=acceptsMove(target);clearDrag();
    if(!source||!allowed)return;
    setMoving(true);await perform(async()=>{await storageApi(`/${source.id}`,'PATCH',{parentId:target});setNotice(`Перемещено: «${fileLabel(source)}»`);});setMoving(false);
  }
  function enterUploads(event:DragEvent<HTMLElement>){if(externalFiles(event)&&canWrite&&view==='all'&&!moving){event.preventDefault();dragDepth.current++;setUploadDragging(true);}}
  function leaveUploads(event:DragEvent<HTMLElement>){if(externalFiles(event)){dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setUploadDragging(false);}}
  function overUploads(event:DragEvent<HTMLElement>){if(externalFiles(event)){event.preventDefault();event.dataTransfer.dropEffect=canWrite&&view==='all'&&!moving?'copy':'none';}}
  function dropUploads(event:DragEvent<HTMLElement>){
    if(!externalFiles(event)){if(event.dataTransfer.types.includes(storageDragType))event.preventDefault();clearDrag();return;}
    event.preventDefault();const allowed=canWrite&&view==='all'&&!moving;clearDrag();
    if(allowed)void droppedFiles(event.dataTransfer).then(upload).catch(e=>setError(e.message));
  }
  const [dialog,setDialog]=useState<'folder'|'upload'|'confirm-upload'|null>(null),[pendingFiles,setPendingFiles]=useState<File[]>([]);
  const files=useRef<HTMLInputElement>(null),folders=useRef<HTMLInputElement>(null),sequence=useRef(0),active=useRef(true);
  const currentSpace=spaces.find(s=>s.id===spaceId),title=sections.find(s=>s.id===view)?.title??'Все файлы';
  useEffect(()=>{active.current=true;storageApi<Space[]>('/spaces').then(value=>{setSpaces(value);setSpaceId(value[0]?.id??'');if(!value.length)setLoading(false);}).catch(e=>setError(e.message));return()=>{active.current=false;};},[]);
  async function refreshSpaces(){try{const value=await storageApi<Space[]>('/spaces');if(active.current)setSpaces(value);}catch{/* Keep the last capacity snapshot during temporary network failures. */}}
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')void refreshSpaces();},30000);const visible=()=>{if(document.visibilityState==='visible')void refreshSpaces();};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[]);
  async function load(quiet=false){if(!spaceId||listingScope.current!==listingKey)return;const seq=++sequence.current;if(!quiet)setLoading(true);try{const result=await storageApi<{nodes:FileNode[];breadcrumbs:{id:string;name:string}[];canWrite:boolean;nextOffset:number|null}>(`?${new URLSearchParams({spaceId,view,...(parentId?{parentId}:{})})}`);if(seq===sequence.current&&active.current&&listingScope.current===listingKey){setNodes(result.nodes);setBreadcrumbs(result.breadcrumbs);setCanWrite(result.canWrite);setNextOffset(result.nextOffset??null);}}catch(e){if(seq===sequence.current)setError((e as Error).message);}finally{if(seq===sequence.current)setLoading(false);}}
  useEffect(()=>{setSelected(null);void load();return()=>{sequence.current++;};},[spaceId,parentId,view]);
  useEffect(()=>{if(!nodes.some(n=>['uploading','processing','copying','purging'].includes(n.state))&&!transfers.some(t=>t.state==='processing'))return;const timer=setInterval(()=>void load(true),2000);return()=>clearInterval(timer);},[nodes,transfers,spaceId,parentId,view]);
  useEffect(()=>{if(transfers.some(t=>t.state==='processing'&&nodes.some(n=>n.id===t.id&&n.state==='ready')))void refreshSpaces();setTransfers(previous=>previous.map(t=>t.state==='processing'&&nodes.some(n=>n.id===t.id&&n.state==='ready')?{...t,state:'done'}:t));},[nodes]);
  useEffect(()=>{
    if(!transfers.some(t=>t.state==='processing'))return;
    const timer=setInterval(()=>{for(const t of transfers)if(t.state==='processing')void storageApi<FileNode>(`/${t.id}`).then(n=>{if(n.state==='ready'||n.state==='error')updateTransfer({...t,state:n.state==='ready'?'done':'error'});}).catch(()=>{});},2000);
    return()=>clearInterval(timer);
  },[transfers]);
  const completedTransferIds=transfers.filter(t=>t.state==='done').map(t=>t.id).join(',');
  useEffect(()=>{if(completedTransferIds){void load(true);void refreshSpaces();}},[completedTransferIds]);
  function select(v:string){setView(v);setParentId(null);setMenuOpen(false);setSearch('');}
  async function perform(run:()=>Promise<unknown>){try{setError('');await run();setSelected(null);await load(true);void refreshSpaces();}catch(e){setError((e as Error).message);}}
  async function loadMore(){if(nextOffset===null)return;try{const result=await storageApi<{nodes:FileNode[];nextOffset:number|null}>(`?${new URLSearchParams({spaceId,view,offset:String(nextOffset),...(parentId?{parentId}:{})})}`);setNodes(old=>Array.from(new Map([...old,...result.nodes].map(n=>[n.id,n])).values()));setNextOffset(result.nextOffset);}catch(e){setError((e as Error).message);}}
  function updateTransfer(t:Transfer){transfersRef.current=transfersRef.current.some(x=>x.id===t.id)?transfersRef.current.map(x=>x.id===t.id?t:x):[...transfersRef.current,t];if(active.current)setTransfers(old=>{const exists=old.some(item=>item.id===t.id);return exists?old.map(item=>item.id===t.id?t:item):[...old,t];});}
  async function upload(list:FileList|File[]|null,confirmed=false){if(!list?.length)return;setError('');
    const items=Array.from(list);if(files.current)files.current.value='';if(folders.current)folders.current.value='';
    if(items.length>1&&!confirmed){setPendingFiles(items);setDialog('confirm-upload');return;}
    setDialog(null);
    const directories=new Map<string,string>();
    for(const file of items){if(!active.current)return;try{
      let target=parentId;const relative=file.webkitRelativePath.split('/').slice(0,-1);let path='';
      for(const name of relative){path+=`/${name}`;if(directories.has(path)){target=directories.get(path)!;continue;}
        let folder:FileNode;try{folder=await storageApi<FileNode>('','POST',{spaceId,parentId:target,name,directory:true});}catch(e){const listing=await storageApi<{nodes:FileNode[]}>(`?${new URLSearchParams({spaceId,...(target?{parentId:target}:{})})}`);const found=listing.nodes.find(n=>n.name===name&&n.directory);if(!found)throw e;folder=found;}directories.set(path,folder.id);target=folder.id;}
      // Limit active uploads to two; larger queues wait without reading files into memory.
      while(active.current&&transfersRef.current.filter(t=>t.state==='uploading').length>=2)await new Promise(r=>setTimeout(r,300));
      if(!active.current)return;
      await uploadFile(file,spaceId,target,t=>{const old=transfersRef.current;transfersRef.current=old.some(x=>x.id===t.id)?old.map(x=>x.id===t.id?t:x):[...old,t];updateTransfer(t);});
    }catch(e){setError((e as Error).message);}}
    void load(true);if(files.current)files.current.value='';if(folders.current)folders.current.value='';
  }
  const transfersRef=useRef<Transfer[]>([]);
  function open(n:FileNode){if(n.directory){setParentId(n.id);setView('all');setSearch('');}else if(n.state==='ready'){setPreview(n);}}
  async function action(n:FileNode,kind:string){
    if(kind==='rename'){const name=prompt('Новое название',n.name);if(name)await perform(()=>storageApi(`/${n.id}`,'PATCH',{name}));}
    if(kind==='move'||kind==='copy'){setSelected(null);setDestination({node:n,copy:kind==='copy'});}
    if(kind==='trash'&&confirm(`Переместить «${fileLabel(n)}» в корзину?`))await perform(()=>storageApi(`/${n.id}`,'DELETE'));
    if(kind==='restore')await perform(()=>storageApi(`/${n.id}/restore`,'POST'));
    if(kind==='purge'&&confirm(`Удалить «${fileLabel(n)}» без возможности восстановления?`))await perform(()=>storageApi(`/${n.id}/purge`,'POST'));
    if(kind==='retry')await perform(()=>storageApi(`/${n.id}/retry`,'POST'));
    if(kind==='details'){setDetails(await storageApi<FileNode>(`/${n.id}`));setSelected(null);}
  }
  const uploadBytes=transfers.reduce((sum,t)=>sum+Math.max(1,t.size),0);
  const uploadProgress=uploadBytes?Math.round(transfers.reduce((sum,t)=>sum+Math.max(1,t.size)*t.progress,0)/uploadBytes):0;
  const activeUploads=transfers.filter(t=>t.state==='uploading').length,processingUploads=transfers.filter(t=>t.state==='processing').length;
  const completedUploads=transfers.filter(t=>t.state==='done').length;
  const uploadLabel=activeUploads?`Загружается: ${activeUploads}`:processingUploads?`Обработка: ${processingUploads}`:transfers.some(t=>t.state==='error')?'Есть ошибки загрузки':transfers.some(t=>t.state==='paused')?'Загрузка приостановлена':`Загружено: ${completedUploads}`;
  const backgroundFiles=nodes.filter(n=>['copying','processing'].includes(n.state)&&!transfers.some(t=>t.id===n.id)).length;
  const visible=nodes.filter(n=>`${fileLabel(n)} ${n.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <>
    {menuOpen&&<button className="ss-backdrop" aria-label="Закрыть меню хранилища" onClick={()=>setMenuOpen(false)}/>}
    <aside className={`ss-sidebar ${menuOpen?'open':''}`} aria-label="Меню хранилища">
      <div className="ss-brand"><span className="ss-brand-mark"><Folder size={22}/></span>Файлы<button className="ss-menu-close ss-icon-button" aria-label="Закрыть меню" onClick={()=>setMenuOpen(false)}><X size={20}/></button></div>
      <div><p className="ss-side-label">Навигация</p><nav className="ss-nav-list" aria-label="Разделы хранилища">{sections.map(item=><button key={item.id} className={`ss-nav ${view===item.id?'active':''}`} onClick={()=>select(item.id)}><item.icon size={18}/>{item.title}</button>)}</nav></div>
      <div><p className="ss-side-label">Хранилища</p><div className="ss-nav-list">{spaces.map(s=><button key={s.id} className={`ss-storage ${spaceId===s.id?'active':''}`} aria-label={`${s.name}: ${diskUsage(s).label}`} onClick={()=>{setSpaceId(s.id);select('all');}}><HardDrive size={18}/><span className="ss-storage-info"><span className="ss-storage-name">{s.name}</span><span className="ss-storage-sub">{diskUsage(s).label}</span><span className={`ss-storage-meter ${s.online===false?'unavailable':''}`} role={diskUsage(s).percent===null?undefined:'meter'} aria-label={`Заполненность хранилища ${s.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={diskUsage(s).percent??undefined} aria-valuetext={diskUsage(s).label}><i style={{width:`${diskUsage(s).percent??0}%`}}/></span></span></button>)}</div></div>
    </aside>
    <main className={`ss-main ${uploadDragging?'ss-upload-dragging':''}`} onDragEnter={enterUploads} onDragLeave={leaveUploads} onDragOver={overUploads} onDrop={dropUploads}>
      {uploadDragging&&<div className="ss-drop-hint" role="status"><div><Upload size={24}/><strong>Отпустите файлы для загрузки</strong><span>В папку «{breadcrumbs.at(-1)?.name??currentSpace?.name}»</span></div></div>}
      <div className="ss-workspace">
      <header className="ss-topbar"><button className="ss-icon-button ss-menu-toggle" aria-label="Открыть меню хранилища" onClick={()=>setMenuOpen(true)}><Menu size={20}/></button>
        <div className="ss-search"><Search size={18}/><input type="search" placeholder="Поиск в текущем списке" aria-label="Поиск файлов" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="ss-top-actions"><button className="ss-icon-button" aria-label="Обновить файлы" onClick={()=>{void load();void refreshSpaces();}}><RefreshCw size={18}/></button><button type="button" className="ss-icon-button ss-create-folder" aria-label="Новая папка" disabled={!canWrite||view!=='all'} onClick={()=>setDialog('folder')}><FolderPlus size={18}/><span className="ss-tooltip" aria-hidden="true">Создать папку</span></button><button className="ss-primary-button" disabled={!canWrite||view==='trash'} onClick={()=>setDialog('upload')}><Upload size={16}/><span>Загрузить</span></button></div>
        <input type="file" multiple hidden ref={files} onChange={e=>void upload(e.target.files)}/><input type="file" multiple hidden ref={folders} {...{webkitdirectory:''}} onChange={e=>void upload(e.target.files)}/>
      </header>
      <div className="ss-heading"><h1>{title}</h1><div className="ss-heading-right">
        {(error||notice||transfers.length>0||backgroundFiles>0)&&<section className="ss-activity" aria-label="Уведомления хранилища">
          {error&&<div className="ss-activity-message ss-activity-error" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Закрыть ошибку"><X size={15}/></button></div>}
          {notice&&<div className="ss-activity-message" role="status"><CheckCheck size={16}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Скрыть уведомление"><X size={15}/></button></div>}
          {backgroundFiles>0&&<div className="ss-activity-message" role="status"><RefreshCw size={15}/><span>Обработка файлов: {backgroundFiles}</span></div>}
          {!!transfers.length&&<details className="ss-upload-panel"><summary><Upload size={16}/><span>{uploadLabel}</span><progress aria-label="Общий прогресс загрузки" max={100} value={uploadProgress}/><small>{uploadProgress}%</small><ChevronDown size={15} className="ss-upload-chevron"/></summary><div className="ss-transfers" aria-label="Загрузки">{transfers.map(t=><div className="ss-transfer-row" key={t.id}><span className="ss-transfer-name" title={t.name}>{t.name}</span><progress aria-label={`Загрузка ${t.name}`} max={100} value={t.progress}/><span>{t.state==='done'?'Готово':t.state==='processing'?'Обработка…':t.state==='error'?'Ошибка':t.state==='paused'?'Пауза':`${t.progress}%`}</span>{t.state==='uploading'?<button aria-label="Приостановить загрузку" onClick={()=>{void t.upload.abort();t.state='paused';updateTransfer({...t});}}><Pause size={16}/></button>:['paused','error'].includes(t.state)?<button aria-label="Продолжить загрузку" onClick={()=>{t.state='uploading';updateTransfer({...t});if(t.progress===100){void storageApi(`/${t.id}/retry`,'POST').then(()=>updateTransfer({...t,state:'processing'})).catch(e=>setError(e.message));}else t.upload.start();}}><Play size={16}/></button>:null}{t.state!=='done'&&<button aria-label="Отменить загрузку" onClick={()=>void perform(async()=>{await t.upload.abort();await storageApi(`/${t.id}`,'DELETE');transfersRef.current=transfersRef.current.filter(x=>x.id!==t.id);setTransfers(old=>old.filter(x=>x.id!==t.id));})}><X size={16}/></button>}</div>)}{completedUploads>0&&<button className="ss-clear-transfers" onClick={()=>{transfersRef.current=transfersRef.current.filter(t=>t.state!=='done');setTransfers(old=>old.filter(t=>t.state!=='done'));}}>Очистить завершённые</button>}</div></details>}
        </section>}

      </div></div>
      <nav className="ss-breadcrumbs" aria-label="Путь к папке"><button className={dropTarget==='root'?'ss-drop-target':''} onDragOver={e=>dragOverFolder(e,null)} onDragLeave={()=>setDropTarget(null)} onDrop={e=>void dropOnFolder(e,null)} onClick={()=>{setParentId(null);setView('all');}}>{currentSpace?.name}</button>{breadcrumbs.map(p=><span key={p.id}><ChevronRight size={14}/><button className={dropTarget===p.id?'ss-drop-target':''} onDragOver={e=>dragOverFolder(e,p.id)} onDragLeave={()=>setDropTarget(null)} onDrop={e=>void dropOnFolder(e,p.id)} onClick={()=>{setParentId(p.id);setView('all');}}>{p.name}</button></span>)}</nav>
      <section className="ss-card ss-files-card" aria-label="Файлы"><div className="ss-table-head"><span>Название</span><span>Изменён</span><span>Размер</span><span/></div>
        {visible.map(n=><div className={`ss-file-row ${dropTarget===n.id?'ss-drop-target':''} ${draggedId===n.id?'ss-drag-source':''}`} key={n.id} onDragOver={n.directory&&n.state==='ready'?e=>dragOverFolder(e,n.id):undefined} onDragLeave={n.directory?e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDropTarget(null);}:undefined} onDrop={n.directory&&n.state==='ready'?e=>void dropOnFolder(e,n.id):undefined}>
          <button className="ss-file-name" draggable={canWrite&&view==='all'&&!moving&&n.state==='ready'} onDragStart={e=>startDrag(e,n)} onDragEnd={clearDrag} onClick={()=>open(n)} disabled={n.state!=='ready'||view==='trash'}><StorageFileIcon file={n}/><span title={fileLabel(n)}>{fileLabel(n)}<small>{n.state==='uploading'?'Ожидает загрузки':n.state==='processing'?'Обработка…':n.state==='copying'?'Копирование…':n.state==='error'?'Ошибка обработки':''}</small></span></button>
          <span className="ss-file-date">{new Date(n.updated_at).toLocaleDateString()}</span><span className="ss-file-size">{n.directory?'—':size(n.size)}</span>
          <div className="ss-row-actions"><button aria-label={n.favorite?'Убрать из избранного':'В избранное'} className={`ss-icon-button ${n.favorite?'ss-starred':''}`} onClick={()=>void perform(()=>storageApi(`/${n.id}/favorite`,'POST',{favorite:!n.favorite}))}><Star size={16}/></button><button className="ss-icon-button" aria-label={`Действия: ${fileLabel(n)}`} onClick={()=>setSelected(selected?.id===n.id?null:n)}><MoreHorizontal size={18}/></button>
          {selected?.id===n.id&&<div className="ss-actions-menu">{n.state==='error'?<><button onClick={()=>void action(n,'retry')}>Повторить операцию</button><button onClick={()=>void action(n,view==='trash'?'purge':'trash')}>{view==='trash'?'Удалить навсегда':'В корзину'}</button></>:view==='trash'?<><button onClick={()=>void action(n,'restore')}>Восстановить</button><button onClick={()=>void action(n,'purge')}>Удалить навсегда</button></>:<><button onClick={()=>void action(n,'details')}>Сведения</button><button onClick={()=>void action(n,'rename')}>Переименовать</button><button onClick={()=>void action(n,'move')}>Переместить</button><button onClick={()=>void action(n,'copy')}>Копировать</button><button onClick={()=>void action(n,'trash')}>В корзину</button></>}</div>}</div>
        </div>)}
        {!visible.length&&<div className="ss-empty"><Folder size={42}/><h2>{loading?'Загружаем файлы…':!spaces.length?'Нет подключённых хранилищ':search?'Ничего не найдено':view==='trash'?'Корзина пуста':view==='favorites'?'Пока нет избранных файлов':view==='recent'?'Пока нет недавних файлов':'В этой папке пока пусто'}</h2></div>}
      {nextOffset!==null&&<button className="ss-soft-button" onClick={()=>void loadMore()}>Показать ещё</button>}</section>

    </div></main>
    {dialog==='folder'&&<CreateFolder spaceId={spaceId} parentId={parentId} close={()=>setDialog(null)} created={()=>{setDialog(current=>current==='folder'?null:current);setNotice('Папка создана');void load(true);}}/>}
    {dialog==='upload'&&<UploadDialog close={()=>setDialog(null)} chooseFiles={()=>files.current?.click()} chooseFolder={()=>folders.current?.click()} drop={data=>void droppedFiles(data).then(upload).catch(e=>setError(e.message))}/>}
    {dialog==='confirm-upload'&&<StorageDialog title="Загрузить" close={()=>{setDialog(null);setPendingFiles([]);}}><div className="ss-upload-summary"><strong>{pendingFiles.length} файлов · {size(pendingFiles.reduce((sum,f)=>sum+f.size,0))}</strong><span>Место: {currentSpace?.name}{breadcrumbs.map(p=>' / '+p.name).join('')}</span></div><p className="ss-modal-note">Структура папок сохранится. Существующие файлы не будут перезаписаны.</p><div className="ss-modal-footer"><button className="ss-soft-button" onClick={()=>{setDialog(null);setPendingFiles([]);}}>Отмена</button><button className="ss-primary-button" onClick={()=>{const items=pendingFiles;setPendingFiles([]);void upload(items,true);}}>Начать загрузку</button></div></StorageDialog>}
    {preview&&<Preview file={preview} close={()=>setPreview(null)}/>}
    {details&&<div className="ss-modal-backdrop" onClick={()=>setDetails(null)}><section className="ss-modal" role="dialog" aria-modal="true" aria-label="Сведения о файле" onClick={e=>e.stopPropagation()}><button className="ss-modal-close" aria-label="Закрыть" onClick={()=>setDetails(null)}><X/></button><h2>{fileLabel(details)}</h2><p>UUID: <code>{details.id}</code></p><p>{details.directory?'Папка':size(details.size)}</p>{!details.directory&&<><p>SHA-256: {details.sha256??(details.hash_state==='queued'?'Рассчитывается…':'Не рассчитан')}</p><button className="ss-soft-button" onClick={()=>void perform(async()=>{await storageApi(`/${details.id}/hash`,'POST');setDetails(await storageApi<FileNode>(`/${details.id}`));})}>Рассчитать SHA-256</button></>}</section></div>}
    {destination&&<Destination spaceId={spaceId} node={destination.node} copy={destination.copy} close={()=>setDestination(null)} done={()=>{setDestination(null);void load();}}/>}
  </>;
}
function Preview({file,close}:{file:FileNode;close:()=>void}){
  const url=`/api/storage/content/${file.id}`;
  const [text,setText]=useState('');useEffect(()=>{if(file.mime==='text/plain')fetch(url,{headers:{Range:'bytes=0-1048575'}}).then(r=>{if(!r.ok)throw new Error();return r.text();}).then(setText).catch(()=>setText('Не удалось загрузить текст'));},[url,file.mime]);
  return <div className="ss-modal-backdrop" onClick={close}><section className="ss-modal ss-preview" role="dialog" aria-modal="true" aria-label={file.name} onClick={e=>e.stopPropagation()}><button className="ss-modal-close" aria-label="Закрыть просмотр" onClick={close}><X/></button><h2>{file.name}</h2>{file.mime.startsWith('image/')?<img src={url} alt={file.name}/>:file.mime.startsWith('video/')?<video controls src={url}/>:file.mime.startsWith('audio/')?<audio controls src={url}/>:file.mime==='application/pdf'?<iframe title={file.name} src={url}/>:file.mime==='text/plain'?<pre>{text}</pre>:<p>Предпросмотр этого формата недоступен.</p>}<a className="ss-soft-button" href={`${url}?download=1`}><Download size={17}/>Скачать оригинал</a></section></div>;
}
function Destination({spaceId,node,copy,close,done}:{spaceId:string;node:FileNode;copy:boolean;close:()=>void;done:()=>void}){
 const [parent,setParent]=useState<string|null>(null),[folders,setFolders]=useState<FileNode[]>([]),[crumbs,setCrumbs]=useState<{id:string;name:string}[]>([]),[name,setName]=useState(node.name),[error,setError]=useState('');
 useEffect(()=>{let active=true;storageApi<{nodes:FileNode[];breadcrumbs:{id:string;name:string}[]}>(`?${new URLSearchParams({spaceId,...(parent?{parentId:parent}:{})})}`).then(r=>{if(active){setFolders(r.nodes.filter(n=>n.directory&&n.id!==node.id));setCrumbs(r.breadcrumbs);}}).catch(e=>setError(e.message));return()=>{active=false;};},[spaceId,parent,node.id]);
 return <div className="ss-modal-backdrop"><section className="ss-modal" role="dialog" aria-modal="true" aria-label={copy?'Копирование':'Перемещение'}><button className="ss-modal-close" aria-label="Закрыть" onClick={close}><X/></button><h2>{copy?'Копировать':'Переместить'} «{fileLabel(node)}»</h2><nav className="ss-breadcrumbs"><button onClick={()=>setParent(null)}>Корень</button>{crumbs.map(p=><button key={p.id} onClick={()=>setParent(p.id)}>{p.name}</button>)}</nav>{folders.map(f=><button className="ss-nav" key={f.id} onClick={()=>setParent(f.id)}><Folder size={18}/>{fileLabel(f)}</button>)}{copy&&<label>Название копии<input value={name} onChange={e=>setName(e.target.value)}/></label>}{error&&<p role="alert">{error}</p>}<button className="ss-primary-button" onClick={()=>void storageApi(`/${node.id}${copy?'/copy':''}`,copy?'POST':'PATCH',{parentId:parent,name}).then(done).catch(e=>setError(e.message))}>Выбрать эту папку</button></section></div>;
}
async function droppedFiles(data:DataTransfer):Promise<File[]>{
 const result:File[]=[];
 async function visit(entry:FileSystemEntry,prefix=''):Promise<void>{
  if(entry.isFile){const file=await new Promise<File>((resolve,reject)=>(entry as FileSystemFileEntry).file(resolve,reject));if(prefix)Object.defineProperty(file,'webkitRelativePath',{value:`${prefix}${file.name}`});result.push(file);}
  else if(entry.isDirectory){const reader=(entry as FileSystemDirectoryEntry).createReader();for(;;){const entries=await new Promise<FileSystemEntry[]>((resolve,reject)=>reader.readEntries(resolve,reject));if(!entries.length)break;for(const child of entries)await visit(child,`${prefix}${entry.name}/`);}}
 }
 const entries=Array.from(data.items).map(item=>item.webkitGetAsEntry?.()).filter((entry):entry is FileSystemEntry=>!!entry);
 if(entries.length){for(const entry of entries)await visit(entry);return result;}return Array.from(data.files);
}
// Dialog layout follows Storage Space's compact forms and upload dropzone.
function StorageDialog({title,children,close}:{title:string;children:ReactNode;close:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 return <dialog ref={dialog} className="ss-action-modal" aria-label={title} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget){const bounds=e.currentTarget.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)close();}}}><header className="ss-modal-header"><h2>{title}</h2><button type="button" className="ss-dialog-close" aria-label="Закрыть" onClick={close}><X size={20}/></button></header>{children}</dialog>;
}
function CreateFolder({spaceId,parentId,close,created}:{spaceId:string;parentId:string|null;close:()=>void;created:()=>void}){
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{input.current?.focus();},[]);
 async function submit(e:FormEvent){e.preventDefault();if(busy||!name.trim())return;setBusy(true);setError('');try{await storageApi('','POST',{spaceId,parentId,name:name.trim(),directory:true});created();}catch(e){setError((e as Error).message);input.current?.focus();}finally{setBusy(false);}}
 return <StorageDialog title="Новая папка" close={close}><form onSubmit={e=>void submit(e)}><label className="ss-field" htmlFor="ss-folder-name">Название папки</label><input ref={input} id="ss-folder-name" className="ss-text-field" placeholder="Например, Материалы" autoFocus maxLength={240} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/>{error&&<p className="ss-form-error" role="alert">{error}</p>}<div className="ss-modal-footer"><button type="button" className="ss-soft-button" onClick={close}>Отмена</button><button type="submit" className="ss-primary-button" disabled={busy||!name.trim()}>{busy?'Создаём…':'Создать'}</button></div></form></StorageDialog>;
}
function UploadDialog({close,chooseFiles,chooseFolder,drop}:{close:()=>void;chooseFiles:()=>void;chooseFolder:()=>void;drop:(data:DataTransfer)=>void}){
 const [dragging,setDragging]=useState(false);
 return <StorageDialog title="Загрузить" close={close}><div className={`ss-dropzone ${dragging?'drag-over':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);drop(e.dataTransfer);}}><Upload size={32}/><strong>Перетащите файлы или папку сюда</strong><p>или выберите на устройстве</p><div className="ss-upload-choices"><button type="button" className="ss-soft-button" onClick={chooseFiles}>Выбрать файлы</button><button type="button" className="ss-soft-button" onClick={chooseFolder}>Выбрать папку</button></div></div><p className="ss-modal-note">До 1 ТБ на файл. После выбора загрузка продолжится в фоне. Новые файлы добавятся в очередь.</p></StorageDialog>;
}
