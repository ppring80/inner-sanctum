'use strict';
// Discovery audit only. An unsupported claim cannot create or clear a status.
const plain=value=>String(value).replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function reserveClaims(html,{sourceUrl,publishedAt,modifiedAt=null,headline=''}){
 const claims=[],blocks=[...String(html).matchAll(/<div\b[^>]*class=["'][^"']*nfl-c-body-part--text[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
 const reserve=/injured[ /-]*reserve|reserve\/(?:injured|pup|nfi)|\bir\b|physically unable|non-football injury/i;
 const action=/\b(?:placed|put|activated|reinstated|reverted|moved|sent|waived|released)\b/i;
 for(const [,block]of blocks){
  const paragraphs=[...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match=>match[1]);
  // Include a body without paragraph markup and table contents rather than
  // silently losing a differently formatted official announcement.
  for(const paragraph of paragraphs.length?paragraphs:[block]){
   const text=plain(paragraph);
   if(reserve.test(text)&&action.test(text)||/\b(?:waived|released)\b.*\binjury settlements?\b/i.test(text))claims.push({sourceUrl,sourceText:text,publishedAt,modifiedAt,reason:'RESERVE_CLAIM_REQUIRES_TYPED_EXTRACTION'});
  }
 }
 if(!blocks.length&&reserve.test(headline))claims.push({sourceUrl,sourceText:headline,publishedAt,modifiedAt,reason:'RESERVE_ARTICLE_BODY_UNRECOGNIZED'});
 return claims;
}
module.exports={reserveClaims};
