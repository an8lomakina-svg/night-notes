(function(root){
  const parts=(date,zone)=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  function dateValue(value,zone,displayZone){
    const m=value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);if(!m)return null;
    const [y,mo,d,h=0,mi=0,se=0]=m.slice(1,7).map(x=>x===undefined?undefined:Number(x));
    const utc=Date.UTC(y,mo-1,d,h,mi,se),test=new Date(utc);
    if(test.getUTCFullYear()!==y||test.getUTCMonth()!==mo-1||test.getUTCDate()!==d||h>23||mi>59||se>59)return null;
    if(m[4]===undefined)return {date:`${m[1]}-${m[2]}-${m[3]}`,time:'ВЕСЬ ДЕНЬ'};
    if(!m[7] && !zone)return {date:`${m[1]}-${m[2]}-${m[3]}`,time:`${m[4]}:${m[5]}`};
    let instant=utc;
    if(!m[7])for(let i=0;i<3;i++){const p=parts(new Date(instant),zone);const delta=utc-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);instant+=delta;if(!delta)break;}
    const p=parts(new Date(instant),displayZone);return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
  }
  function parse(raw,displayZone=Intl.DateTimeFormat().resolvedOptions().timeZone){
    const events=[];let rejected=0;
    const unfolded=raw.replace(/\r\n/g,'\n').replace(/\n[ \t]/g,'');
    for(const block of unfolded.split('BEGIN:VEVENT').slice(1))try{
      const fields={};for(const line of block.split('END:VEVENT')[0].split('\n')){
        const split=line.indexOf(':');if(split<0)continue;const [name,...params]=line.slice(0,split).split(';');fields[name]={value:line.slice(split+1).trim(),params};
      }
      const start=fields.DTSTART,title=fields.SUMMARY;if(!start||!title){rejected++;continue;}
      const zone=start.params.find(p=>p.startsWith('TZID='))?.slice(5).replace(/^"|"$/g,'');
      const date=dateValue(start.value,zone,displayZone);if(!date){rejected++;continue;}
      const text=title.value.replace(/\\[nN]/g,'\n').replace(/\\([,;\\])/g,'$1');
      const uid=fields.UID?.value || JSON.stringify([date.date,date.time,text]);
      const recurrence=fields['RECURRENCE-ID']?.value || '';
      events.push({id:'ics:'+uid+':'+recurrence,uid:uid+':'+recurrence,title:text,...date});
    }catch{rejected++;}
    return {events,rejected};
  }
  if(typeof module==='object'&&module.exports)module.exports={parse};else root.NotebookCalendar={parse};
})(typeof globalThis==='object'?globalThis:this);
