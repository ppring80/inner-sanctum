function snapStats(game) {
  const stats =
    statBlock(
      game,
      "snapCounts"
    );

  const offense =
    num(
      stats.offSnap ??
      stats.offense ??
      stats.offensiveSnaps ??
      stats.offSnaps
    );

  let offensePct =
    num(
      stats.offSnapPct ??
      stats.offensePct ??
      stats.offensiveSnapPct
    );

  /*
    Tank01 returns offensive snap percentage as a decimal:
      "0.83" = 83%

    Normalize it to the customer/SAGE-friendly 0-100 scale.
  */
  if (
    offensePct > 0 &&
    offensePct <= 1
  ) {
    offensePct *= 100;
  }

  return {
    offense,
    offensePct
  };
}
