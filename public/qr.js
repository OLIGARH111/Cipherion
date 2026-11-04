// Small QR code generator (byte mode, error correction level M, versions 1–10), drawn as SVG.
// Follows ISO/IEC 18004; written here because the page loads no third-party scripts.
const ECC=[10,16,26,18,24,16,18,22,22,26],BLOCKS=[1,1,1,2,2,4,4,4,5,5];
const ALIGN=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
const mul=(x,y)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x;}return z;};
function divisor(degree){const r=new Array(degree).fill(0);r[degree-1]=1;let root=1;for(let i=0;i<degree;i++){for(let j=0;j<r.length;j++){r[j]=mul(r[j],root);if(j+1<r.length)r[j]^=r[j+1];}root=mul(root,2);}return r;}
function remainder(data,div){const r=div.map(()=>0);for(const b of data){const f=b^r.shift();r.push(0);div.forEach((c,i)=>{r[i]^=mul(c,f);});}return r;}
const rawModules=v=>{let r=(16*v+128)*v+64;if(v>=2){const n=Math.floor(v/7)+2;r-=(25*n-10)*n-55;if(v>=7)r-=36;}return r;};
const dataCodewords=v=>Math.floor(rawModules(v)/8)-ECC[v-1]*BLOCKS[v-1];

export function qrMatrix(text){
  const bytes=[...new TextEncoder().encode(text)];
  let version=1;for(;version<=10;version++){const countBits=version<10?8:16;if(4+countBits+bytes.length*8<=dataCodewords(version)*8)break;}
  if(version>10)throw new Error('Слишком длинный текст для QR-кода');
  const size=version*4+17,countBits=version<10?8:16,capacity=dataCodewords(version)*8;
  const bits=[];const put=(value,n)=>{for(let i=n-1;i>=0;i--)bits.push((value>>>i)&1);};
  put(4,4);put(bytes.length,countBits);for(const b of bytes)put(b,8);
  put(0,Math.min(4,capacity-bits.length));while(bits.length%8)bits.push(0);
  for(let pad=0xec;bits.length<capacity;pad^=0xec^0x11)put(pad,8);
  const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((n,b)=>n<<1|b,0));
  // Error correction blocks, interleaved.
  const blocks=BLOCKS[version-1],ecc=ECC[version-1],raw=Math.floor(rawModules(version)/8),short=blocks-raw%blocks,shortLen=Math.floor(raw/blocks),div=divisor(ecc);
  const parts=[];for(let i=0,k=0;i<blocks;i++){const dat=data.slice(k,k+shortLen-ecc+(i<short?0:1));k+=dat.length;const e=remainder(dat,div);if(i<short)dat.push(0);parts.push(dat.concat(e));}
  const codewords=[];for(let i=0;i<parts[0].length;i++)parts.forEach((p,j)=>{if(i!==shortLen-ecc||j>=short)codewords.push(p[i]);});
  // Function patterns.
  const modules=Array.from({length:size},()=>new Array(size).fill(false)),fixed=Array.from({length:size},()=>new Array(size).fill(false));
  const set=(x,y,dark)=>{modules[y][x]=dark;fixed[y][x]=true;};
  for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
  for(const [cx,cy] of [[3,3],[size-4,3],[3,size-4]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy;if(x>=0&&x<size&&y>=0&&y<size){const d=Math.max(Math.abs(dx),Math.abs(dy));set(x,y,d!==2&&d!==4);}}
  const align=ALIGN[version-1],last=align.length-1;
  align.forEach((ax,i)=>align.forEach((ay,j)=>{if(i===0&&j===0||i===0&&j===last||i===last&&j===0)return;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(ax+dx,ay+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);}));
  const format=mask=>{const d=(0<<3)|mask;let r=d;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);const b=((d<<10)|r)^0x5412,bit=i=>((b>>>i)&1)===1;
    for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));for(let i=9;i<15;i++)set(14-i,8,bit(i));
    for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true);};
  format(0);
  if(version>=7){let r=version;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1f25);const b=(version<<12)|r;for(let i=0;i<18;i++){const dark=((b>>>i)&1)===1,a=size-11+i%3,c=Math.floor(i/3);set(a,c,dark);set(c,a,dark);}}
  // Data in the zigzag order.
  let index=0;
  for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){const x=right-j,up=((right+1)&2)===0,y=up?size-1-vert:vert;if(!fixed[y][x]&&index<codewords.length*8){modules[y][x]=((codewords[index>>>3]>>>(7-(index&7)))&1)===1;index++;}}}
  const masks=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,x=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
  const apply=m=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!fixed[y][x]&&masks[m](x,y))modules[y][x]=!modules[y][x];};
  const penalty=()=>{let p=0,dark=0;
    const lines=[];for(let i=0;i<size;i++){lines.push(modules[i]);lines.push(modules.map(r=>r[i]));}
    for(const line of lines){let run=1;for(let i=1;i<=size;i++){if(i<size&&line[i]===line[i-1])run++;else{if(run>=5)p+=run-2;run=1;}}const s=line.map(v=>v?1:0).join('');for(const pattern of ['10111010000','00001011101'])for(let at=s.indexOf(pattern);at>=0;at=s.indexOf(pattern,at+1))p+=40;}
    for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){const c=modules[y][x];if(c===modules[y][x+1]&&c===modules[y+1][x]&&c===modules[y+1][x+1])p+=3;}
    for(const row of modules)for(const v of row)if(v)dark++;
    return p+Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10;};
  let best=0,bestScore=Infinity;
  for(let m=0;m<8;m++){apply(m);format(m);const score=penalty();if(score<bestScore){bestScore=score;best=m;}apply(m);}
  apply(best);format(best);
  return modules;
}
export function qrSVG(text,{label='QR-код'}={}){
  const m=qrMatrix(text),size=m.length,quiet=4,total=size+quiet*2;
  let path='';m.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)path+=`M${x+quiet} ${y+quiet}h1v1h-1z`;}));
  return `<svg class="qr-code" viewBox="0 0 ${total} ${total}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
