import { createContext, useContext } from "react";
export const MobileInteractions=createContext(false);
export const useMobileInteractions=()=>useContext(MobileInteractions);
