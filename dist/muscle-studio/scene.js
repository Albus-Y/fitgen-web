// 三维场景直接使用离线正向运动学导出的骨骼位姿与肌束路径。
const projection = `
uniform vec3 eye, rightAxis, upAxis, forwardAxis;
uniform vec2 lens;
uniform float shift;
vec4 projectPoint(vec3 p) {
  vec3 v = p-eye;
  float z = dot(v,forwardAxis);
  return vec4(dot(v,rightAxis)*lens.x+shift*z, dot(v,upAxis)*lens.y, z*1.002-.08, z);
}`;
const light = `
float diffuse(vec3 n) {
  return .48 + .40*max(0.,dot(n,normalize(vec3(1.,-2.,3.))))
             + .12*max(0.,dot(n,normalize(vec3(-2.,1.,1.))));
}`;
const boneVertex = `
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in float body;
uniform highp sampler2D pose;
out vec3 direction;
vec3 rotated(vec4 q, vec3 v) {return v+2.*cross(q.yzw,cross(q.yzw,v)+q.x*v);}
void main(){
  int i = int(body)*2;
  vec3 center=texelFetch(pose,ivec2(i,0),0).xyz;
  vec4 quat=normalize(texelFetch(pose,ivec2(i+1,0),0));
  direction=rotated(quat,normal);
  gl_Position=projectPoint(center+rotated(quat,position));
}`;
const tubeVertex = `
layout(location=0) in vec3 unit;
layout(location=1) in vec3 startPoint;
layout(location=2) in vec3 endPoint;
layout(location=3) in vec4 tintRadius;
out vec3 shade;
void main(){
  vec3 axis=endPoint-startPoint;
  vec3 along=normalize(axis);
  vec3 basis=normalize(cross(along,abs(along.z)>.9?vec3(1,0,0):vec3(0,0,1)));
  vec3 n=basis*unit.x+cross(along,basis)*unit.y;
  vec3 p=mix(startPoint,endPoint,unit.z)+tintRadius.w*n;
  shade=tintRadius.rgb*diffuse(n);
  gl_Position=projectPoint(p);
}`;
const gridVertex = `
layout(location=0) in vec2 xy;
out vec2 ground;
void main(){ground=xy;gl_Position=projectPoint(vec3(xy,-.003));}`;
const gridFragment = `
in vec2 ground;
out vec4 color;
void main(){
  vec2 p=ground*4.;
  vec2 edge=abs(fract(p-.5)-.5)/max(fwidth(p),vec2(.001));
  float line=1.-min(1.,min(edge.x,edge.y));
  float fade=exp(-.045*dot(ground,ground));
  color=vec4(mix(vec3(.16,.18,.20),vec3(.29,.33,.36),line*fade),1.);
}`;
const bonesFragment = `
in vec3 direction;out vec4 color;
void main(){color=vec4(vec3(.95,.92,.84)*diffuse(normalize(direction)),1.);}`;
const tubeFragment = 'in vec3 shade;out vec4 color;void main(){color=vec4(shade,1.);}';
const refEdges = [[0,1],[1,2],[1,3],[3,4],[4,5],[1,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16]];

