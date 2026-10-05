import crypto from 'crypto';
export async function verifyArpc(arqcHex:string,arpcHex:string,responseCode:string):Promise<boolean>{
  try{
    const key=process.env.ISSUER_SECRET_KEY||'PRIMESTACK-ISSUER-KEY-9f3a2b1c8d4e5f6a';
    const arqc=Buffer.from(arqcHex,'hex');
    const arpc=Buffer.from(arpcHex,'hex');
    const arc=Buffer.alloc(8,0);
    arc.write(responseCode.padStart(4,'0'),0,'hex');
    const xored=Buffer.alloc(8);
    for(let i=0;i<8;i++)xored[i]=(arqc[i]||0)^arc[i];
    const expected=crypto.createHmac('sha256',Buffer.from(key,'utf8')).update(xored).digest().slice(0,8);
    if(arpc.length<4)return false;
    return arpc.slice(0,4).equals(expected.slice(0,4));
  }catch{return false;}
}