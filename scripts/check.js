import fs from "node:fs";
const fallacies=JSON.parse(fs.readFileSync(new URL('../knowledge/fallacies.json',import.meta.url),'utf8'));
const ids=new Set(fallacies.map(f=>f.id));
if(fallacies.length!==100) throw new Error(`Expected 100 fallacies, got ${fallacies.length}`);
for(let i=1;i<=100;i++) if(!ids.has(i)) throw new Error(`Missing fallacy ${i}`);
const claims=JSON.parse(fs.readFileSync(new URL('../knowledge/claim-identifiers.json',import.meta.url),'utf8'));
if(claims.length!==11) throw new Error(`Expected 11 claim identifiers, got ${claims.length}`);
console.log('Knowledge check passed: 100 fallacies, 11 claim identifiers.');
