#version 300 es
precision highp float;
in vec3 vC; flat in float vG; out vec4 c;
void main(){ vec2 d=gl_PointCoord*2.-1.; float r=dot(d,d); float a=(vG>1.5&&vG<2.5)?exp(-r*42.)*5.+exp(-r*5.)*.16:exp(-r*5.5)-.0041; c=vec4(vC*max(a,0.)*.6,1.); }
