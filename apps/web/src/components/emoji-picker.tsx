import { useState } from "react";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import russian from "emoji-picker-react/data/emojis-ru";

export default function Picker({userId,choose}:{userId:string;choose:(emoji:string)=>void}){
  const storageKey=`beacon:emoji-recents:${userId}`;
  const [recent,setRecent]=useState<string[]>(()=>{
    try{const saved:unknown=JSON.parse(localStorage.getItem(storageKey)??"[]");return Array.isArray(saved)?saved.filter((id):id is string=>typeof id==="string"&&/^[a-f0-9]+(?:-[a-f0-9]+)*$/i.test(id)).slice(0,32):[];}catch{return [];}
  });
  const selected=(value:EmojiClickData)=>{
    choose(value.emoji);
    const next=[value.unified,...recent.filter(id=>id!==value.unified)].slice(0,32);
    setRecent(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{/* Emoji insertion works without browser storage. */}
  };
  return <EmojiPicker emojiData={russian} lang="ru" emojiStyle="native" colorScheme="light" width="100%" height="100%"
    autoFocusSearch={false} onEmojiClick={selected} suggestedEmojis={recent} suggestedEmojisMode="recent" previewConfig={{showPreview:false}}
    labels={{searchPlaceholder:"Поиск эмодзи",searchLabel:"Поиск эмодзи",searchClear:"Очистить поиск",searchResultsNone:"Эмодзи не найдены",searchResultsOne:"Найден один эмодзи",searchResultsMany:"Найдено эмодзи: %n",categoryNavigation:"Категории эмодзи",reactions:"Реакции",expandReactions:"Все эмодзи",loading:"Загружаем эмодзи…",loadingError:"Не удалось загрузить эмодзи",retryLoading:"Повторить",skinToneNeutral:"Стандартный оттенок",skinToneLight:"Светлый оттенок кожи",skinToneMediumLight:"Умеренно светлый оттенок кожи",skinToneMedium:"Средний оттенок кожи",skinToneMediumDark:"Умеренно тёмный оттенок кожи",skinToneDark:"Тёмный оттенок кожи"}}/>;
}
