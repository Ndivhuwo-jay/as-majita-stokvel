const members=[
 {id:"m-jondow",name:"Jondow",joined:"2026-01-01"},
 {id:"m-jabu",name:"Jabu",joined:"2026-01-01"},
 {id:"m-trevor",name:"Trevor",joined:"2026-01-01"},
 {id:"m-makhera",name:"Makhera",joined:"2026-02-01"},
 {id:"m-chinanga",name:"Chinanga",joined:"2026-01-01"},
 {id:"m-funi",name:"Funi",joined:"2026-05-01"},
];
const paid={
 "m-jondow":[2000,2000,2100,3000,2000,4000,4900,1000,6000],
 "m-jabu":[500,1000,0,5050,1000,1000,300,9000,10000],
 "m-trevor":[500,0,0,1000],
 "m-makhera":[0,500,1000,0,2500,0,1050,2950,1000],
 "m-chinanga":[1000,2000,1000,1000,1500,1500,1000,1000,1000],
};
const payments=[];
for(const [mid,months] of Object.entries(paid)) months.forEach((amount,i)=>{ if(amount) payments.push({id:`p-${mid.slice(2)}-${i+1}`,memberId:mid,date:`2026-${String(i+1).padStart(2,"0")}-01`,amount,note:""}); });
window.STOKVEL_SEED={members,payments};
