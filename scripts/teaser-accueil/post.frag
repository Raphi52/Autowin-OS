#version 300 es
precision highp float;
in vec2 vUv; out vec4 c;
uniform sampler2D tImg,tHalo,tLarge,tTitre; uniform vec2 uRes,uCentre; uniform float uGraine,uFondu,uFlash,uBandes,uTitre,uSillage,uChoc,uFlouRadial,uTemps;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
float h(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float h1(float x){ return fract(sin(x*91.17)*47453.5); }
// des braises floues tout près de l'objectif : elles donnent la profondeur
vec3 bokeh(vec2 uv){
 vec3 c=vec3(0.); float as=uRes.x/uRes.y;
 for(int i=0;i<14;i++){
  float f=float(i);
  float v=.012+.03*h1(f+3.);
  vec2 p=vec2(fract(h1(f)+uTemps*v*.3+.05*sin(uTemps*.4+f)),fract(h1(f+7.)+uTemps*v));
  float r=.022+.05*h1(f+11.);
  float d=length((uv-p)*vec2(as,1.));
  float a=smoothstep(r,r*.82,d)*(.72+.28*smoothstep(r*.5,r*.92,d));
  float scint=.6+.4*sin(uTemps*(1.+h1(f+2.)*2.)+f);
  c+=mix(vec3(1.,.55,.2),vec3(.45,.6,1.),step(.7,h1(f+5.)))*a*scint;
 }
 return c*.03;
}
void main(){
 vec2 uv=vUv;
 // l'onde de choc tord l'image en passant
 if(uChoc>.001){
  vec2 dc=(uv-uCentre)*vec2(uRes.x/uRes.y,1.);
  float rc=length(dc),r0=uChoc*1.9;
  float w=exp(-pow((rc-r0)*7.,2.))*(1.-uChoc)*(1.-uChoc);
  uv-=dc/max(rc,.001)*w*.05;
 }
 vec2 d=uv-.5; float r2=dot(d,d);
 // aberration chromatique légère, plus forte vers les bords
 float ab=.0064*r2;
 vec3 img=vec3(texture(tImg,uv+d*ab).r,texture(tImg,uv).g,texture(tImg,uv-d*ab).b);
 // la vitesse : l'image file vers son centre
 if(uFlouRadial>.001){
  vec3 s=img;
  for(int i=1;i<12;i++) s+=texture(tImg,uv+(uCentre-uv)*uFlouRadial*float(i)/12.*.34).rgb;
  img=s/12.;
 }
 img+=texture(tHalo,uv).rgb*.13;
 // traînée horizontale d'objectif anamorphique sur les points très forts
 vec3 tr=vec3(0.);
 for(int i=-8;i<=8;i++){ float k=float(i)/8.; tr+=max(texture(tLarge,uv+vec2(k*.16,0.)).rgb-1.2,vec3(0.))*(1.-abs(k)); }
 // bleue sur la nef, chaude sur les plans serrés : du bleu sur des yeux dorés vire au vert
 img+=tr*mix(vec3(.25,.42,.9)*.05,vec3(.9,.55,.25)*.012,uBandes);
 img+=bokeh(uv);
 img+=uFlash*vec3(1.,.95,.85);
 // vignette
 img*=1.-smoothstep(.12,.72,r2*1.35)*.72;
 img*=uFondu;
 vec3 col=aces(img*1.25);
 // étalonnage : ombres bleu nuit, hautes lumières dorées
 float l=dot(col,vec3(.2126,.7152,.0722));
 col=mix(col*vec3(.86,.93,1.12),col*vec3(1.08,1.0,.86),smoothstep(.05,.6,l));
 col=mix(vec3(l),col,1.12);
 // du noir franc et des hautes lumières : l'image ne doit jamais paraître laiteuse
 col=mix(col,col*col*(3.-2.*col),.42);
 col=pow(max(col,0.),vec3(1./2.2));
 // grain fin : il évite aussi les aplats par bandes dans le noir
 float g=h(gl_FragCoord.xy+uGraine*917.)+h(gl_FragCoord.xy*1.3+uGraine*331.)-1.;
 col+=g*(.018+.02*(1.-smoothstep(0.,.5,l)));
 vec3 titre=texture(tTitre,uv).rgb;
 float eclat=exp(-pow((uv.x-uSillage-(uv.y-.5)*.3)*7.,2.));
 col+=titre*uTitre*(1.+eclat*2.6);
 float bh=uBandes*.12; if(uv.y<bh||uv.y>1.-bh) col=vec3(0.);
 c=vec4(col,1.);
}
