#version 300 es
precision highp float;
in vec3 aPos,aVit,aCoul; in float aVie,aPhase,aTaille,aGenre;
uniform vec3 uCam,uCible; uniform vec2 uRes; uniform vec3 uChocPos; uniform float uChoc; uniform float uT,uFov,uRoulis,uDensite,uCercle,uInvoque,uBoucle;
out vec3 vC; flat out float vG;
const float TAU=6.2831853;
void main(){
 float n=uBoucle/aVie; // nombre entier de vies par boucle
 float ph=fract(uT*n/uBoucle+aPhase*7.13);
 float vie=ph*aVie;
 vec3 p=aPos+aVit*vie;
 float fond=smoothstep(0.,.12,ph)*smoothstep(1.,.75,ph);
 if(aGenre>1.5){ p=aPos; fond=.72+.2*sin(TAU*(uT/uBoucle)*5.+aPhase*40.)+.12*sin(TAU*(uT/uBoucle)*11.+aPhase*90.); }
 if(aGenre>.5&&aGenre<1.5){ float a=TAU*(uT/uBoucle)*2.+aPhase*TAU; p.xz+=vec2(cos(a+p.y*.5),sin(a+p.y*.5))*(.12+.05*p.y); fond*=uCercle*(1.+uInvoque*7.); p.xz=mix(p.xz,p.xz+normalize(p.xz-vec2(0.,-.6)+.001)*p.y*.5,min(uInvoque,1.)); }
 if(aGenre>2.5){
  // l'éclat du coup : il part du point d'impact, retombe, s'éteint
  float age=uChoc+aPhase*.03;
  p=uChocPos+aPos+aVit*age*(1.-.16*age)+vec3(0.,-2.4*age*age,0.);
  fond=(age<4.5?1.:0.)*exp(-age*1.05)*step(.2,p.y+3.);
 }
 vec3 f=normalize(uCible-uCam), r=normalize(cross(f,vec3(sin(uRoulis),cos(uRoulis),0.))), u=cross(r,f);
 vec3 v=p-uCam;
 float z=dot(v,f);
 float k=1./tan(radians(uFov)*.5);
 if(z<.2){ gl_Position=vec4(2.,2.,0.,1.); gl_PointSize=0.; vC=vec3(0.); return; }
 vec2 ecran=vec2(dot(v,r),dot(v,u))*k/z;
 gl_Position=vec4(ecran.x*uRes.y/uRes.x,ecran.y,0.,1.);
 float echelle=uRes.y/720.;
 vG=aGenre;
 float s=aTaille*echelle*((aGenre>1.5&&aGenre<2.5)?7.:3.)/max(z*.09,.6);
 gl_PointSize=clamp(s,1.,(aGenre>1.5&&aGenre<2.5)?30.:(aGenre>2.5?2.6:5.));
 float brume=exp(-z*.035);
 float e=(aGenre<.5)?.08:(aGenre<1.5?.8:(aGenre<2.5?1.4:2.6));
 vC=aCoul*fond*uDensite*brume*e*min(1.,s/gl_PointSize+.3);
}
