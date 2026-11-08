import { Button, MenuTrigger, Popover, Menu, MenuItem } from "react-aria-components";
import type { ReactNode } from "react";
export function ActionMenu({label,icon,items,triggerClassName,className}:{label:string;icon:ReactNode;items:{id:string;label:string;icon?:ReactNode;action:()=>void;disabled?:boolean}[];triggerClassName:string;className:string}) {
 return <MenuTrigger><Button aria-label={label} className={triggerClassName}>{icon}</Button><Popover placement="bottom end" className={className}><Menu aria-label={label} onAction={key=>items.find(item=>item.id===key)?.action()}>{items.map(item=><MenuItem id={item.id} key={item.id} textValue={item.label} isDisabled={item.disabled}>{item.icon&&<span className="action-menu-icon" aria-hidden="true">{item.icon}</span>}{item.label}</MenuItem>)}</Menu></Popover></MenuTrigger>;
}
