/**
 * Meditation Cron parser, deliberately self-contained and offline.
 * Supports POSIX 5 fields (minute hour day month weekday) and 6 fields with leading seconds.
 * Also permits '?' in day/weekday as a wildcard; does not claim to support Quartz L/W/# or years.
 */
const RULES = [
  { label:'秒', lo:0, hi:59 },
  { label:'分', lo:0, hi:59 },
  { label:'小时', lo:0, hi:23 },
  { label:'日期', lo:1, hi:31, question:true },
  { label:'月份', lo:1, hi:12 },
  { label:'星期', lo:0, hi:7, question:true },
];

function fieldValues(text, rule) {
  const input=String(text||'').trim();
  if (input==='?' && rule.question) return {values:new Set(Array.from({length:rule.hi-rule.lo+1},(_,i)=>i+rule.lo)),any:true};
  if (!input) throw new Error(rule.label+'字段不能为空。');
  const values=new Set();
  for(const token of input.split(',')) {
    const match=/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(token);
    if (!match) throw new Error(rule.label+'字段格式错误：'+token+'。只支持 *、范围、逗号、/ 步长。');
    const step=match[2]===undefined?1:Number(match[2]);
    if (!Number.isSafeInteger(step)||step<1||step>rule.hi-rule.lo+1)
      throw new Error(rule.label+'字段步长无效：'+token);
    let low=rule.lo,high=rule.hi;
    if(match[1]!=='*'){
      const parts=match[1].split('-').map(Number);
      low=parts[0];
      high=parts.length===2?parts[1]:(match[2]!==undefined?rule.hi:parts[0]);
    }
    if(!Number.isInteger(low)||!Number.isInteger(high)||low<rule.lo||high>rule.hi||low>high)
      throw new Error(rule.label+'字段超出范围：'+token+'。');
    for(let n=low;n<=high;n+=step)values.add(rule.label==='星期'&&n===7?0:n);
  }
  if(!values.size)throw new Error(rule.label+'字段没有可触发的值。');
  return {values,any:input==='*'||input==='?'};
}

/** Returns sorted value arrays as well as wildcard flags. */
export function parseCron(expression) {
  const fields=String(expression||'').trim().split(/\s+/);
  if(fields.length!==5&&fields.length!==6)
    throw new Error('Cron 需要 5 段，或以“秒”开头的 6 段。');
  const parts=fields.length===5?['0',...fields]:fields;
  const parsed=parts.map((text,index)=>fieldValues(text,RULES[index]));
  return {
    text:fields.join(' '),withSeconds:fields.length===6,
    seconds:[...parsed[0].values].sort((a,b)=>a-b),
    minutes:[...parsed[1].values].sort((a,b)=>a-b),
    hours:[...parsed[2].values].sort((a,b)=>a-b),
    day:parsed[3].values,month:parsed[4].values,weekday:parsed[5].values,
    dayAny:parsed[3].any,weekdayAny:parsed[5].any,
  };
}

function matchesDay(schedule,date){
  if(!schedule.month.has(date.getMonth()+1))return false;
  const dom=schedule.day.has(date.getDate());
  const dow=schedule.weekday.has(date.getDay());
  if(schedule.dayAny&&schedule.weekdayAny)return true;
  if(schedule.dayAny)return dow;
  if(schedule.weekdayAny)return dom;
  return dom||dow; // Standard Unix Cron DOM/DOW OR semantics.
}

/** Local calendar time. Never use setInterval in milliseconds as a substitute for Cron. */
export function nextCronTime(schedule,afterMs){
  if(!Number.isFinite(afterMs))throw new Error('Cron 时间无效。');
  const after=new Date(afterMs);
  const day=new Date(after.getFullYear(),after.getMonth(),after.getDate(),0,0,0,0);
  // Five calendar years is enough for ordinary meditation reminders, without unbounded loops.
  for(let index=0;index<366*5;index++){
    if(matchesDay(schedule,day)){
      const sameDay=day.getFullYear()===after.getFullYear()
        &&day.getMonth()===after.getMonth()&&day.getDate()===after.getDate();
      for(const h of schedule.hours){
        if(sameDay&&h<after.getHours())continue;
        for(const m of schedule.minutes){
          if(sameDay&&h===after.getHours()&&m<after.getMinutes())continue;
          for(const s of schedule.seconds){
            if(sameDay&&h===after.getHours()&&m===after.getMinutes()
              &&s<=after.getSeconds() && after.getMilliseconds()>=0)continue;
            const candidate=new Date(day.getFullYear(),day.getMonth(),day.getDate(),h,m,s,0);
            // Reject normalized nonexistent DST times.
            if(candidate.getTime()>afterMs && candidate.getDate()===day.getDate()
              &&candidate.getHours()===h&&candidate.getMinutes()===m&&candidate.getSeconds()===s)
              return candidate.getTime();
          }
        }
      }
    }
    day.setDate(day.getDate()+1);
  }
  return null;
}

export function formatElapsed(ms){
  const total=Math.floor(Math.max(0,ms)/1000);
  const h=Math.floor(total/3600),m=Math.floor(total/60)%60,s=total%60;
  return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
}

export function speakElapsed(ms){
  const total=Math.max(0,Math.floor(ms/1000));
  const h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;
  let time='';
  if(h)time+=h+'小时';
  if(m)time+=m+'分钟';
  if(s && (!h || !m))time+=s+'秒';
  return '从冥想开始，已经过了'+(time||'不到1秒')+'。';
}

export function intervalNextElapsed(elapsedMs,minutes){
  const step=Math.round(Number(minutes)*60_000);
  if(!Number.isSafeInteger(step)||step<60_000)throw new Error('提醒间隔需要至少 1 分钟。');
  return (Math.floor(Math.max(0,elapsedMs)/step)+1)*step;
}