function shaderProgram(gl, vertex, fragment) {
  function compile(kind, code) {
    const s=gl.createShader(kind);
    gl.shaderSource(s,'#version 300 es\nprecision highp float;\n'+code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  }
  const p=gl.createProgram();
  gl.attachShader(p,compile(gl.VERTEX_SHADER,projection+light+vertex));
  gl.attachShader(p,compile(gl.FRAGMENT_SHADER,light+fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
  return p;
}

export class Scene {
  constructor(canvas, model, update) {
    this.canvas=canvas;
    this.update=update;
    this.model=model.meta;
    const gl=canvas.getContext('webgl2',{alpha:false,antialias:true});
    if (!gl) throw Error('此浏览器未提供 WebGL 2，请启用图形加速后重新打开回放。');
    this.gl=gl;
    this.bones=shaderProgram(gl,boneVertex,bonesFragment);
    this.tubes=shaderProgram(gl,tubeVertex,tubeFragment);
    this.grid=shaderProgram(gl,gridVertex,gridFragment);
    this.uniforms=new Map([this.bones,this.tubes,this.grid].map(p=>[
      p,Object.fromEntries(['eye','rightAxis','upAxis','forwardAxis','lens','shift'].map(k=>[k,gl.getUniformLocation(p,k)]))
    ]));
    const vao=()=>{const v=gl.createVertexArray();gl.bindVertexArray(v);return v;};
    const buffer=(data,target=gl.ARRAY_BUFFER,usage=gl.STATIC_DRAW)=>{
      const b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,usage);return b;
    };
    const attribute=(id,n,type,normalized=false,stride=0,offset=0,divisor=0)=>{
      gl.enableVertexAttribArray(id);gl.vertexAttribPointer(id,n,type,normalized,stride,offset);
      gl.vertexAttribDivisor(id,divisor);
    };
    this.boneVao=vao();
    buffer(model.vertex);attribute(0,3,gl.FLOAT);
    buffer(model.normal);attribute(1,3,gl.BYTE,true);
    buffer(model.body);attribute(2,1,gl.UNSIGNED_BYTE);
    buffer(model.face,gl.ELEMENT_ARRAY_BUFFER);this.faceCount=model.face.length;
    this.transforms=new Float32Array(this.model.bodies*8);
    this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,this.model.bodies*2,1);
    this.tubeVao=vao();
    const ring=[];
    for(let i=0;i<=8;i++){
      const a=i*Math.PI/4;
      ring.push(Math.cos(a),Math.sin(a),0,Math.cos(a),Math.sin(a),1);
    }
    buffer(new Float32Array(ring));attribute(0,3,gl.FLOAT);
    this.pathPoints=this.model.muscles.reduce((s,m)=>s+m.capacity,0);
    this.segments=new Float32Array((this.pathPoints+refEdges.length)*10);
    this.segmentBuffer=buffer(this.segments.byteLength,gl.ARRAY_BUFFER,gl.DYNAMIC_DRAW);
    attribute(1,3,gl.FLOAT,false,40,0,1);attribute(2,3,gl.FLOAT,false,40,12,1);attribute(3,4,gl.FLOAT,false,40,24,1);
    this.floorVao=vao();buffer(new Float32Array([-16,-16,16,-16,-16,16,16,16]));attribute(0,2,gl.FLOAT);
    gl.bindVertexArray(null);gl.enable(gl.DEPTH_TEST);
    this.anchor=[0,0,.85];this.reset();
    this.bindControls();
    this.observer=new ResizeObserver(update);this.observer.observe(canvas);
  }

  reset(){
    this.azimuth=-.96;this.elevation=.19;this.distance=3.05;this.center=[...this.anchor];
  }

  bindControls(){
    const canvas=this.canvas, points=new Map();
    const distance=()=>{const [p,q]=points.values();return Math.hypot(q.x-p.x,q.y-p.y);};
    canvas.addEventListener('pointerdown',e=>{
      canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});
      points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    });
    canvas.addEventListener('pointermove',e=>{
      const last=points.get(e.pointerId);if(!last)return;
      const old=points.size===2?distance():0;
      const dx=e.clientX-last.x,dy=e.clientY-last.y;
      points.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(old>0)this.distance=Math.max(.72,Math.min(12,this.distance*old/Math.max(1,distance())));
      else if(e.shiftKey||e.buttons===2){
        const scale=this.distance*.0018;
        this.center[0]+=Math.sin(this.azimuth)*dx*scale;
        this.center[1]-=Math.cos(this.azimuth)*dx*scale;this.center[2]+=dy*scale;
      }else{
        this.azimuth-=dx*.009;this.elevation=Math.max(-.12,Math.min(1.4,this.elevation+dy*.008));
      }
      this.update();
    });
    for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>points.delete(e.pointerId));
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('wheel',e=>{
      e.preventDefault();this.distance=Math.max(.72,Math.min(12,this.distance*Math.exp(e.deltaY*.001)));
      this.update();
    },{passive:false});
  }

  camera(program) {
    const gl=this.gl,u=this.uniforms.get(program);
    const c=Math.cos(this.azimuth),s=Math.sin(this.azimuth),h=Math.cos(this.elevation),v=Math.sin(this.elevation);
    gl.useProgram(program);
    gl.uniform3f(u.eye,this.center[0]+this.distance*c*h,this.center[1]+this.distance*s*h,this.center[2]+this.distance*v);
    gl.uniform3f(u.rightAxis,-s,c,0);gl.uniform3f(u.upAxis,-v*c,-v*s,h);gl.uniform3f(u.forwardAxis,-c*h,-s*h,-v);
    const f=2.36;gl.uniform2f(u.lens,f*this.canvas.height/this.canvas.width,f);
    gl.uniform1f(u.shift,this.canvas.clientWidth>=560?.12:0);
  }

  draw(clip,frame,options){
    const gl=this.gl,c=this.canvas;
    const dpr=Math.min(devicePixelRatio||1,1.75);
    const w=Math.max(1,Math.round(c.clientWidth*dpr)),h=Math.max(1,Math.round(c.clientHeight*dpr));
    if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
    gl.viewport(0,0,w,h);gl.clearColor(.13,.15,.17,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    this.camera(this.grid);gl.bindVertexArray(this.floorVao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    const bodies=this.model.bodies;
    for(let b=0;b<bodies;b++){
      const src=(frame*bodies+b)*7,off=b*8;
      for(let i=0;i<3;i++)this.transforms[off+i]=clip.pose[src+i]/2000;
      for(let i=0;i<4;i++)this.transforms[off+4+i]=clip.pose[src+3+i]/32767;
    }
    this.camera(this.bones);
    gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,bodies*2,1,gl.RGBA,gl.FLOAT,this.transforms);
    gl.bindVertexArray(this.boneVao);gl.drawElements(gl.TRIANGLES,this.faceCount,gl.UNSIGNED_INT,0);
    const seg=this.segments;
    let cursor=0;
    function line(source,from,to,color,radius){
      if(source[from]===source[to] && source[from+1]===source[to+1] && source[from+2]===source[to+2])return;
      for(let axis=0;axis<3;axis++){seg[cursor+axis]=source[from+axis]/2000;seg[cursor+3+axis]=source[to+axis]/2000;}
      seg.set(color,cursor+6);seg[cursor+9]=radius;cursor+=10;
    }
    if(options.muscles){
      let p=frame*this.pathPoints*3;
      const red=[.95,.30,.30], dim=[.45,.47,.50], blue=[.08,.38,1.];
      this.model.muscles.forEach((m,id)=>{
        const selected=options.highlight?.has(id);
        if(!options.lower||m.lower){
          const color=selected?blue:options.highlight?dim:red;
          const radius=m.radius*(selected?2.5:options.highlight ? .48 : 1);
          for(let j=0;j<m.capacity-1;j++)line(clip.path,p+j*3,p+(j+1)*3,color,radius);
        }
        p+=m.capacity*3;
      });
    }
    if(options.reference){
      const at=frame*17*3;
      for(const [i,j] of refEdges)line(clip.reference,at+i*3,at+j*3,[.28,.83,.93],.0048);
    }
    this.camera(this.tubes);gl.bindVertexArray(this.tubeVao);gl.bindBuffer(gl.ARRAY_BUFFER,this.segmentBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER,0,seg.subarray(0,cursor));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,18,cursor/10);gl.bindVertexArray(null);
  }
}
