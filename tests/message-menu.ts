import type { Locator, Page } from "@playwright/test";
export async function openMessageMenu(page:Page,message:Locator) {
  const row=await message.evaluate(node=>node.matches(".message-group"))?message:message.locator(".message-group");
  const trigger=row.getByRole("button",{name:"Действия с сообщением",exact:true});
  await row.hover();
  if(await trigger.isVisible())await trigger.click();else {const bounds=await row.boundingBox();if(!bounds)throw new Error("Message has no bounds");await row.click({position:{x:8,y:bounds.height/2}});}
}
export async function messageAction(page: Page, message: Locator, name: string) {
  if(name==="Выбрать это сообщение"){
    await chatAction(page,"Выбрать сообщения");await message.getByRole("checkbox").check();return;
  }
  if(name==="Кто прочитал"){await message.locator(".delivery-status").click();return;}
  await openMessageMenu(page,message);
  if(name==="Поставить реакцию"){await page.getByRole("button",{name:"Больше реакций",exact:true}).click();return;}
  await page.getByRole("menuitem", { name, exact: true }).click();
}
export async function chatAction(page:Page,name:string) {
 const action=page.getByRole("button",{name,exact:true});
 if(!await action.isVisible())await page.getByRole("button",{name:"Действия с чатом",exact:true}).click();
 await action.click();
}

export async function chatListAction(page:Page,name:string){
 await page.getByRole("button",{name:"Меню списка чатов",exact:true}).click();
 await page.getByRole("menuitem",{name,exact:true}).click();
}
