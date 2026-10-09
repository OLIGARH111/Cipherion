// Server-only transactional delivery. Credentials and verification codes never reach logs.
export function createMailer({env=process.env,request=fetch}={}) {
 const provider=env.EMAIL_PROVIDER||'webhook';
 const ready=()=>provider==='resend'?!!(env.RESEND_API_KEY&&env.EMAIL_FROM):provider==='webhook'&&!!env.EMAIL_VERIFICATION_URL;
 async function send({email,code,purpose,challengeId}) {
  const fail=message=>{throw Object.assign(new Error(message),{status:503});};
  if(!ready())fail('Отправка email ещё не настроена');
  let url,headers={'Content-Type':'application/json'},body;
  if(provider==='resend'){
   if(/[\r\n]/.test(env.EMAIL_FROM)||!env.EMAIL_FROM.includes('@'))fail('Адрес отправителя настроен некорректно');
   url='https://api.resend.com/emails';headers.Authorization='Bearer '+env.RESEND_API_KEY;headers['Idempotency-Key']='cipherion-email/'+challengeId;
   body={from:env.EMAIL_FROM,to:[email],subject:'Код подтверждения Cipherion',text:`Ваш код Cipherion: ${code}\n\nКод действует 10 минут и используется один раз. Не сообщайте его другим людям.\nЕсли вы не запрашивали код, проигнорируйте это письмо.`};
  }else{
   url=new URL(env.EMAIL_VERIFICATION_URL);if(url.protocol!=='https:'&&env.NODE_ENV!=='test')fail('Отправка email настроена некорректно');
   headers.Authorization='Bearer '+(env.VERIFICATION_TOKEN||'');headers['Idempotency-Key']='cipherion-email/'+challengeId;
   body={to:email,code,kind:'email',purpose,expiresIn:600};
  }
  try{
   const response=await request(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('Delivery rejected');
   if(provider==='resend'&&!(await response.json()).id)throw new Error('Delivery not acknowledged');
  }catch{throw Object.assign(new Error('Не удалось отправить письмо. Попробуйте позже.'),{status:502});}
 }
 return {ready,send};
}
