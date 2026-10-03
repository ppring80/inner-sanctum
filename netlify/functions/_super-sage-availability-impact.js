"use strict";
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function buildAvailabilityImpact({player,status,team,position,role={},replacement={},observedAt=null,source=null}={}) {
  if(!player||!status) throw new Error("Availability impact requires player and status.");
  const lost={
    snapSharePct:finite(role.snapSharePct),routeParticipationPct:finite(role.routeParticipationPct),
    targetSharePct:finite(role.targetSharePct),rushSharePct:finite(role.rushSharePct),
    passBlockSnaps:finite(role.passBlockSnaps),pressureSharePct:finite(role.pressureSharePct),
    coverageSnapSharePct:finite(role.coverageSnapSharePct)
  };
  return {
    version:1,player,team:team||null,position:position||null,status,
    observedAt,source,lostRole:lost,
    replacement:{
      player:replacement.player||null,
      roleKnown:Boolean(replacement.player && Object.keys(replacement).some(k=>k!=="player")),
      snapSharePct:finite(replacement.snapSharePct),
      routeParticipationPct:finite(replacement.routeParticipationPct),
      targetSharePct:finite(replacement.targetSharePct),
      rushSharePct:finite(replacement.rushSharePct)
    },
    fantasyChannels:[
      "direct player availability",
      "teammate opportunity redistribution",
      "offensive protection/run-blocking change",
      "defensive coverage/pass-rush change",
      "opponent matchup change"
    ],
    rules:[
      "An OUT/IR tag is not itself an opportunity projection.",
      "Redistribution requires role evidence; do not assume the nominal backup inherits the full role.",
      "Separate offensive skill loss, protection loss, coverage loss and pass-rush loss.",
      "Preserve observedAt/source because availability changes quickly.",
      "Re-run affected matchup intelligence when a material role changes."
    ],
    canChangeProductionRanking:false
  };
}
module.exports={buildAvailabilityImpact};
