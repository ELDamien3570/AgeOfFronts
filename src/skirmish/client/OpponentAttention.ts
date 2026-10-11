export interface AttentionPoint {id:string;x:number;y:number}
interface Row {point:AttentionPoint;ordinal:number}
interface Node {row:Row;left?:Node;right?:Node;minX:number;maxX:number;minY:number;maxY:number}
/** Snapshot-local cosmetic nearest-neighbour index. Stable original ordinals
 * preserve nearest ties; an optional half-plane matches frontage attention.
 */
export class OpponentAttention {
  private root?:Node;
  private ids=new Map<string,AttentionPoint>();
  constructor(points:readonly AttentionPoint[]) {
    for(const p of points)this.ids.set(p.id,p);
    const build=(rows:Row[],depth:number):Node|undefined=>{
      if(!rows.length)return undefined;
      const axis=depth%2?'y':'x';rows.sort((a,b)=>a.point[axis]-b.point[axis]||a.ordinal-b.ordinal);
      const middle=rows.length>>>1,row=rows[middle],left=build(rows.slice(0,middle),depth+1),right=build(rows.slice(middle+1),depth+1);
      return{row,left,right,minX:Math.min(row.point.x,left?.minX??Infinity,right?.minX??Infinity),
        maxX:Math.max(row.point.x,left?.maxX??-Infinity,right?.maxX??-Infinity),
        minY:Math.min(row.point.y,left?.minY??Infinity,right?.minY??Infinity),
        maxY:Math.max(row.point.y,left?.maxY??-Infinity,right?.maxY??-Infinity)};
    };
    this.root=build(points.map((point,ordinal)=>({point,ordinal})),0);
  }
  point(id:string):AttentionPoint|undefined {return this.ids.get(id);}
  nearest(origin:{x:number;y:number},ahead?:{x:number;y:number}):AttentionPoint|undefined {
    let best:Row|undefined,distance=Infinity;
    const lower=(node:Node)=>Math.max(0,node.minX-origin.x,origin.x-node.maxX)**2+Math.max(0,node.minY-origin.y,origin.y-node.maxY)**2;
    const visit=(node:Node|undefined):void=>{
      if(!node || lower(node)>distance)return;
      if(ahead && ((ahead.x>=0?node.maxX:node.minX)-origin.x)*ahead.x+
        ((ahead.y>=0?node.maxY:node.minY)-origin.y)*ahead.y<=0)return;
      const p=node.row.point,dx=p.x-origin.x,dy=p.y-origin.y,n=dx*dx+dy*dy;
      if((!ahead || dx*ahead.x+dy*ahead.y>0) && (n<distance || n===distance && node.row.ordinal<(best?.ordinal??Infinity))){best=node.row;distance=n;}
      const left=node.left,right=node.right;
      if(left && right && lower(left)>lower(right)){visit(right);visit(left);}else{visit(left);visit(right);}
    };
    visit(this.root);return best?.point;
  }
}
