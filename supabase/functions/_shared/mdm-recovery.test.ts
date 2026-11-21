import { it, expect } from 'vitest';
import { eligibleMdmRecovery } from './mdm-recovery';
const trace = () => ({ status:'rejected', failure_type:'timeout', timing:{phase:'model_evaluation',deadline_ms:90000,operations:{medical_decision_making:{status:'pending'}}}, model_transport:[{section:'medical_decision_making',status:'received',http_status:200,finish_reason:'length',content_bytes:0,content_characters:0},{section:'medical_decision_making',status:'pending'}] });
it('qualifies only retained empty-length then pending MDM deadline failure',()=>expect(eligibleMdmRecovery(trace())).toBe(true));
it.each([null, {}, {status:'rejected'}, {...trace(),failure_type:'completeness'}, {...trace(),status:'accepted'}, {...trace(),timing:{...trace().timing,phase:'validation'}}, {...trace(),timing:{...trace().timing,deadline_ms:120000}}, {...trace(),model_transport:[trace().model_transport[0]]}, {...trace(),model_transport:[{...trace().model_transport[0],content_bytes:10},trace().model_transport[1]]}, {...trace(),model_transport:[{...trace().model_transport[0],http_status:429},trace().model_transport[1]]}, {...trace(),model_transport:[trace().model_transport[0],{...trace().model_transport[1],status:'error'}]}, {...trace(),model_transport:[trace().model_transport[0],trace().model_transport[1],trace().model_transport[1]]}])('does not infer eligibility from incomplete/nonmatching history %j',v=>expect(eligibleMdmRecovery(v)).toBe(false));
import { requestSectionWithLengthRetry } from './feedback-operations';
it('recovery starts and stops at 12000, never escalates to 24000',async()=>{
 const budgets:number[]=[]; await expect(requestSectionWithLengthRetry(async b=>{budgets.push(b);throw new Error('finish_reason=length');},12000,12000)).rejects.toThrow(); expect(budgets).toEqual([12000]);
});
it('normal attempts keep 6000 then 12000 policy',async()=>{
 const budgets:number[]=[];await expect(requestSectionWithLengthRetry(async b=>{budgets.push(b);throw new Error('finish_reason=length');},6000,12000)).rejects.toThrow();expect(budgets).toEqual([6000,12000]);
});
