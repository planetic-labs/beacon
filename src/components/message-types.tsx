import type { ReactNode } from "react";
type Renderer = (content: Record<string, unknown>) => ReactNode;
// A new content type registers its renderer here and its validator/preview in
// modules/chat/types.ts. Membership, delivery and reactions remain shared.
const renderers: Record<string, Renderer> = {
  text: (content) => String(content.text ?? ""),
};
export function renderMessage(type: string, content: Record<string, unknown>) {
  return (
    renderers[type]?.(content) ?? "Этот тип сообщения пока не поддерживается"
  );
}
