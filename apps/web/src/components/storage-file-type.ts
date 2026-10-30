export type StorageFileKind='folder'|'image'|'video'|'audio'|'pdf'|'text'|'document'|'spreadsheet'|'presentation'|'archive'|'code'|'file';
type FileDescription={name:string;directory:boolean;mime?:string};
const extensions:Record<string,StorageFileKind>={
 jpg:'image',jpeg:'image',png:'image',gif:'image',webp:'image',avif:'image',heic:'image',heif:'image',bmp:'image',tif:'image',tiff:'image',svg:'image',ico:'image',
 mp4:'video',webm:'video',mov:'video',m4v:'video',mkv:'video',avi:'video',mpeg:'video',mpg:'video',ogv:'video',wmv:'video',ts:'code',
 mp3:'audio',wav:'audio',ogg:'audio',oga:'audio',opus:'audio',m4a:'audio',aac:'audio',flac:'audio',aiff:'audio',wma:'audio',
 pdf:'pdf',txt:'text',md:'text',rtf:'document',log:'text',doc:'document',docx:'document',odt:'document',pages:'document',
 csv:'spreadsheet',tsv:'spreadsheet',xls:'spreadsheet',xlsx:'spreadsheet',ods:'spreadsheet',numbers:'spreadsheet',
 ppt:'presentation',pptx:'presentation',odp:'presentation',key:'presentation',
 zip:'archive','7z':'archive',rar:'archive',tar:'archive',gz:'archive',bz2:'archive',xz:'archive',tgz:'archive',zst:'archive',
 json:'code',xml:'code',html:'code',htm:'code',css:'code',js:'code',jsx:'code',tsx:'code',py:'code',sh:'code',yml:'code',yaml:'code',toml:'code',sql:'code',c:'code',cpp:'code',h:'code',go:'code',rs:'code',
};
export function storageFileKind(file:FileDescription):StorageFileKind{
 if(file.directory)return 'folder';
 const mime=file.mime?.split(';')[0].trim().toLowerCase()??'';
 if(mime.startsWith('image/'))return 'image';
 if(mime.startsWith('video/'))return 'video';
 if(mime.startsWith('audio/'))return 'audio';
 if(mime==='application/pdf')return 'pdf';
 if(/spreadsheet|excel|tab-separated-values|text\/csv/.test(mime))return 'spreadsheet';
 if(/presentation|powerpoint/.test(mime))return 'presentation';
 if(/wordprocessing|msword|opendocument.text|application\/rtf/.test(mime))return 'document';
 if(/zip|compressed|application\/x-tar|application\/zstd/.test(mime))return 'archive';
 if(/json|javascript|xml/.test(mime))return 'code';
 const extension=file.name.includes('.')?file.name.split('.').pop()!.toLowerCase():'';
 return Object.hasOwn(extensions,extension)?extensions[extension]:(mime.startsWith('text/')?'text':'file');
}
