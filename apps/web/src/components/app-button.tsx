import { useMobileInteractions } from "./interaction-context";
import { TooltipTrigger, Tooltip, Button as AriaButton, type ButtonProps } from "react-aria-components";
import { useRef, type ComponentPropsWithRef } from "react";
import { useButton } from "react-aria/useButton";
import { mergeProps } from "react-aria/mergeProps";

// Keep native form, drag-and-drop and event contracts while sharing Aria press behavior.
type Props=ComponentPropsWithRef<"button"> & {"data-tooltip"?:string};
export function Button({title,"data-tooltip":tooltip,...props}:Props) {
 const mobile=useMobileInteractions();
 const description=tooltip??title;
 return description&&!mobile?<TooltipTrigger delay={0}><AriaButton {...(props as unknown as ButtonProps)} isDisabled={props.disabled} onPress={event=>event.continuePropagation()} type={props.type??"submit"} ref={props.ref}>{props.children}</AriaButton><Tooltip className="app-tooltip">{description}</Tooltip></TooltipTrigger>:<PlainButton {...props}/>;
}
function PlainButton({ref:externalRef,disabled,children,...props}:Props) {
  const ref=useRef<HTMLButtonElement>(null);
  const {buttonProps}=useButton({type:props.type??"submit",isDisabled:disabled,onPress:event=>event.continuePropagation(),onPressStart:event=>event.continuePropagation(),onPressEnd:event=>event.continuePropagation()},ref);
  const button=<button {...mergeProps(props,buttonProps)} disabled={disabled} ref={node=>{
    ref.current=node;
    if(typeof externalRef==="function")return externalRef(node);
    if(externalRef)externalRef.current=node;
  }}>{children}</button>;
  return button;
}
