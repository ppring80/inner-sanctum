'use strict';
const {connectLambda,getStore}=require('@netlify/blobs');
const {requireTank01RefreshAuthorization}=require('./_tank01-refresh-guard');
const {STORE,collectRoles}=require('./_team-backfield-roles');
exports.handler=async event=>{
 const denied=requireTank01RefreshAuthorization(event);if(denied)return denied;
 connectLambda(event);
 const result=await collectRoles({store:getStore({name:STORE})});
 return {statusCode:result.cached===false?502:200,body:JSON.stringify(result)};
};
