// One identity across optimistic state, HTTP, realtime events and history.
export const clientKey = m => m.clientMessageId || m.client_id || null;
export const messageKey = m => clientKey(m) ? `client:${m.user_id}:${clientKey(m)}` : `server:${m.id}`;
export function mergeMessages(current, incoming) {
  const result=[...current];
  for(const row of incoming){
    const cid=clientKey(row);
    const matches=result.filter(m=>m.id===row.id || (cid&&clientKey(m)===cid&&m.user_id===row.user_id));
    let target=matches[0];
    if(!target){target={...row};result.push(target);}
    else if(!(row.pending&&!target.pending)){
      // A delayed create response must not resurrect a deleted/edited message.
      const stale=!row.pending&&!target.pending&&(target.deleted || (!row.deleted&&(target.edited||0)>(row.edited||0)));
      const preserved=stale?{body:target.body,deleted:target.deleted,edited:target.edited}:{};
      Object.assign(target,row,preserved);
    }
    if(cid)target.clientMessageId=cid;
    if(!row.pending){target.pending=false;target.error=null;target.serverMessageId=row.id;target.status='sent';}
    for(const duplicate of matches.slice(1))result.splice(result.indexOf(duplicate),1);
  }
  return result.sort((a,b)=>a.created-b.created || a.id.localeCompare(b.id));
}
function patchNode(old,next){
  if(old.nodeType!==next.nodeType||old.nodeName!==next.nodeName){old.replaceWith(next);return;}
  if(old.nodeType===3){if(old.data!==next.data)old.data=next.data;return;}
  for(const attr of [...old.attributes])if(!next.hasAttribute(attr.name))old.removeAttribute(attr.name);
  for(const attr of next.attributes)if(old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value);
  for(let i=0;i<next.childNodes.length;i++){
    const n=next.childNodes[i].cloneNode(true),o=old.childNodes[i];
    if(o)patchNode(o,n);else old.append(n);
  }
  while(old.childNodes.length>next.childNodes.length)old.lastChild.remove();
}
// Parse and patch only changed rows. Keep focus, images and event handlers on
// unchanged chats; no persistent cache survives removal or account switching.
export function reconcileChatList(box,rows,bind){
  const existing=new Map([...box.children].map(el=>[el.dataset.chat,el]));
  const keep=new Set();let position=box.firstElementChild;
  for(const {id,html} of rows){
    let node=existing.get(String(id));
    if(!node||node._chatHTML!==html){
      const template=box.ownerDocument.createElement('template');template.innerHTML=html;
      const next=template.content.firstElementChild;
      if(node)patchNode(node,next);else node=next;
      node._chatHTML=html;bind(node);
    }
    keep.add(node);
    if(node!==position)box.insertBefore(node,position);
    position=node.nextElementSibling;
  }
  for(const node of [...box.children])if(!keep.has(node))node.remove();
}
// Keep the article (and unchanged media nodes) attached throughout acknowledgement.
export function reconcileMessages(box,html){
  const template=box.ownerDocument.createElement('template');template.innerHTML=html;
  const existing=new Map([...box.children].map(el=>[el.dataset.key||el.id||el.className,el]));
  let position=box.firstElementChild;
  const keep=new Set();
  for(const next of [...template.content.children]){
    const key=next.dataset.key||next.id||next.className;
    const old=existing.get(key),node=old||next;
    if(old&&old._messageHTML!==next.outerHTML)patchNode(old,next);
    node._messageHTML=next.outerHTML;keep.add(node);
    if(node!==position)box.insertBefore(node,position);
    position=node.nextElementSibling;
  }
  for(const el of [...box.children])if(!keep.has(el))el.remove();
}
export function optimisticMessage(item){
  return {id:'local:'+item.id,clientMessageId:item.id,client_id:item.id,user_id:item.user,chat_id:item.chat,
    kind:item.payload.sticker||item.stickerId?'sticker':item.payload.kind||'text',body:item.payload.body||item.payload.sticker||item.stickerId||'',quote:item.payload.quote||item.quote,
    forwarded:item.payload.forwarded,reply_id:item.payload.reply,...(item.payload.topic?{topic:item.payload.topic}:{}),...(item.payload.ghost?{ghost:1}:{}),created:item.created,pending:true,status:item.error?'failed':'sending',error:item.error,
    attachmentName:item.file?.name};
}

