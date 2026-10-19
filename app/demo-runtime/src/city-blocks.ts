/** A packed district outside the playable 18×14 grid. All dimensions are metres. */
export interface CityBuilding { x:number; z:number; w:number; d:number; h:number; rotation:number; style:number; shop:boolean; recess?:number }
export function cityBlocks(): CityBuilding[] {
  const blocks:CityBuilding[]=[];
  for(const sx of [-1,1])for(const sz of [-1,1]) {
    // Continuous shop terraces line the cross street, with almost shared party walls.
    for(let i=0;i<5;i++)blocks.push({x:sx*(15.2+i*4.8),z:sz*6.3,w:4.6,d:6.6,h:[6.4,10.2,7.4,14.4,9.8][(i+(sx>0?1:0)+(sz>0?2:0))%5],rotation:sz>0?Math.PI:0,style:(i+Math.max(0,sx)+Math.max(0,sz)*3)%8,shop:true,recess:i===0?2.3:0});
    // A second row faces the avenue. Narrow gaps form service alleys behind the stores.
    for(let i=0;i<5;i++)blocks.push({x:sx*7.8,z:sz*(14.4+i*5.8),w:5.6,d:6.3,h:[8.2,13.6,17.2,10.8,22][(i+(sz>0?2:0))%5],rotation:-sx*Math.PI/2,style:(i+3+(sx>0?2:0))%8,shop:true});
    // Dense inner blocks, slightly taller than the street frontage. No freestanding towers in fields.
    for(let i=0;i<4;i++)for(let j=0;j<4;j++)blocks.push({x:sx*(15.2+i*6.6),z:sz*(14.8+j*8.4),w:6.4,d:8,h:12+((i*7+j*11+(sx+sz)*2+16)%6)*3.1,rotation:sz>0?Math.PI:0,style:(i*3+j)%8,shop:false});
  }
  return blocks;
}
