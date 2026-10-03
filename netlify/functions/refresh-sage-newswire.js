'use strict';
const {connectLambda,getStore}=require('@netlify/blobs');
const {requireTank01RefreshAuthorization}=require('./_tank01-refresh-guard');
const {collectSources,text}=require('./_newswire-sources');
const {editorialStories}=require('./_newswire-editorial');
const {analyzeStories}=require('./_newswire-analysis');
const TRACKED=new Set(['QB','RB','WR','TE','K']);
function normalizeStories(items,players={},now=Date.now()){
 const stories=[],seen=new Set();
 for(const item of items){let url;try{url=new URL(item.link);}catch(_){continue;}
 const date=Date.parse(item.publishedAt||item.pubDate||'');
 if(url.protocol!=='https:'||!['www.nfl.com','www.espn.com','www.cbssports.com'].includes(url.hostname)||!Number.isFinite(date)||date>now+300000||now-date>3*86400000||seen.has(url.href))continue;
 const title=text(item.title),context=title+' '+text(item.description);
 if(/power rankings|depth charts|consistency ratings|xTD|xFP|promo code|bonus bets|odds|picks|rankings|fantasy surprises|seven things|coaching gaffes|grading|makes no sense|panic meter|it.s time|inside the decision/i.test(title)||!/(injur|ruled out|return|practice|hamstring|ankle|concussion|surgery|release|signed|signing|trade|workload|fumbl)/i.test(title))continue;
 const identity=Object.values(players).filter(p=>TRACKED.has(p.pos)&&p.longName&&context.toLowerCase().includes(p.longName.toLowerCase())).sort((a,b)=>context.toLowerCase().indexOf(a.longName.toLowerCase())-context.toLowerCase().indexOf(b.longName.toLowerCase()))[0];
 if(!identity)continue;
 const name=identity.longName,pos=identity.pos;
 const trade=/trade|acquire/i.test(title),role=/workload|fumbl|retakes|role/i.test(title),release=/release|waiv/i.test(title),reserve=/injured reserve|\bIR\b/.test(title),out=/ruled out/.test(title),practice=/practice|return/.test(title);
 const impact=trade?`${name}'s old-team projection should not carry into a new lineup decision. Confirm the starting assignment and role in ${identity.team}'s offense before trading or bidding for the player.`:role?`${name}'s opportunity is the issue: check the next game's routes, carries or snaps against the prior workload. A usage story is a reason to revisit ${pos} depth, not proof of an immediate lineup upgrade.`:release?`${name} needs a confirmed team and receiving or rushing role before a waiver add. Do not carry the former team's projection into your lineup decision.`:reserve?`${name} belongs outside weekly starting lineups while on reserve. Review ${identity.team}'s healthy ${pos} options using current workload evidence before increasing a bid.`:out?`Prepare a replacement for ${name}. Evaluate the replacement's actual ${pos} role and matchup; absence alone does not make the next name on the depth chart a strong start.`:practice?`${name}'s practice or return report is a checkpoint, not game clearance. Keep a ${pos} alternative available until the team supplies a game designation.`:`${name}'s ${pos} outlook needs a fresh availability and role check before a lineup change. For ${identity.team}, use confirmed workload and current projections to evaluate any replacement.`;
 stories.push({id:url.href,_sourceContext:text(item.description).slice(0,1800),player:name,team:identity.team,position:pos,status:trade?'Trade report':role?'Role watch':release?'Roster move':reserve?'Reserve report':out?'Availability report':practice?'Practice watch':'Injury watch',statusTone:out||reserve?'breaking':'monitor',headline:title,summary:`${item.sourceLabel||url.hostname} report about ${name}; the linked article supplies the reporting context.`,sageImpact:impact,analysisType:'SAGE conditional analysis',sourceLabel:item.sourceLabel||url.hostname,sourceUrl:url.href,publishedAt:new Date(date).toISOString(),featured:false});seen.add(url.href);
 }
 return stories.slice(0,12);
}
function mergeStories(editorial,automatic){const seen=new Set();return [...editorial,...automatic].filter(s=>{if(seen.has(s.player+'|'+s.sourceUrl)||seen.has(s.player+'|'+s.headline))return false;seen.add(s.player+'|'+s.sourceUrl);seen.add(s.player+'|'+s.headline);return true;});}
exports.handler=async event=>{
 const denied=requireTank01RefreshAuthorization(event);if(denied)return denied;connectLambda(event);
 try{const store=getStore({name:'sage-newswire'}),previous=await store.get('latest',{type:'json'});const players=(await getStore({name:'player-data'}).get('playerData',{type:'json'}))?.players||{};
 const {items,errors}=await collectSources();
 const retained=(previous?.mode==='editorial-with-sources'?previous.stories:[]).filter(s=>s.editorial&&Date.now()-Date.parse(s.publishedAt)<7*86400000);
 const editorial=mergeStories(editorialStories(),retained),candidates=normalizeStories(items,players);
 const automatic=candidates.length?await analyzeStories(candidates):[];
 if(!automatic.length)throw Error('No current, player-specific source reports passed validation; editorial reports preserved.');
 const stories=mergeStories(editorial,automatic);await store.setJSON('latest',{version:3,mode:'editorial-with-sources',updatedAt:new Date().toISOString(),stories,collection:{sources:['NFL.com','ESPN','CBS Sports'],automaticStories:automatic.length,editorialStories:editorial.length,errors,x:'Verified reporter posts retained; direct X timeline collection is not connected.'}});
 return {statusCode:200,body:JSON.stringify({cached:true,stories:stories.length})};
 }catch(error){console.error('SAGE_NEWSWIRE_REFRESH_FAILED',error.message);return {statusCode:502,body:JSON.stringify({cached:false,error:error.message})};}
};
exports.normalizeStories=normalizeStories;exports.mergeStories=mergeStories;
