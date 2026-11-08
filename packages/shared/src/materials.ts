export type MaterialChapter={seconds:number;title:string};
export type MaterialKind='video'|'audio'|'image'|'document';
export type Material={id:string;fileName:string;kind:MaterialKind;mime:string;size:number;title:string;description:string;coverId:string|null;duration:number;published:boolean;needsReview:boolean;available:boolean;checking?:boolean;revision:number;position:number;updatedAt:string;chapters:MaterialChapter[]};
export type MaterialPlaylist={id:string;name:string;materialIds:string[];kind:'folder'|'virtual';enabled?:boolean};
export type MaterialInput=Pick<Material,'title'|'description'|'coverId'|'chapters'>&{reviewed?:boolean};
export type MaterialCatalog={materials:Material[];playlists:MaterialPlaylist[];checking?:number};
