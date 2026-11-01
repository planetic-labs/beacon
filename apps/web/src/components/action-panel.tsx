import { useState, type ReactNode } from "react";
import { Button, DialogTrigger, Popover, Dialog } from "react-aria-components";

// A shared focus-managed action panel for mobile headers and attachment controls.
export function ActionPanel({label,icon,children,className,triggerClassName="icon-button",placement="bottom end"}:{label:string;icon:ReactNode;children:ReactNode;className:string;triggerClassName?:string;placement?:"bottom end"|"top start"}) {
 const [open,setOpen]=useState(false);
 return <DialogTrigger isOpen={open} onOpenChange={setOpen}>
  <Button className={triggerClassName} aria-label={label}>{icon}</Button>
  <Popover placement={placement} className={className}><Dialog aria-label={label} onClick={event=>{if((event.target as HTMLElement).closest("button"))setOpen(false);}}>{children}</Dialog></Popover>
 </DialogTrigger>;
}
