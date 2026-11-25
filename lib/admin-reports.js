const {dateKey} = require('./order-insights');
function dispatchPerformance(rows, now=new Date(), hours=24) {
  const today=dateKey(now), week=new Date(today+'T00:00:00Z'); week.setUTCDate(week.getUTCDate()-((week.getUTCDay()+6)%7));
  const starts={weekly:week.toISOString().slice(0,10),monthly:today.slice(0,7)+'-01'};
  const periods=Object.fromEntries(Object.keys(starts).map(k=>[k,{onTime:0,delayed:0,items:[]}]));
  let unknown=0;
  for(const row of rows){if(!['Dispatched','Delivered'].includes(row.status))continue;const created=new Date(row.created_at),dispatched=row.dispatched_at?new Date(row.dispatched_at):null;let store='';try{store=String(JSON.parse(row.payload)?.storeCode||'').replace(/^(pmbjk|pmjbk|pmbi)[\s_-]*/i,'').trim()}catch{};if(!dispatched||!Number.isFinite(dispatched.getTime())||!Number.isFinite(created.getTime())||dispatched<created){unknown++;continue}const day=dateKey(dispatched),elapsed=(dispatched-created)/3600000;if(day>today)continue;for(const key of Object.keys(starts)){if(day<starts[key])continue;const result=elapsed<=hours?'onTime':'delayed';periods[key][result]++;periods[key].items.push({id:row.id,store,created_at:row.created_at,dispatched_at:row.dispatched_at,hours:Math.round(elapsed*10)/10,result})}}
  for(const p of Object.values(periods))p.items.sort((a,b)=>new Date(b.dispatched_at)-new Date(a.dispatched_at));
  return {today,starts,hours,periods,unknown};
}
function employeeWorkload(employees, assignments) { const rows=employees.map(e=>({id:e.id,name:e.name,active:!!e.active,assigned:0,pending:0,complete:0,cancelled:0,other:0})), byId=new Map(rows.map(r=>[r.id,r]));const unassigned={id:'',name:'Unassigned',active:true,assigned:0,pending:0,complete:0,cancelled:0,other:0}; for(const o of assignments){let target=byId.get(o.employee_id)||unassigned;target.assigned++;if(['New','Accepted','Challan Ready','Under Packing','Packed'].includes(o.status))target.pending++;else if(['Dispatched','Delivered'].includes(o.status))target.complete++;else if(o.status==='Cancelled')target.cancelled++;else target.other++}if(unassigned.assigned)rows.push(unassigned);return rows; }
module.exports={dispatchPerformance,employeeWorkload};
